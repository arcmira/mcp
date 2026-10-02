import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import openapi from './fixtures/openapi.json' with { type: 'json' };
import responses from './fixtures/transcription-responses.json' with { type: 'json' };
import worker from '../src/index.ts';
import pkg from '../package.json' with { type: 'json' };
import { BUILD_META, RATE_LIMIT_META, okResult, withRateLimit } from '../src/result.ts';
import { METHODS } from '../src/reference.ts';
import { fakeLoader, fakeOutbound } from './fake-loader.ts';
import { TOOL_CALLS_PATH } from '../src/telemetry.ts';

const RATE_LIMIT = { limit: 20, remaining: 17, reset: 1788819360 };

function withFetch<T>(handler: (url: URL, init?: RequestInit) => Response, body: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(new URL(input instanceof Request ? input.url : String(input)), init)) as typeof fetch;
  return body().finally(() => {
    globalThis.fetch = original;
  });
}

interface ToolReply {
  result: { content: Array<{ type: string; text: string }>; structuredContent?: unknown; isError?: boolean; _meta?: Record<string, unknown> };
}

/** One tools/call through the Worker's fetch, the way a host sends it. The reply is one SSE message. */
async function callTool(
  name: string,
  args: Record<string, unknown>,
  upstream: (url: URL, init?: RequestInit) => Response,
  env: Record<string, unknown> = {},
) {
  const request = new Request('https://mcp.arcmira.com/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer arc_sk_fixture',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const outbound = fakeOutbound({ '/v1': (url) => upstream(url) });
  const deferred: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => deferred.push(p), passThroughOnException() {}, props: {}, exports: { ApiOutbound: () => outbound } } as unknown as ExecutionContext;
  // Tool-call telemetry posts land here, never on the network or the test's upstream.
  const handler = (url: URL, init?: RequestInit) => (url.pathname === TOOL_CALLS_PATH ? new Response(null, { status: 202 }) : upstream(url, init));
  const text = await withFetch(handler, async () => {
    const response = await worker.fetch(request, env, ctx);
    const body = await response.text();
    await Promise.all(deferred);
    return body;
  });
  const data = text.split('\n').find((line) => line.startsWith('data:'));
  return JSON.parse(data ? data.slice(5) : text) as ToolReply;
}

const textOf = (reply: ToolReply) => reply.result.content.map((c) => c.text).join('\n');

describe('withRateLimit', () => {
  it('adds the budget under the namespaced _meta key and leaves a result alone without one', () => {
    const plain = okResult({ a: 1 });
    assert.equal(withRateLimit(plain, null), plain);
    const carried = withRateLimit({ ...plain, _meta: { other: true } }, RATE_LIMIT);
    assert.deepEqual(carried._meta, {
      other: true,
      [RATE_LIMIT_META]: RATE_LIMIT,
    });
  });
});

describe('the two tools through the handler', () => {
  it('describe returns the reference as text with no structured copy, and names every method', async () => {
    const reply = await callTool('describe', {}, () => Response.json({}));
    assert.equal(reply.result.isError, undefined);
    assert.equal(reply.result.structuredContent, undefined);
    const text = textOf(reply);
    for (const method of METHODS) assert.ok(text.includes(`arcmira.${method.name}(`), `describe lacks ${method.name}`);
    assert.match(text, /\n\narcmira client/);
    assert.deepEqual(reply.result._meta?.[BUILD_META], {
      server: pkg.version,
      deploy: null,
      api: null,
      client: null,
    });
  });

  it('describe opens with the server version and the update hint', async () => {
    const text = textOf(await callTool('describe', {}, () => Response.json({})));
    assert.ok(text.startsWith(`arcmira MCP ${pkg.version}. `), text.slice(0, 120));
    assert.match(text.split('\n')[0], /auto-update/);
  });

  it('describe with a topic keeps the id rule and narrows the methods', async () => {
    const text = textOf(await callTool('describe', { topic: 'sponsors' }, () => Response.json({})));
    assert.match(text, /ID RULE/);
    assert.ok(text.includes('arcmira.sponsors('));
    assert.ok(text.includes('Recurring sponsors of one show'));
    assert.ok(text.includes('arcmira.momentum('), 'every signature stays so no method is hidden');
    assert.ok(!text.includes('The last 30 days against the prior 30'), 'notes of other methods are dropped');
  });

  it('execute runs a program in the loader, and the build names the API behind it', async () => {
    const headers = { 'RateLimit-Limit': '20', 'RateLimit-Remaining': '17', 'RateLimit-Reset': '1788819360', 'x-arcmira-build': 'v-abc123' };
    const reply = await callTool('execute', { code: 'const m = await arcmira.momentum("ent_14"); return m.verdict;' }, () => Response.json({ verdict: 'flat' }, { headers }), { LOADER: fakeLoader() });
    assert.equal(reply.result.isError, undefined);
    assert.equal(JSON.parse(textOf(reply)).value, 'flat');
    assert.equal(JSON.parse(textOf(reply)).api_build, 'v-abc123');
    assert.deepEqual(reply.result._meta?.[RATE_LIMIT_META], RATE_LIMIT);
    assert.equal((reply.result._meta?.[BUILD_META] as { api: string }).api, 'v-abc123');
    assert.deepEqual(reply.result._meta?.['arcmira.com/execution'], {
      calls: 1,
      api_build: 'v-abc123',
      rate_limit: RATE_LIMIT,
      outcome_uncertain: false,
      routes: ['GET /v1/entities/ent_14/momentum'],
    });
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

describe('bounded outcomes and explicit preparation over MCP', () => {
  it('preserves pending and quota recovery after 20001 log characters', async () => {
    for (const status of [200, 402, 503]) {
      const pending = responses.get_transcript_pending.body;
      const error = {
        code: status === 402 ? 'quota_exceeded' : 'server_error',
        message: 'recover me',
        retry_after_seconds: 7,
        request_id: 'req-123',
        doc_url: 'https://arcmira.com/docs/errors',
      };
      const reply = await callTool(
        'execute',
        {
          code: 'console.log("x".repeat(20001)); return await arcmira.transcript("dQw4w9WgXcQ", {quality:"premium"});',
        },
        () =>
          Response.json(status === 200 ? pending : { error }, {
            status,
            headers: {
              'x-arcmira-build': 'fixture-build',
              'ratelimit-limit': '20',
              'ratelimit-remaining': '19',
              'ratelimit-reset': '5',
            },
          }),
        { LOADER: fakeLoader() },
      );
      const text = textOf(reply);
      const result = JSON.parse(text);
      assert.ok(text.length <= 20000);
      assert.equal(result.logs_truncated, true);
      assert.equal(result.calls, 1);
      assert.equal(result.api_build, 'fixture-build');
      assert.deepEqual(result.rate_limit, {
        limit: 20,
        remaining: 19,
        reset: 5,
      });
      if (status === 200) assert.deepEqual(result.value, pending);
      else {
        assert.equal(reply.result.isError, true);
        assert.equal(result.error.code, error.code);
        assert.equal(result.error.request_id, 'req-123');
        assert.equal(result.error.retry_after_seconds, 7);
      }
    }
  });
  it('keeps a continuation token while bounding a long successful page and raw fetch calls', async () => {
    const reply = await callTool(
      'execute',
      {
        code: 'return await (await fetch("https://api.arcmira.com/v1/mentions")).json();',
      },
      () =>
        Response.json({
          rows: Array.from({ length: 1000 }, () => ({
            text: 'x'.repeat(1000),
          })),
          next_cursor: 'signed-next',
          has_more: true,
        }),
      { LOADER: fakeLoader() },
    );
    const result = JSON.parse(textOf(reply));
    assert.ok(textOf(reply).length <= 20000);
    assert.equal(result.value.next_cursor, 'signed-next');
    assert.equal(result.value.has_more, true);
    assert.equal(result.truncated, true);
    assert.equal(result.calls, 1);
  });
  it('prepares with one keyless POST of the video id and answers the Job', async () => {
    const calls: Array<{ method: string; body: unknown; key: string | null }> = [];
    const upstream = (url: URL, init?: RequestInit) => {
      if (url.pathname === '/v1/me') return Response.json({ id: 'caller' });
      assert.equal(url.pathname, '/v1/transcriptions');
      const body = JSON.parse(String(init?.body));
      const schema = openapi.paths['/v1/transcriptions'].post.requestBody.content['application/json'].schema;
      for (const key of Object.keys(body)) assert.ok(key in schema.properties, `Unknown request field ${key}`);
      calls.push({ method: init?.method ?? 'GET', body, key: new Headers(init?.headers).get('idempotency-key') });
      const answer = responses.submit_transcription_pending;
      return Response.json(answer.body, { status: answer.status, headers: answer.headers });
    };
    const reply = await callTool('prepare_transcript', { video_id: 'dQw4w9WgXcQ' }, upstream);
    assert.equal(reply.result.isError, undefined);
    assert.deepEqual(reply.result.structuredContent, responses.submit_transcription_pending.body.job);
    assert.deepEqual(JSON.parse(textOf(reply)), reply.result.structuredContent);
    assert.deepEqual(calls, [{ method: 'POST', body: { video_id: 'dQw4w9WgXcQ', max_on_demand_cents: 0 }, key: null }]);
    for (const extra of [{ idempotency_key: 'k' }, { path: '/v1/anything' }]) {
      const rejected = await callTool('prepare_transcript', { video_id: 'dQw4w9WgXcQ', ...extra }, upstream);
      assert.equal(rejected.result.isError, true);
    }
    assert.equal(calls.length, 1);
  });
  it('an approved cents ceiling sends a generated key and repeats it with the inputs', async () => {
    let sent: string | null = null;
    const reply = await callTool('prepare_transcript', { video_id: 'dQw4w9WgXcQ', max_rows: 300, max_on_demand_cents: 50 }, (url, init) => {
      if (url.pathname === '/v1/me') return Response.json({ id: 'caller' });
      sent = new Headers(init?.headers).get('idempotency-key');
      assert.deepEqual(JSON.parse(String(init?.body)), { video_id: 'dQw4w9WgXcQ', max_rows: 300, max_on_demand_cents: 50 });
      return Response.json(responses.submit_transcription_pending.body, { status: 202 });
    });
    assert.match(sent ?? '', /^[\x21-\x7e]{1,255}$/);
    assert.deepEqual(reply.result.structuredContent, {
      ...responses.submit_transcription_pending.body.job,
      intent: { video_id: 'dQw4w9WgXcQ', max_rows: 300, max_on_demand_cents: 50, idempotency_key: sent },
    });
    assert.deepEqual(JSON.parse(textOf(reply)), reply.result.structuredContent);
  });
  it('a lost preparation response says to retry the same inputs, and repeats a generated key', async () => {
    for (const [args, keyed] of [
      [{ video_id: 'dQw4w9WgXcQ' }, false],
      [{ video_id: 'dQw4w9WgXcQ', max_rows: 300, max_on_demand_cents: 50 }, true],
    ] as const) {
      let sent: string | null = null;
      const reply = await callTool('prepare_transcript', args, (url, init) => {
        if (url.pathname === '/v1/me') return Response.json({ id: 'caller' });
        sent = new Headers(init?.headers).get('idempotency-key');
        throw new Error('lost acknowledgement');
      });
      assert.equal(reply.result.isError, true);
      const body = JSON.parse(textOf(reply));
      assert.equal(body.error.code, 'preparation_outcome_unknown');
      assert.match(body.error.message, /same inputs/);
      assert.deepEqual(body.intent, keyed ? { ...args, idempotency_key: sent } : undefined);
      assert.deepEqual(reply.result.structuredContent, body);
    }
  });
});

it('a preparation_required read reaches the program as its value, not an error', async () => {
  const answer = responses.get_transcript_preparation_required;
  const reply = await callTool(
    'execute',
    { code: 'const t = await arcmira.transcript("dQw4w9WgXcQ", { quality: "premium" }); return { state: t.state, rows: t.quote.rows, action: t.action };' },
    () => Response.json(answer.body, { status: answer.status }),
    { LOADER: fakeLoader() },
  );
  assert.equal(reply.result.isError, undefined);
  assert.deepEqual(JSON.parse(textOf(reply)).value, { state: 'preparation_required', rows: 300, action: answer.body.action });
});

it('a pending Premium read stays data under a heavy payload, and a POST refusal keeps its quote', async () => {
  const pending = responses.get_transcript_pending.body;
  const reply = await callTool(
    'execute',
    {
      code: 'return await arcmira.transcript("dQw4w9WgXcQ",{quality:"premium"});',
    },
    () => Response.json({ data: 'x'.repeat(20001), ...pending }, { status: 202 }),
    { LOADER: fakeLoader() },
  );
  const rendered = JSON.parse(textOf(reply));
  assert.equal(rendered.value.state, 'pending');
  assert.deepEqual(rendered.value.job, pending.job);
  const refusal = responses.submit_transcription_max_rows_exceeded;
  const prepared = await callTool(
    'prepare_transcript',
    { video_id: 'dQw4w9WgXcQ', max_rows: 75 },
    () => Response.json(refusal.body, { status: refusal.status }),
  );
  assert.deepEqual(JSON.parse(textOf(prepared)), refusal.body);
});

it('an unreadable preparation acknowledgement is an unknown outcome to retry with the same inputs', async () => {
  const reply = await callTool('prepare_transcript', { video_id: 'dQw4w9WgXcQ' }, (url) =>
    url.pathname === '/v1/me' ? Response.json({ id: 'caller' }) : new Response('truncated acknowledgement', { status: 202 }),
  );
  const body = JSON.parse(textOf(reply));
  assert.equal(body.error.code, 'preparation_outcome_unknown');
  assert.match(body.error.message, /same inputs/);
});
