import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import pkg from '../package.json' with { type: 'json' };
import { BUILD_META, RATE_LIMIT_META, okResult, withRateLimit } from '../src/result.ts';

const RATE_LIMIT = { limit: 20, remaining: 17, reset: 1788819360 };

function withFetch<T>(handler: (url: URL) => Response, body: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => handler(new URL(String(input)))) as typeof fetch;
  return body().finally(() => {
    globalThis.fetch = original;
  });
}

/** One tools/call through the Worker's fetch, the way a host sends it. The reply is one SSE message. */
async function callTool(name: string, args: Record<string, unknown>, upstream: (url: URL) => Response) {
  const request = new Request('https://mcp.arcmira.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer arc_tk_fixture' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const response = await withFetch(upstream, () => worker.fetch(request, {}, ctx));
  const text = await response.text();
  const data = text.split('\n').find((line) => line.startsWith('data:'));
  assert.ok(data, `no SSE data line in ${text.slice(0, 120)}`);
  return JSON.parse(data.slice(5)) as { result: { isError?: boolean; _meta?: Record<string, unknown> } };
}

describe('withRateLimit', () => {
  it('adds the budget under the namespaced _meta key and leaves a result alone without one', () => {
    const plain = okResult({ a: 1 });
    assert.equal(withRateLimit(plain, null), plain);
    const carried = withRateLimit({ ...plain, _meta: { other: true } }, RATE_LIMIT);
    assert.deepEqual(carried._meta, { other: true, [RATE_LIMIT_META]: RATE_LIMIT });
    assert.equal(carried.structuredContent, plain.structuredContent);
  });
});

describe('a tool call through the handler', () => {
  it('carries the latest upstream RateLimit headers on the result, on a gate too', async () => {
    const headers = { 'RateLimit-Limit': '20', 'RateLimit-Remaining': '17', 'RateLimit-Reset': '1788819360' };
    const reply = await callTool('resolve_entities', { q: 'Ramp' }, () => Response.json({ entities: [], has_more: false }, { headers }));
    assert.equal(reply.result.isError, undefined);
    assert.deepEqual(reply.result._meta?.[RATE_LIMIT_META], RATE_LIMIT);

    const refused = { type: 'rate_limit_error', code: 'rate_limited', message: 'Requests are limited to 20 per minute on this key.', retry_after_seconds: 7, doc_url: 'https://arcmira.com/docs/errors#rate_limited', request_id: 'req_x' };
    const gate = await callTool('resolve_entities', { q: 'Ramp' }, () => Response.json({ error: refused }, { status: 429, headers: { ...headers, 'RateLimit-Remaining': '0' } }));
    assert.equal(gate.result.isError, true);
    assert.deepEqual(gate.result._meta?.[RATE_LIMIT_META], { ...RATE_LIMIT, remaining: 0 });
  });

  it('carries no budget when the upstream answer has no RateLimit headers, and the build always', async () => {
    const reply = await callTool('resolve_entities', { q: 'Ramp' }, () => Response.json({ entities: [], has_more: false }, { headers: { 'x-arcmira-build': 'v-abc123' } }));
    assert.equal(reply.result._meta?.[RATE_LIMIT_META], undefined);
    assert.deepEqual(reply.result._meta?.[BUILD_META], { server: pkg.version, deploy: null, api: 'v-abc123', client: null });
  });

  it('names the API build null when no upstream call answered', async () => {
    const reply = await callTool('resolve_entities', { q: 'Ramp' }, () => Response.json({ entities: [], has_more: false }));
    assert.deepEqual(reply.result._meta?.[BUILD_META], { server: pkg.version, deploy: null, api: null, client: null });
  });
});
