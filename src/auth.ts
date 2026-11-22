import { DEFAULT_API_BASE, LISTING_PARAM, SRC, USER_AGENT, noKeyError, type CredentialFailure, type Env } from './api.ts';
import { MCP_PATH } from './server.ts';
import { APPS_SURFACE, PROGRAM_SURFACE } from './surface.ts';

/**
 * The MCP authorization spec on top of the key rungs. A request with no bearer, or with a
 * bearer that is neither an Arcmira key nor a live OAuth token, gets a 401 whose
 * WWW-Authenticate names this server's protected-resource document; the document names
 * api.arcmira.com as the authorization server. Hosts that speak the spec then register, send
 * the person to arcmira.com to sign in and allow, and come back with a token. Hosts that do
 * not speak it send an arc_sk_ account key, which never reaches the token check.
 */
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
export const AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server';
const ARCMIRA_KEY_PREFIX = 'arc_';
const SESSION_PATH = '/api/auth/mcp/get-session';
const ME_PATH = '/v1/me';
export class AuthUnavailable extends Error {
  readonly status: number;
  readonly retryAfter: string | null;
  constructor(status: number, retryAfter: string | null) {
    super('Authentication upstream is temporarily unavailable. Keep the current credential and retry.');
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * The scopes each MCP path asks for at sign-in. Hosts request every scope a path lists, and the consent screen
 * shows each one. /mcp keeps the write scopes arcmira_execute_write needs. /mcp/apps serves search, transcript and
 * feedback, which need only read. It lists offline_access on purpose, in the header and the document alike: the
 * newest MCP spec leaves that scope for clients to add themselves, but hosts that request only what a resource lists
 * would otherwise get no refresh token and sign in again every hour.
 */
const SERVER_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'read', 'recommendations:read', 'monitors:write', 'trackers:write'];
const APPS_SCOPES = ['read', 'offline_access'];

export function apiBase(env: Env): string {
  return (env.ARCMIRA_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, '');
}

/**
 * A URL of the `/mcp` endpoint with the source tag the host's address carried. RFC 9728 has a client compare the
 * document's `resource` with the URL it called, so a host that connected to a tagged address reads the same address
 * back and names it at sign-in, where the API reads the tag. Only `/mcp` keeps the tag: the API accepts a tagged
 * `resource` for that endpoint alone, so `/mcp/apps` answers with its bare address.
 */
function tagged(url: string, path: string, listing: string | null): string {
  return listing !== null && path === MCP_PATH ? `${url}?${LISTING_PARAM}=${listing}` : url;
}

/** The protected-resource document for one MCP path; `resource` is that path's own URL, as RFC 9728 requires. */
export function protectedResourceMetadata(origin: string, env: Env, path: string = MCP_PATH, listing: string | null = null): Record<string, unknown> {
  return {
    resource: tagged(`${origin}${path}`, path, listing),
    authorization_servers: [apiBase(env)],
    bearer_methods_supported: ['header'],
    scopes_supported: path === MCP_PATH ? SERVER_SCOPES : APPS_SCOPES,
    resource_name: 'Arcmira MCP',
    resource_documentation: 'https://arcmira.com/docs/authentication#oauth-for-mcp-clients',
  };
}

export function isOAuthBearer(key: string | null): key is string {
  return key !== null && !key.startsWith(ARCMIRA_KEY_PREFIX);
}

/** The 401 that starts the OAuth dance. The body names the sign-up, for a host that cannot run it. */
export function challenge(origin: string, reason: CredentialFailure = 'no_credential', path: string = MCP_PATH, listing: string | null = null): Response {
  const error = (path === MCP_PATH ? PROGRAM_SURFACE : APPS_SURFACE).error(noKeyError(reason));
  return Response.json(
    {
      jsonrpc: '2.0',
      error: { code: -32000, message: error.message, data: error },
      id: null,
    },
    {
      status: 401,
      headers: {
        'WWW-Authenticate':
          path === MCP_PATH
            ? `Bearer resource_metadata="${tagged(`${origin}${PROTECTED_RESOURCE_PATH}`, path, listing)}"`
            : `Bearer resource_metadata="${origin}${PROTECTED_RESOURCE_PATH}${path}", scope="${APPS_SCOPES.join(' ')}"`,
        'Access-Control-Expose-Headers': 'WWW-Authenticate',
      },
    },
  );
}

/** Some hosts probe the MCP origin for the authorization-server document; hand them the real one. */
export async function authorizationServerMetadata(env: Env): Promise<Response> {
  const upstream = await fetch(`${apiBase(env)}${AUTHORIZATION_SERVER_PATH}`, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    cf: { cacheTtl: 300, cacheEverything: true },
  } as RequestInit);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
    },
  });
}

/**
 * Whose credential a request carries, as the check that admitted it answered: the account for an account key, the
 * person and the registered OAuth client for a sign-in. For the host-load log lines only; nothing is decided on it.
 */
export interface Owner {
  account_id: string | null;
  user_id: string | null;
  oauth_client_id: string | null;
}

interface Live {
  until: number;
  owner: Owner;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value.slice(0, 120) : null);

/**
 * Live tokens by value, until the earlier of their own expiry and five minutes, per isolate. A
 * token the backend does not know is not cached, so a fresh one is accepted on its first use.
 */
const live = new Map<string, Live>();

interface SessionRow {
  accessTokenExpiresAt?: string | number;
  userId?: unknown;
  clientId?: unknown;
}

export async function tokenIsLive(token: string, env: Env, now = Date.now()): Promise<boolean> {
  const cached = live.get(token);
  if (cached !== undefined && cached.until > now) return true;
  live.delete(token);
  const response = await fetch(`${apiBase(env)}${SESSION_PATH}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
  }).catch(() => {
    throw new AuthUnavailable(503, null);
  });
  if (response.status === 401) return false;
  if (!response.ok) throw new AuthUnavailable(response.status === 429 ? 429 : 503, response.headers.get('retry-after'));
  const row = (await response.json().catch(() => {
    throw new AuthUnavailable(503, response.headers.get('retry-after'));
  })) as SessionRow | null;
  if (row === null) return false;
  if (typeof row !== 'object') throw new AuthUnavailable(503, response.headers.get('retry-after'));
  const expiry = row.accessTokenExpiresAt === undefined ? Number.NaN : new Date(row.accessTokenExpiresAt).getTime();
  const until = Math.min(now + CACHE_TTL_MS, Number.isFinite(expiry) ? expiry : now + CACHE_TTL_MS);
  if (until <= now) return false;
  live.set(token, { until, owner: { account_id: null, user_id: text(row.userId), oauth_client_id: text(row.clientId) } });
  return true;
}

/**
 * Live account keys by value, for five minutes per isolate. Only a 401 from /v1/me is a verdict
 * against the key: a 402 over quota, a 403 at a plan gate, a 429, a 5xx, or a fetch that never
 * lands all mean a real key the API will not serve right now, and answering those with the 401
 * that starts the OAuth dance teaches a host to re-authenticate in a loop that cannot succeed.
 */
const liveKeys = new Map<string, Live>();

/**
 * Null for a key v1 serves, otherwise why it refused: v1's own `error.reason` when the 401 carries
 * one, `invalid` when it does not. A network failure or a non-401 error is not a verdict on the
 * key and passes it through to the first tool call.
 */
export async function keyFailure(key: string, env: Env, now = Date.now()): Promise<CredentialFailure | null> {
  const cached = liveKeys.get(key);
  if (cached !== undefined && cached.until > now) return null;
  liveKeys.delete(key);
  const response = await fetch(`${apiBase(env)}${ME_PATH}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
  }).catch(() => {
    throw new AuthUnavailable(503, null);
  });
  if (response.status === 401) {
    const body = (await response.json().catch(() => null)) as {
      error?: { reason?: string };
    } | null;
    return body?.error?.reason === 'revoked' ? 'revoked' : 'invalid';
  }
  if (response.status === 429 || response.status >= 500 || (response.status >= 300 && response.status < 400))
    throw new AuthUnavailable(response.status === 429 ? 429 : 503, response.headers.get('retry-after'));
  if (!response.ok) return null;
  const me = (await response.json().catch(() => null)) as { account?: { id?: unknown } } | null;
  liveKeys.set(key, { until: now + CACHE_TTL_MS, owner: { account_id: text(me?.account?.id), user_id: null, oauth_client_id: null } });
  return null;
}

/** The owner of a credential the last check admitted, while that check is still cached. Null for any other. */
export function ownerOf(key: string, now = Date.now()): Owner | null {
  const cached = (isOAuthBearer(key) ? live : liveKeys).get(key);
  return cached !== undefined && cached.until > now ? cached.owner : null;
}

/** The src every unlock link carries is the same one v1 sees, so the funnel joins. */
export const OAUTH_SRC = SRC;
