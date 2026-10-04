import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import openapi from './fixtures/openapi.json' with { type: 'json' };
import responses from './fixtures/transcription-responses.json' with { type: 'json' };
import worker from '../src/index.ts';
import { outboundAllowed, type Access } from '../src/sandbox.ts';
import pkg from '../package.json' with { type: 'json' };
import { BUILD_META, RATE_LIMIT_META, okResult, withRateLimit } from '../src/result.ts';
import { METHODS } from '../src/reference.ts';
import { fakeLoader } from './fake-loader.ts';
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
  const deferred: Promise<unknown>[] = [];
  /**
   * The outbound for the access the tool asked for, applying the Worker's allowlist (tests/outbound.test.ts
   * covers ApiOutbound itself). In node the sandbox shares the parent's global fetch, so the real
   * outbound's upstream call would be metered as a second program call.
   */
  const outboundFor = ({ props }: { props: { access?: Access } }) => ({
    async fetch(request: Request) {
      const url = new URL(request.url);
      if (!outboundAllowed(props.access ?? 'read', request.method, url.pathname))
        return Response.json({ error: { type: 'invalid_request_error', code: 'outbound_refused', message: 'refused' } }, { status: 403 });
      return upstream(url, { method: request.method, headers: request.headers, body: request.method === 'GET' ? undefined : await request.text() });
    },
  });
  const ctx = {
    waitUntil: (p: Promise<unknown>) => deferred.push(p),
    passThroughOnException() {},
    props: {},
    exports: { ApiOutbound: outboundFor },
  } as unknown as ExecutionContext;
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

describe('the four tools through the handler', () => {
  it('tools/list distinguishes reference lookup, paid programs and persisted feedback', async () => {
    const request = new Request('https://mcp.arcmira.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer arc_sk_fixture' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
    const text = await withFetch(() => Response.json({ id: 'caller' }), async () => (await worker.fetch(request, {}, ctx)).text());
    const data = text.split('\n').find((line) => line.startsWith('data:'));
    const tools = (JSON.parse(data ? data.slice(5) : text) as { result: { tools: Array<{ name: string; annotations: Record<string, unknown>; inputSchema: { properties: Record<string, unknown> } }> } }).result.tools;
    assert.deepEqual(
      Object.fromEntries(tools.map((t) => [t.name, [t.annotations.readOnlyHint, t.annotations.destructiveHint, t.annotations.idempotentHint, t.annotations.openWorldHint]])),
      {
        arcmira_describe: [true, false, true, false],
        arcmira_execute_read: [false, false, false, true],
        arcmira_execute_write: [false, true, false, true],
        arcmira_feedback: [false, false, false, false],
      },
    );
    for (const tool of tools) assert.ok('intent' in tool.inputSchema.properties, `${tool.name} takes intent`);
  });

  it('describe returns the reference as text with no structured copy, and names every method', async () => {
    const reply = await callTool('arcmira_describe', {}, () => Response.json({}));
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
    const text = textOf(await callTool('arcmira_describe', {}, () => Response.json({})));
    assert.ok(text.startsWith(`arcmira MCP ${pkg.version}. `), text.slice(0, 120));
    assert.match(text.split('\n')[0], /auto-update/);
  });

  it('describe with a topic keeps the id rule and narrows the methods', async () => {
    const text = textOf(await callTool('arcmira_describe', { topic: 'sponsors' }, () => Response.json({})));
    assert.match(text, /ID RULE/);
    assert.ok(text.includes('arcmira.sponsors('));
    assert.ok(text.includes('Recurring sponsors of one show'));
    assert.ok(text.includes('arcmira.momentum('), 'every signature stays so no method is hidden');
    assert.ok(!text.includes('The last 30 days against the prior 30'), 'notes of other methods are dropped');
  });

  it('execute runs a program in the loader, and the build names the API behind it', async () => {
    const headers = { 'RateLimit-Limit': '20', 'RateLimit-Remaining': '17', 'RateLimit-Reset': '1788819360', 'x-arcmira-build': 'v-abc123' };
    const reply = await callTool('arcmira_execute_read', { code: 'const m = await arcmira.momentum("ent_14"); return m.verdict;' }, () => Response.json({ verdict: 'flat' }, { headers }), { LOADER: fakeLoader() });
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
    const reply = await callTool('arcmira_execute_read', { code: 'return 1;' }, () => Response.json({}));
    assert.equal(reply.result.isError, true);
    assert.match(textOf(reply), /"code":"sandbox_unavailable"/);
  });

  it('a retired tool name answers tool_retired and names its replacement', async () => {
    for (const [name, replacement] of [
      ['resolve_entities', 'arcmira_describe'],
      ['describe', 'arcmira_describe'],
      ['execute', 'arcmira_execute_read'],
      ['prepare_transcript', 'arcmira.transcript(video'],
    ]) {
      const reply = await callTool(name, {}, () => Response.json({}));
      assert.equal(reply.result.isError, true, name);
      assert.match(textOf(reply), /"code":"tool_retired"/, name);
      assert.ok(textOf(reply).includes(replacement), `${name} names ${replacement}`);
    }
  });
});

describe('bounded outcomes and Premium reads over MCP', () => {
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
        'arcmira_execute_read',
        {
          code: 'console.log("x".repeat(20001)); return await arcmira.transcript("dQw4w9WgXcQ");',
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
      'arcmira_execute_read',
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
  it('a Premium read of a video not transcribed yet is GETs only: no POST, no purchase ceilings, and the lines when ready', async () => {
    const seen: string[] = [];
    let reads = 0;
    const reply = await callTool(
      'arcmira_execute_read',
      { code: 'const t = await arcmira.transcript("dQw4w9WgXcQ", { quality: "premium" }); return { state: t.state, lines: t.lines.length, speaker: t.speakers[0].entity_id };' },
      (url, init) => {
        seen.push(`${init?.method ?? 'GET'} ${url.pathname}?quality=${url.searchParams.get('quality')}`);
        const answer = reads++ === 0 ? responses.get_transcript_pending : responses.get_transcript_premium_ready;
        return Response.json(answer.body, { status: answer.status, headers: { 'retry-after': '0' } });
      },
      { LOADER: fakeLoader() },
    );
    assert.equal(reply.result.isError, undefined, textOf(reply));
    assert.deepEqual(JSON.parse(textOf(reply)).value, { state: 'ready', lines: responses.get_transcript_premium_ready.body.lines.length, speaker: 'ent_99' });
    assert.deepEqual(seen, ['GET /v1/transcripts/dQw4w9WgXcQ?quality=premium', 'GET /v1/transcripts/dQw4w9WgXcQ?quality=premium']);
    assert.equal(openapi.paths['/v1/transcripts/{video_id}'].get.responses['202'] !== undefined, true);
  });

  it('a budget refusal reaches the program as an ArcmiraError with its unlock, and the result carries the feedback line', async () => {
    const refusal = responses.get_transcript_spend_limit_exceeded;
    const reply = await callTool(
      'arcmira_execute_read',
      { code: 'return await arcmira.transcript("dQw4w9WgXcQ", { quality: "premium" });' },
      () => Response.json(refusal.body, { status: refusal.status }),
      { LOADER: fakeLoader() },
    );
    assert.equal(reply.result.isError, true);
    const body = JSON.parse(textOf(reply));
    assert.equal(body.error.code, 'spend_limit_exceeded');
    assert.equal(body.error.unlock.url, 'https://arcmira.com/dashboard/spending');
    assert.deepEqual(body.error.quote, refusal.body.error.details.quote);
    assert.match(body.feedback, /^If this was wrong, slow, or missing for the user, send one arcmira_feedback with call_id mcpc_[0-9a-f]{32}\.$/);
  });

  it('the feedback line rides only on an empty, error, truncated or ask outcome', async () => {
    const cases: Array<[string, boolean]> = [
      ['return { verdict: "flat", shows: [1] };', false],
      ['return { chunks: [], as_of: null };', true],
      ['return [];', true],
      ['return null;', true],
      ['return { ask: { question: "Which Sam?", options: [] } };', true],
      ['return "x".repeat(5000);', true],
      ['throw new Error("boom");', true],
    ];
    for (const [code, nudged] of cases) {
      const body = JSON.parse(textOf(await callTool('arcmira_execute_read', { code }, () => Response.json({}), { LOADER: fakeLoader() })));
      assert.equal('feedback' in body, nudged, code);
    }
  });

  it('a monitor write from the read tool is refused in the Worker even through raw fetch, and runs from the write tool', async () => {
    const upstreamCalls: string[] = [];
    const upstream = (url: URL, init?: RequestInit) => {
      upstreamCalls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      return Response.json({ monitor_id: 'mon_1', results: [{ entity_id: 'ent_14', tracker_id: 'trk_1', created: true, attached: true }] });
    };
    const raw = 'const r = await fetch("https://api.arcmira.com/v1/monitors/mon_1/entities", { method: "POST", body: JSON.stringify({ entity_ids: ["ent_14"] }) }); return { status: r.status, body: await r.json() };';
    const refused = JSON.parse(textOf(await callTool('arcmira_execute_read', { code: raw }, upstream, { LOADER: fakeLoader() })));
    assert.equal(refused.value.status, 403);
    assert.equal(refused.value.body.error.code, 'outbound_refused');
    const method = JSON.parse(textOf(await callTool('arcmira_execute_read', { code: 'return await arcmira.monitors.addEntities("mon_1", ["ent_14"]);' }, upstream, { LOADER: fakeLoader() })));
    assert.equal(method.error.code, 'write_tool_required');
    assert.deepEqual(upstreamCalls, []);
    const saved = await callTool('arcmira_execute_write', { code: 'return await arcmira.monitors.addEntities("mon_1", ["ent_14"], { personMatchMode: "both" });' }, upstream, { LOADER: fakeLoader() });
    assert.equal(saved.result.isError, undefined, textOf(saved));
    assert.equal(JSON.parse(textOf(saved)).value.results[0].attached, true);
    assert.deepEqual(upstreamCalls, ['POST /v1/monitors/mon_1/entities']);
    const deleted = JSON.parse(textOf(await callTool('arcmira_execute_write', { code: 'const r = await fetch("https://api.arcmira.com/v1/monitors/mon_1", { method: "DELETE" }); return r.status;' }, upstream, { LOADER: fakeLoader() })));
    assert.equal(deleted.value, 403);
    assert.equal(upstreamCalls.length, 1);
  });

  it('arcmira_feedback posts one experience row with the category, note and call id, and answers what the API answered', async () => {
    const sent: Array<{ path: string; body: unknown; key: string | null }> = [];
    const callId = `mcpc_${'a'.repeat(32)}`;
    const reply = await callTool('arcmira_feedback', { category: 'wrong_entity', note: 'Mercury resolved to the planet.', call_id: callId, request_id: 'req_9' }, (url, init) => {
      sent.push({ path: url.pathname, body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get('idempotency-key') });
      return Response.json({ feedback_id: 42 }, { status: 201 });
    });
    assert.equal(reply.result.isError, undefined);
    assert.deepEqual(reply.result.structuredContent, { feedback_id: 42, recorded: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].path, '/v1/feedback');
    assert.deepEqual(sent[0].body, { type: 'experience', category: 'wrong_entity', notes: 'Mercury resolved to the planet.', request_id: 'req_9', mcp_call_id: callId });
    assert.ok(sent[0].key);
    for (const bad of [{ category: 'nope', note: 'x' }, { category: 'slow', note: 'x', call_id: 'mcpc_short' }, { category: 'slow', note: 'x', extra: 1 }, { category: 'slow' }]) {
      const rejected = await callTool('arcmira_feedback', bad, () => Response.json({}));
      assert.equal(rejected.result.isError, true, JSON.stringify(bad));
    }
    const refused = await callTool('arcmira_feedback', { category: 'slow', note: 'x' }, () =>
      Response.json({ error: { type: 'invalid_request_error', code: 'invalid_feedback', message: 'm', doc_url: 'd', request_id: 'r' } }, { status: 400 }),
    );
    assert.equal(refused.result.isError, true);
    assert.match(textOf(refused), /"code":"invalid_feedback"/);
  });
});

it('a pending read stays data under a heavy payload', async () => {
  const pending = responses.get_transcript_pending.body;
  const reply = await callTool(
    'arcmira_execute_read',
    {
      code: 'return await arcmira.transcript("dQw4w9WgXcQ",{quality:"captions"});',
    },
    () => Response.json({ data: 'x'.repeat(20001), ...pending }, { status: 202 }),
    { LOADER: fakeLoader() },
  );
  const rendered = JSON.parse(textOf(reply));
  assert.equal(rendered.value.state, 'pending');
  assert.deepEqual(rendered.value.job, pending.job);
});

it('a Premium refusal keeps its quote from error.details for the program', async () => {
  const refusal = responses.get_transcript_paid_plan_required;
  const reply = await callTool(
    'arcmira_execute_read',
    { code: 'try { return await arcmira.transcript("dQw4w9WgXcQ", { quality: "premium" }); } catch (e) { return { code: e.code, quote: e.quote }; }' },
    () => Response.json(refusal.body, { status: refusal.status }),
    { LOADER: fakeLoader() },
  );
  assert.deepEqual(JSON.parse(textOf(reply)).value, { code: 'paid_plan_required', quote: refusal.body.error.details.quote });
});
