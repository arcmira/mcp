import type { ApiClient, ApiErrorBody, ApiResult, Query } from '../src/api.ts';

export interface RecordedCall {
  path: string;
  query: Query;
}

/** An ApiClient that answers by path prefix and records every call, so a test reads what the facade sent. */
export function fakeApi(answers: Record<string, ApiResult>): ApiClient & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async get(path, query = {}) {
      calls.push({ path, query });
      const key = Object.keys(answers).find((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`));
      if (key === undefined) throw new Error(`fake api has no answer for ${path}`);
      return answers[key] as never;
    },
  };
}

export function gate(code: string, extra: Partial<ApiErrorBody> = {}): ApiResult {
  return {
    ok: false,
    status: 403,
    error: {
      type: 'permission_error',
      code,
      message: `${code} fixture`,
      gate: 'plan',
      unlock: { tier: 'pro_plus', url: 'https://arcmira.com/pricing?src=mcp-tool', offer: null },
      doc_url: `https://arcmira.com/docs/errors#${code}`,
      request_id: 'req_fixture',
      ...extra,
    },
  };
}

export function ok(body: Record<string, unknown>): ApiResult {
  return { ok: true, status: 200, body };
}

export function failure(code: string, extra: Partial<ApiErrorBody> & Record<string, unknown> = {}): ApiResult {
  return {
    ok: false,
    status: 404,
    error: {
      type: 'not_found',
      code,
      message: `${code} fixture`,
      doc_url: `https://arcmira.com/docs/errors#${code}`,
      request_id: 'req_fixture',
      ...extra,
    },
  };
}
