import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SRC, USER_AGENT, apiKeyOf, createApiClient, noKeyError } from '../src/api.ts';

function withFetch<T>(handler: (url: URL, init: RequestInit) => Response, body: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => handler(new URL(String(input)), init ?? {})) as typeof fetch;
  return body().finally(() => {
    globalThis.fetch = original;
  });
}

describe('apiKeyOf', () => {
  it('reads a bearer or an x-api-key header and nothing else', () => {
    assert.equal(apiKeyOf(new Request('https://x', { headers: { authorization: 'Bearer arc_tk_abc' } })), 'arc_tk_abc');
    assert.equal(apiKeyOf(new Request('https://x', { headers: { 'x-api-key': ' arc_sk_abc ' } })), 'arc_sk_abc');
    assert.equal(apiKeyOf(new Request('https://x', { headers: { authorization: 'Basic abc' } })), null);
    assert.equal(apiKeyOf(new Request('https://x')), null);
  });
});

describe('the v1 client', () => {
  it('sends the key, the user agent, csv lists, and always src=mcp-tool', async () => {
    const seen: Array<{ url: URL; init: RequestInit }> = [];
    const client = createApiClient({ ARCMIRA_API_BASE: 'http://localhost:8788/' }, 'arc_tk_fixture');
    const result = await withFetch(
      (url, init) => {
        seen.push({ url, init });
        return Response.json({ chunks: [] });
      },
      () => client.get('/v1/transcripts/search', { q: 'Ramp', channel_ids: ['UC1', 'UC2'], entity_ids: [], limit: 5, published_after: null, source: undefined }),
    );
    assert.ok(result.ok);
    assert.equal(seen.length, 1);
    const { url, init } = seen[0];
    assert.equal(url.origin + url.pathname, 'http://localhost:8788/v1/transcripts/search');
    assert.equal(url.searchParams.get('channel_ids'), 'UC1,UC2');
    assert.equal(url.searchParams.has('entity_ids'), false);
    assert.equal(url.searchParams.has('published_after'), false);
    assert.equal(url.searchParams.get('src'), SRC);
    const headers = new Headers(init.headers);
    assert.equal(headers.get('x-api-key'), 'arc_tk_fixture');
    assert.equal(headers.get('user-agent'), USER_AGENT);
  });

  it('forwards an error body untouched', async () => {
    const error = { type: 'permission_error', code: 'trial_rows_exhausted', message: 'm', gate: 'rows', unlock: { tier: 'free', url: 'https://arcmira.com/sign-up?src=mcp-tool', offer: null }, doc_url: 'd', request_id: 'r' };
    const client = createApiClient({}, 'k');
    const result = await withFetch(() => Response.json({ error }, { status: 402 }), () => client.get('/v1/me'));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 402);
      assert.deepEqual(result.error, error);
    }
  });

  it('a legacy string error becomes a typed not_found that keeps the message', async () => {
    const client = createApiClient({}, 'k');
    const result = await withFetch(() => Response.json({ error: 'Transcription request not found.' }, { status: 404 }), () => client.get('/v1/transcriptions/x'));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'not_found');
      assert.equal(result.error.type, 'not_found');
      assert.equal(result.error.message, 'Transcription request not found.');
    }
  });

  it('a non-JSON upstream answer is a typed server error, never a throw', async () => {
    const client = createApiClient({}, 'k');
    const result = await withFetch(() => new Response('<html>challenge</html>', { status: 403, headers: { 'x-request-id': 'req_edge' } }), () => client.get('/v1/me'));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'upstream_unreadable');
      assert.equal(result.error.request_id, 'req_edge');
    }
  });
});

describe('noKeyError', () => {
  it('is the catalog shape with the mint call as the action and mcp-tool on every link', () => {
    const error = noKeyError();
    assert.equal(error.code, 'invalid_api_key');
    assert.equal(error.gate, 'key');
    assert.equal(error.unlock?.action?.method, 'POST');
    assert.equal(error.unlock?.action?.url, 'https://api.arcmira.com/v1/trial-keys?src=mcp-tool');
    assert.match(String(error.unlock?.url), /[?&]src=mcp-tool/);
    assert.ok(!error.message.includes('—'));
  });
});
