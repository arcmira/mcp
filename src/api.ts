import pkg from '../package.json' with { type: 'json' };

/** The one src this server mints. Every unlock link v1 returns to us carries it. */
export const SRC = 'mcp-tool';
export const DEFAULT_API_BASE = 'https://api.arcmira.com';
export const USER_AGENT = `arcmira-mcp/${pkg.version} (+https://github.com/arcmira/mcp)`;

export interface Env {
  ARCMIRA_API_BASE?: string;
  /** The running Worker version (wrangler version_metadata). Absent under local dev. */
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
}

/** The host on the other end of the MCP connection, as its initialize handshake named it. */
export interface ClientInfo {
  name: string;
  version?: string;
}

/** The header v1 reads the host from. Attribution only. */
export const CLIENT_HEADER = 'x-arcmira-client';
/** The header v1 answers with: the deploy id of the API build that served the call. */
export const BUILD_HEADER = 'x-arcmira-build';

/** The v1 error envelope body. Forwarded untouched; the facade never edits a gate. */
export interface ApiErrorBody {
  type: string;
  code: string;
  message: string;
  param?: string;
  gate?: string;
  unlock?: { tier: string; url: string; offer: null; action?: { kind: string; method: string; url: string } };
  retry_after_seconds?: number;
  doc_url: string;
  request_id: string;
}

export type ApiResult<T = Record<string, unknown>> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; error: ApiErrorBody };

export type Query = Record<string, string | number | string[] | undefined | null>;

/** The per-key throttle as v1 reports it on every response: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset. */
export interface RateLimit {
  limit: number;
  remaining: number;
  /** Unix seconds when the fixed window rolls over. */
  reset: number;
}

export interface ApiClient {
  get<T = Record<string, unknown>>(path: string, query?: Query): Promise<ApiResult<T>>;
  /** Name the host every later call is made for. Sent upstream as x-arcmira-client. */
  setClient(client: ClientInfo | undefined): void;
  /** The deploy id of the API build behind the latest answer, or null before any answer. */
  upstreamBuild(): string | null;
  /** The throttle headers on the latest upstream answer, or null before any call or when the answer carried none. */
  rateLimit(): RateLimit | null;
}

/** Reads the three RateLimit headers, or null unless all three are numbers. */
export function rateLimitOf(headers: Headers): RateLimit | null {
  const read = (name: string): number | null => {
    const value = headers.get(name);
    if (value === null || value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const limit = read('ratelimit-limit');
  const remaining = read('ratelimit-remaining');
  const reset = read('ratelimit-reset');
  return limit === null || remaining === null || reset === null ? null : { limit, remaining, reset };
}

/**
 * The only body this server authors. Without a key there is no v1 call to forward, and the
 * fix is a call the agent can make itself, so the body carries it the way trial_key_expired does.
 */
export function noKeyError(): ApiErrorBody {
  return {
    type: 'authentication_error',
    code: 'invalid_api_key',
    message: `No API key was sent. Mint a free trial key with POST ${DEFAULT_API_BASE}/v1/trial-keys?src=${SRC} (empty body, no login), then reconnect with the header Authorization: Bearer <key>. An account key from arcmira.com works the same way.`,
    gate: 'key',
    unlock: {
      tier: 'free',
      url: `https://arcmira.com/docs/authentication?src=${SRC}#trial-keys`,
      offer: null,
      action: { kind: 'mint_trial_key', method: 'POST', url: `${DEFAULT_API_BASE}/v1/trial-keys?src=${SRC}` },
    },
    doc_url: 'https://arcmira.com/docs/errors#invalid_api_key',
    request_id: `mcp_${crypto.randomUUID()}`,
  };
}

/** The bearer a client sent, from either header form v1 accepts. Null when there is none. */
export function apiKeyOf(request: Request): string | null {
  const bearer = request.headers.get('authorization');
  if (bearer && /^bearer\s+\S+$/i.test(bearer)) return bearer.replace(/^bearer\s+/i, '').trim();
  const header = request.headers.get('x-api-key');
  return header && header.trim() ? header.trim() : null;
}

function isErrorBody(value: unknown): value is { error: ApiErrorBody } {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return typeof error === 'object' && error !== null && typeof (error as ApiErrorBody).code === 'string';
}

/** A few older v1 routes still answer { error: "message" }. The message is kept; the envelope is ours. */
function legacyErrorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === 'string' && error.length > 0 ? error : null;
}

/**
 * Every credential goes upstream as Authorization: Bearer. v1 reads an arc_sk_ account key and an
 * arc_tk_ trial key from either header, but an OAuth access token only from Authorization, so the
 * bearer form is the one that admits all three.
 */
export function createApiClient(env: Env, apiKey: string): ApiClient {
  const base = (env.ARCMIRA_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, '');
  let latest: RateLimit | null = null;
  let build: string | null = null;
  let client: string | null = null;
  return {
    rateLimit: () => latest,
    upstreamBuild: () => build,
    setClient(info) {
      client = info?.name ? `${info.name}${info.version ? `/${info.version}` : ''}`.slice(0, 120) : null;
    },
    async get(path, query = {}) {
      const url = new URL(base + path);
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          if (value.length > 0) url.searchParams.set(key, value.join(','));
          continue;
        }
        url.searchParams.set(key, String(value));
      }
      url.searchParams.set('src', SRC);
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          'user-agent': USER_AGENT,
          ...(client ? { [CLIENT_HEADER]: client } : {}),
        },
      });
      latest = rateLimitOf(response.headers) ?? latest;
      build = response.headers.get(BUILD_HEADER) ?? build;
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && body !== null && typeof body === 'object') {
        return { ok: true, status: response.status, body: body as never };
      }
      if (isErrorBody(body)) return { ok: false, status: response.status, error: body.error };
      const legacy = legacyErrorMessage(body);
      if (legacy !== null) {
        return {
          ok: false,
          status: response.status,
          error: {
            type: response.status === 404 ? 'not_found' : response.status < 500 ? 'invalid_request_error' : 'server_error',
            code: response.status === 404 ? 'not_found' : 'upstream_error',
            message: legacy,
            doc_url: 'https://arcmira.com/docs/errors#not_found',
            request_id: response.headers.get('x-request-id') ?? `mcp_${crypto.randomUUID()}`,
          },
        };
      }
      return {
        ok: false,
        status: response.status,
        error: {
          type: 'server_error',
          code: 'upstream_unreadable',
          message: `The Arcmira API answered ${response.status} without an error body. Retry in a few seconds.`,
          doc_url: 'https://arcmira.com/docs/errors#server_error',
          request_id: response.headers.get('x-request-id') ?? `mcp_${crypto.randomUUID()}`,
        },
      };
    },
  };
}
