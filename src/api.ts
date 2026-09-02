import pkg from '../package.json' with { type: 'json' };

/** The one src this server mints. Every unlock link v1 returns to us carries it. */
export const SRC = 'mcp-tool';
export const DEFAULT_API_BASE = 'https://api.arcmira.com';
export const USER_AGENT = `arcmira-mcp/${pkg.version} (+https://github.com/arcmira/mcp)`;

export interface Env {
  ARCMIRA_API_BASE?: string;
}

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

export interface ApiClient {
  get<T = Record<string, unknown>>(path: string, query?: Query): Promise<ApiResult<T>>;
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

export function createApiClient(env: Env, apiKey: string): ApiClient {
  const base = (env.ARCMIRA_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, '');
  return {
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
        headers: { 'x-api-key': apiKey, accept: 'application/json', 'user-agent': USER_AGENT },
      });
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
