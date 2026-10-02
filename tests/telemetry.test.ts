import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker, { ApiOutbound } from '../src/index.ts';
import pkg from '../package.json' with { type: 'json' };
import { CALL_HEADER, TOOL_HEADER } from '../src/api.ts';
import { TOOL_CALLS_PATH, agentToken, intentParam, outline, traceId } from '../src/telemetry.ts';
import { TOOLS } from '../src/tools.ts';
import { errorResult } from '../src/result.ts';
import { fakeLoader, fakeOutbound } from './fake-loader.ts';

interface Posted {
  headers: Headers;
  body: Record<string, unknown> & { outline: Record<string, unknown>; input: Record<string, unknown> };
}

interface Run {
  reply: { result: { content: Array<{ text: string }>; isError?: boolean } };
  posts: Posted[];
  upstream: Array<{ url: URL; headers: Headers; body: string | null }>;
  outboundProps: Array<{ call?: { id: string; tool: string } }>;
}

/**
 * One tools/call through the Worker, with deferred work run to completion. `telemetry` answers the
 * record post; `waitUntil` replaces the context's, so a test can make it throw.
 */
async function run(
  name: string,
  args: Record<string, unknown>,
  options: {
    answer?: (url: URL) => Response;
    telemetry?: () => Promise<Response>;
    waitUntil?: (p: Promise<unknown>) => void;
    headers?: Record<string, string>;
    env?: Record<string, unknown>;
  } = {},
): Promise<Run> {
  const posts: Posted[] = [];
  const upstream: Run['upstream'] = [];
  const outboundProps: Run['outboundProps'] = [];
  const deferred: Promise<unknown>[] = [];
  const answer = options.answer ?? (() => Response.json({ verdict: 'flat' }));
  const outbound = fakeOutbound({ '/v1': answer });
  const ctx = {
    waitUntil: options.waitUntil ?? ((p: Promise<unknown>) => deferred.push(p)),
    passThroughOnException() {},
    props: {},
    exports: {
      ApiOutbound: ({ props }: { props: Run['outboundProps'][number] }) => {
        outboundProps.push(props);
        return outbound;
      },
    },
  } as unknown as ExecutionContext;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    if (url.pathname === TOOL_CALLS_PATH) {
      posts.push({ headers, body: JSON.parse(String(init?.body)) });
      return options.telemetry ? options.telemetry() : new Response(null, { status: 202 });
    }
    upstream.push({ url, headers, body: typeof init?.body === 'string' ? init.body : null });
    if (url.pathname === '/v1/me') return Response.json({ id: 'caller' });
    return answer(url);
  }) as typeof fetch;
  try {
    const request = new Request('https://mcp.arcmira.com/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer arc_sk_fixture',
        'user-agent': 'claude-code/2.1.4 (darwin)',
        ...options.headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const response = await worker.fetch(request, { LOADER: fakeLoader(), ...options.env } as never, ctx);
    const text = await response.text();
    await Promise.all(deferred);
    const data = text.split('\n').find((line) => line.startsWith('data:'));
    return { reply: JSON.parse(data ? data.slice(5) : text), posts, upstream, outboundProps };
  } finally {
    globalThis.fetch = original;
  }
}

describe('tool-call telemetry', () => {
  it('posts one record per call with the span facts, the intent apart from the input, and the caller credential', async () => {
    const { reply, posts, outboundProps } = await run('arcmira_execute_read', {
      code: 'const m = await arcmira.momentum("ent_14"); return m.verdict;',
      intent: 'is Ramp trending',
    });
    assert.equal(reply.result.isError, undefined);
    assert.equal(posts.length, 1);
    const [{ headers, body }] = posts;
    assert.equal(headers.get('authorization'), 'Bearer arc_sk_fixture');
    assert.match(headers.get('user-agent') ?? '', /^arcmira-mcp\//);
    assert.match(String(body.call_id), /^mcpc_[0-9a-f]{32}$/);
    assert.match(String(body.trace_id), /^mcpt_[0-9a-f]{24}$/);
    assert.equal(body.tool, 'arcmira_execute_read');
    assert.equal(body.intent, 'is Ramp trending');
    assert.deepEqual(body.input, { code: 'const m = await arcmira.momentum("ent_14"); return m.verdict;' });
    assert.deepEqual({ ...body.outline, result_chars: undefined }, { ok: true, error_code: null, truncated: false, calls: 1, result_chars: undefined });
    assert.ok(Number(body.outline.result_chars) > 0);
    assert.deepEqual(body.api_calls, ['GET /v1/entities/ent_14/momentum']);
    assert.equal(typeof body.latency_ms, 'number');
    assert.equal(body.server_version, pkg.version);
    // No clientInfo on a stateless call, so the host comes from the user agent's product token.
    assert.equal(body.client, 'claude-code/2.1.4');
    // The sandbox outbound for this call carries the same id the record does.
    assert.deepEqual(outboundProps.at(-1)?.call, { id: body.call_id, tool: 'arcmira_execute_read' });
    assert.ok(!JSON.stringify(body).includes('"content"'), 'the record carries an outline, not the result body');
  });

  it('intent is optional on every tool and never reaches v1', async () => {
    for (const tool of TOOLS) {
      const schema = tool.inputSchema.shape.intent as typeof intentParam | undefined;
      assert.ok(schema, `${tool.name} takes intent`);
      assert.equal(schema.safeParse(undefined).success, true);
      assert.equal(schema.safeParse('x'.repeat(301)).success, false);
    }
    const { reply, posts } = await run('arcmira_describe', { topic: 'sponsors' });
    assert.equal(reply.result.isError, undefined);
    assert.equal(posts[0]?.body.intent, null);
    assert.deepEqual(posts[0]?.body.input, { topic: 'sponsors' });
    assert.deepEqual(posts[0]?.body.api_calls, []);

    const sent = await run(
      'arcmira_feedback',
      { category: 'slow', note: 'The keynote transcript took a minute', intent: 'full transcript of the keynote' },
      { answer: () => Response.json({ feedback_id: 7 }, { status: 201 }) },
    );
    const submit = sent.upstream.find((call) => call.url.pathname === '/v1/feedback');
    assert.deepEqual(JSON.parse(submit?.body ?? '{}'), { type: 'experience', category: 'slow', notes: 'The keynote transcript took a minute' });
    assert.equal(submit?.headers.get(CALL_HEADER), sent.posts[0]?.body.call_id);
    assert.equal(submit?.headers.get(TOOL_HEADER), 'arcmira_feedback');
    assert.deepEqual(sent.posts[0]?.body.api_calls, ['POST /v1/feedback']);
    assert.equal(sent.posts[0]?.body.intent, 'full transcript of the keynote');
  });

  it('a failed, hanging or throwing post never changes or delays the result', async () => {
    const baseline = await run('arcmira_describe', { topic: 'dates' });
    const expected = baseline.reply.result.content.map((c) => c.text).join('');
    const failing = [
      { telemetry: () => Promise.reject(new Error('network down')) },
      { telemetry: () => Promise.resolve(new Response('nope', { status: 500 })) },
      { waitUntil: () => {} },
      {
        waitUntil: () => {
          throw new Error('waitUntil unavailable');
        },
      },
    ];
    for (const options of failing) {
      const { reply } = await run('arcmira_describe', { topic: 'dates' }, options);
      assert.equal(reply.result.content.map((c) => c.text).join(''), expected);
    }
    // A post that never answers: the reply arrives while it is still pending.
    let pending: Promise<unknown> | null = null;
    const hung = await run('arcmira_describe', { topic: 'dates' }, {
      telemetry: () => new Promise<Response>(() => {}),
      waitUntil: (p) => {
        pending = p;
      },
    });
    assert.equal(hung.reply.result.content.map((c) => c.text).join(''), expected);
    assert.ok(pending);
  });

  it('the trace is the host session when it sends one, else one credential, host and hour', async () => {
    const { posts } = await run('arcmira_describe', {}, { headers: { 'mcp-session-id': 'sess_abc123' } });
    assert.equal(posts[0]?.body.trace_id, 'sess_abc123');
    const at = Date.UTC(2026, 9, 2, 10, 15);
    const a = await traceId(null, 'arc_sk_one', 'claude-code/2.1.4', at);
    assert.equal(await traceId(null, 'arc_sk_one', 'claude-code/2.1.4', at + 30 * 60_000), a);
    assert.notEqual(await traceId(null, 'arc_sk_two', 'claude-code/2.1.4', at), a);
    assert.notEqual(await traceId(null, 'arc_sk_one', 'claude-code/2.1.4', at + 60 * 60_000), a);
    assert.ok(!a.includes('arc_sk'));
    assert.equal(await traceId('has spaces', 'arc_sk_one', null, at), await traceId(null, 'arc_sk_one', null, at));
    assert.equal(agentToken('Mozilla/5.0 (Macintosh)'), 'Mozilla/5.0');
    assert.equal(agentToken(null), null);
  });

  it('the outline names the error code of a gate', () => {
    const gated = outline(errorResult({ type: 'permission_error', code: 'plan_required', message: 'm', doc_url: 'd', request_id: 'r' }));
    assert.deepEqual(gated, { ok: false, error_code: 'plan_required', truncated: false, calls: null, result_chars: gated.result_chars });
  });

  it('the sandbox outbound sends the call id and tool upstream with the credential', async () => {
    const proxy = new ApiOutbound(
      { props: { key: 'arc_sk_secret', client: 'claude-ai/1.0', call: { id: 'mcpc_0123', tool: 'arcmira_execute_read' } } } as unknown as ExecutionContext,
      {},
    );
    const original = globalThis.fetch;
    let seen: Headers | null = null;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      await proxy.fetch(new Request('https://api.arcmira.com/v1/search?q=x'));
    } finally {
      globalThis.fetch = original;
    }
    const headers = seen as Headers | null;
    assert.equal(headers?.get(CALL_HEADER), 'mcpc_0123');
    assert.equal(headers?.get(TOOL_HEADER), 'arcmira_execute_read');
    assert.equal(headers?.get('x-arcmira-client'), 'claude-ai/1.0');
  });
});
