import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import pkg from '../package.json' with { type: 'json' };
import { BUILD_META, RATE_LIMIT_META, okResult, withRateLimit } from '../src/result.ts';
import { METHODS } from '../src/reference.ts';
import { fakeLoader, fakeOutbound } from './fake-loader.ts';

const RATE_LIMIT = { limit: 20, remaining: 17, reset: 1788819360 };

function withFetch<T>(handler: (url: URL) => Response, body: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => handler(new URL(input instanceof Request ? input.url : String(input)))) as typeof fetch;
  return body().finally(() => {
    globalThis.fetch = original;
  });
}

interface ToolReply {
  result: { content: Array<{ type: string; text: string }>; structuredContent?: unknown; isError?: boolean; _meta?: Record<string, unknown> };
}

/** One tools/call through the Worker's fetch, the way a host sends it. The reply is one SSE message. */
async function callTool(name: string, args: Record<string, unknown>, upstream: (url: URL) => Response, env: Record<string, unknown> = {}) {
  const request = new Request('https://mcp.arcmira.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer arc_sk_fixture' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const outbound = fakeOutbound({ '/v1': (url) => upstream(url) });
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {}, exports: { ApiOutbound: () => outbound } } as unknown as ExecutionContext;
  const response = await withFetch(upstream, () => worker.fetch(request, env, ctx));
  const text = await response.text();
  const data = text.split('\n').find((line) => line.startsWith('data:'));
  return JSON.parse(data ? data.slice(5) : text) as ToolReply;
}

const textOf = (reply: ToolReply) => reply.result.content.map((c) => c.text).join('\n');

describe('withRateLimit', () => {
  it('adds the budget under the namespaced _meta key and leaves a result alone without one', () => {
    const plain = okResult({ a: 1 });
    assert.equal(withRateLimit(plain, null), plain);
    const carried = withRateLimit({ ...plain, _meta: { other: true } }, RATE_LIMIT);
    assert.deepEqual(carried._meta, { other: true, [RATE_LIMIT_META]: RATE_LIMIT });
  });
});

describe('the two tools through the handler', () => {
  it('describe returns the reference as text with no structured copy, and names every method', async () => {
    const reply = await callTool('describe', {}, () => Response.json({}));
    assert.equal(reply.result.isError, undefined);
    assert.equal(reply.result.structuredContent, undefined);
    const text = textOf(reply);
    for (const method of METHODS) assert.ok(text.includes(`arcmira.${method.name}(`), `describe lacks ${method.name}`);
    assert.match(text, /^arcmira client/);
    assert.deepEqual(reply.result._meta?.[BUILD_META], { server: pkg.version, deploy: null, api: null, client: null });
  });

  it('describe with a topic keeps the id rule and narrows the methods', async () => {
    const text = textOf(await callTool('describe', { topic: 'sponsors' }, () => Response.json({})));
    assert.match(text, /ID RULE/);
    assert.ok(text.includes('arcmira.sponsors('));
    assert.ok(!text.includes('arcmira.momentum('));
  });

  it('execute runs a program in the loader, and the build names the API behind it', async () => {
    const headers = { 'RateLimit-Limit': '20', 'RateLimit-Remaining': '17', 'RateLimit-Reset': '1788819360', 'x-arcmira-build': 'v-abc123' };
    const reply = await callTool('execute', { code: 'const m = await arcmira.momentum("ent_14"); return m.verdict;' }, () => Response.json({ verdict: 'flat' }, { headers }), { LOADER: fakeLoader() });
    assert.equal(reply.result.isError, undefined);
    assert.equal(textOf(reply), 'RETURN: flat');
    assert.deepEqual(reply.result._meta?.['arcmira.com/execution'], { calls: 1, api_build: 'v-abc123' });
  });

  it('execute without a loader binding is a server error that says to retry, not a silent miss', async () => {
    const reply = await callTool('execute', { code: 'return 1;' }, () => Response.json({}));
    assert.equal(reply.result.isError, true);
    assert.match(textOf(reply), /"code":"sandbox_unavailable"/);
  });

  it('a 0.6.0 tool name answers tool_retired and points at describe', async () => {
    const reply = await callTool('resolve_entities', { q: 'Ramp' }, () => Response.json({}));
    assert.equal(reply.result.isError, true);
    assert.match(textOf(reply), /"code":"tool_retired".*describe/);
  });
});
