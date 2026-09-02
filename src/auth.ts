import { DEFAULT_API_BASE, SRC, USER_AGENT, noKeyError, type Env } from './api.ts';
import { MCP_PATH } from './server.ts';

/**
 * The MCP authorization spec on top of the key rungs. A request with no bearer, or with a
 * bearer that is neither an Arcmira key nor a live OAuth token, gets a 401 whose
 * WWW-Authenticate names this server's protected-resource document; the document names
 * api.arcmira.com as the authorization server. Hosts that speak the spec then register, send
 * the person to arcmira.com to sign in and allow, and come back with a token. Hosts that do
 * not speak it keep sending an arc_ key, which never reaches the token check.
 */
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
export const AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server';
const ARCMIRA_KEY_PREFIX = 'arc_';
const SESSION_PATH = '/api/auth/mcp/get-session';
const CACHE_TTL_MS = 5 * 60 * 1000;

export function apiBase(env: Env): string {
  return (env.ARCMIRA_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, '');
}

export function protectedResourceMetadata(origin: string, env: Env): Record<string, unknown> {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [apiBase(env)],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access', 'read', 'recommendations:read'],
    resource_name: 'Arcmira MCP',
    resource_documentation: 'https://arcmira.com/docs/authentication#oauth-for-mcp-clients',
  };
}

export function isOAuthBearer(key: string | null): key is string {
  return key !== null && !key.startsWith(ARCMIRA_KEY_PREFIX);
}

/** The 401 that starts the OAuth dance. The body still carries the no-login rung. */
export function challenge(origin: string): Response {
  const error = noKeyError();
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message: error.message, data: error }, id: null },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer resource_metadata="${origin}${PROTECTED_RESOURCE_PATH}"`,
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
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
  });
}

/**
 * Live tokens by value, until the earlier of their own expiry and five minutes, per isolate. A
 * token the backend does not know is not cached, so a fresh one is accepted on its first use.
 */
const live = new Map<string, number>();

interface SessionRow {
  accessTokenExpiresAt?: string | number;
}

export async function tokenIsLive(token: string, env: Env, now = Date.now()): Promise<boolean> {
  const cached = live.get(token);
  if (cached !== undefined && cached > now) return true;
  live.delete(token);
  const response = await fetch(`${apiBase(env)}${SESSION_PATH}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': USER_AGENT },
  });
  if (!response.ok) return false;
  const row = (await response.json().catch(() => null)) as SessionRow | null;
  if (row === null || typeof row !== 'object') return false;
  const expiry = row.accessTokenExpiresAt === undefined ? Number.NaN : new Date(row.accessTokenExpiresAt).getTime();
  const until = Math.min(now + CACHE_TTL_MS, Number.isFinite(expiry) ? expiry : now + CACHE_TTL_MS);
  if (until <= now) return false;
  live.set(token, until);
  return true;
}

/** The src every unlock link carries is the same one v1 sees, so the funnel joins. */
export const OAUTH_SRC = SRC;
