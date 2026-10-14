import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RESULT_CAP, renderExecution, runProgram } from '../src/sandbox.ts';
import { fakeLoader, fakeOutbound } from './fake-loader.ts';

const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';

function host(answers: Parameters<typeof fakeOutbound>[0]) {
  const outbound = fakeOutbound(answers);
  return {
    host: {
      loader: fakeLoader(),
      outbound,
      apiBase: 'https://api.arcmira.com',
      access: 'read' as const,
    },
    outbound,
  };
}

describe('the sandbox program', () => {
  it('runs the code as an async function body with arcmira in scope and returns lines, value and the meter', async () => {
    const { host: h, outbound } = host({
      '/v1/entities/ent_14/momentum': () =>
        Response.json(
          { verdict: 'flat' },
          {
            headers: {
              'ratelimit-limit': '20',
              'ratelimit-remaining': '19',
              'ratelimit-reset': '5',
            },
          },
        ),
    });
    const run = await runProgram(h, 'console.log("start", 1); const m = await arcmira.momentum("ent_14"); return { v: m.verdict };');
    assert.deepEqual(run, {
      ok: true,
      value: { v: 'flat' },
      lines: ['start 1'],
      calls: 1,
      calls_started: 1,
      in_flight: 0,
      rate_limit: { limit: 20, remaining: 19, reset: 5 },
      api_build: null,
      logs_truncated: false,
      truncated: false,
      outcome_uncertain: false,
      routes: ['GET /v1/entities/ent_14/momentum'],
    });
    assert.equal(outbound.urls[0]?.pathname, '/v1/entities/ent_14/momentum');
    assert.deepEqual(JSON.parse(renderExecution(run)).value, { v: 'flat' });
  });

  it('reports an id_required throw as ERROR with the code, before any call', async () => {
    const { host: h, outbound } = host({});
    const run = await runProgram(h, `return await arcmira.sponsors("TBPN");`);
    assert.equal(run.ok, false);
    if (run.ok) return;
    assert.equal(run.error.code, 'id_required');
    assert.match(run.error.message, /arcmira\.resolve/);
    assert.equal(outbound.urls.length, 0);
    assert.equal(JSON.parse(renderExecution(run)).error.code, 'id_required');
  });

  it('forwards a gate with its unlock', async () => {
    const { host: h } = host({
      [`/v1/channels/${TBPN}/sponsors`]: () =>
        Response.json(
          {
            error: {
              code: 'filter_requires_paid',
              message: 'Pro+',
              unlock: { tier: 'pro_plus', url: 'https://arcmira.com/pricing' },
            },
          },
          { status: 403 },
        ),
    });
    const run = await runProgram(h, `return await arcmira.sponsors("${TBPN}", { status: "active" });`);
    assert.equal(run.ok, false);
    if (run.ok) return;
    assert.equal(run.error.code, 'filter_requires_paid');
    assert.deepEqual(run.error.unlock, {
      tier: 'pro_plus',
      url: 'https://arcmira.com/pricing',
    });
  });

  it('names a syntax error and the function-body rule', async () => {
    const { host: h } = host({});
    const run = await runProgram(h, 'const = ;');
    assert.equal(run.ok, false);
    if (run.ok) return;
    assert.equal(run.error.code, 'syntax_error');
    assert.match(run.error.message, /body of an async function/);
  });

  it('a thrown Error is program_error with its message; undefined return renders as no output', async () => {
    const { host: h } = host({});
    const thrown = await runProgram(h, 'throw new Error("boom")');
    assert.equal(thrown.ok, false);
    if (!thrown.ok) assert.deepEqual([thrown.error.code, thrown.error.message], ['program_error', 'boom']);
    const silent = await runProgram(h, 'const x = 1;');
    assert.equal(JSON.parse(renderExecution(silent)).value, null);
  });

  it('caps the rendered output and says how to shrink it', async () => {
    const { host: h } = host({});
    const run = await runProgram(h, `return "x".repeat(${RESULT_CAP + 500});`);
    const text = renderExecution(run);
    assert.ok(text.length < RESULT_CAP + 200);
    assert.equal(JSON.parse(text).truncated, true);
  });
});

it('a timeout reports unknown calls after an in-flight read and clears its timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let readStarted = false;
  const loader = {
    load: () => ({
      getEntrypoint: () => ({
        fetch: async () => {
          readStarted = true;
          return new Promise<Response>(() => {});
        },
      }),
    }),
  } as unknown as WorkerLoader;
  const { host: h } = host({});
  const pending = runProgram({ ...h, loader }, 'return await arcmira.status({});');
  assert.equal(readStarted, true);
  t.mock.timers.tick(30001);
  const outcome = await pending;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.calls, null);
  assert.equal(outcome.outcome_uncertain, true);
  assert.match(JSON.parse(renderExecution(outcome)).error.message, /may still finish/);
});

it('module-level injected code cannot capture unmetered fetch', async () => {
  const { host: h, outbound } = host({ '/v1/me': () => Response.json({ id: 'caller' }) });
  const run = await runProgram(
    h,
    `
return await Promise.all(Array.from({length:41},()=>unmetered('https://api.arcmira.com/v1/me')));
};
const unmetered = globalThis.fetch.bind(globalThis);
const unused = () => {
`,
  );
  assert.equal(outbound.urls.length, 40);
  assert.equal(run.calls, 40);
  assert.equal(run.ok, false);
  if (!run.ok) assert.equal(run.error.code, 'call_budget');
});

it('bounds a computed large result before it crosses the sandbox boundary', async () => {
  const { host: h } = host({});
  const run = await runProgram(
    h,
    'return { state: "pending", next_cursor: "opaque-next", text: "x".repeat(5_000_000) };',
  );
  assert.ok(JSON.stringify(run).length < RESULT_CAP);
  assert.equal(run.truncated, true);
  if (run.ok) assert.deepEqual(run.value, { state: 'pending', next_cursor: 'opaque-next', text: 'x'.repeat(3000) });
});

it('large non-JSON primitive conversion is bounded inside the isolate', async () => {
  const { host: h } = host({});
  const run = await runProgram(h, 'return Symbol("x".repeat(21000));');
  assert.ok(JSON.stringify(run).length < RESULT_CAP);
  assert.equal(run.truncated, true);
});

it('a page cut by the output budget recovers every row by rerunning with fewer fields, then paginating', async () => {
  const ids = Array.from({ length: 200 }, (_, i) => `row-${i + 1}`);
  const pages: Record<string, { data: Array<{ id: string; description: string }>; has_more: boolean; next_cursor: string | null }> = {
    first: { data: ids.slice(0, 100).map((id) => ({ id, description: 'A'.repeat(600) })), has_more: true, next_cursor: 'after-row-100' },
    'after-row-100': { data: ids.slice(100).map((id) => ({ id, description: 'A'.repeat(600) })), has_more: false, next_cursor: null },
  };
  const { host: h, outbound } = host({ '/v1/mentions': (url) => Response.json(pages[url.searchParams.get('cursor') ?? 'first']) });

  const whole = JSON.parse(renderExecution(await runProgram(h, 'return await arcmira.mentions({ entityId: "ent_14", limit: 100 });')));
  assert.equal(whole.truncated, true);
  assert.ok(whole.value.data.length < 100);
  assert.deepEqual(whole.truncated_arrays, [{ path: 'value.data', returned: whole.value.data.length, total: 100 }]);
  assert.doesNotMatch(whole.recovery, /continue with the returned next_cursor/i);
  assert.match(whole.recovery, /same call/i);
  assert.match(whole.recovery, /fewer fields/i);
  assert.match(whole.recovery, /restart pagination/i);

  const collected: string[] = [];
  let cursor: string | null = null;
  do {
    const args = JSON.stringify({ entityId: 'ent_14', limit: 100, ...(cursor ? { cursor } : {}) });
    const page = JSON.parse(
      renderExecution(await runProgram(h, `const p = await arcmira.mentions(${args}); return { ids: p.data.map(r => r.id), has_more: p.has_more, next_cursor: p.next_cursor };`)),
    );
    assert.equal(page.truncated, false);
    assert.equal(page.recovery, undefined);
    collected.push(...page.value.ids);
    cursor = page.value.has_more ? page.value.next_cursor : null;
  } while (cursor !== null);
  assert.deepEqual(collected, ids);
  assert.deepEqual(outbound.urls.map((u) => u.searchParams.get('cursor')), [null, null, 'after-row-100']);
});

/** Wraps a loader so the program's response streams in 16 KB chunks and counts the bytes the parent pulls. */
function countingLoader(inner: WorkerLoader, pulled: { bytes: number }): WorkerLoader {
  return {
    load(code: WorkerLoaderWorkerCode) {
      const stub = inner.load(code);
      return {
        getEntrypoint: () => ({
          async fetch(input: string) {
            const response = await stub.getEntrypoint().fetch(input);
            const reader = response.body!.getReader();
            let pending: Uint8Array = new Uint8Array(0);
            const body = new ReadableStream<Uint8Array>(
              {
                async pull(controller) {
                  while (pending.byteLength === 0) {
                    const { done, value } = await reader.read();
                    if (done) return controller.close();
                    pending = value;
                  }
                  const chunk = pending.subarray(0, 16_384);
                  pending = pending.subarray(chunk.byteLength);
                  pulled.bytes += chunk.byteLength;
                  controller.enqueue(chunk);
                },
                cancel: (reason) => reader.cancel(reason),
              },
              { highWaterMark: 0 },
            );
            return new Response(body, { headers: response.headers });
          },
        }),
      };
    },
  } as unknown as WorkerLoader;
}

it('caps the parent read when user code defeats the in-isolate bound', async () => {
  const pulled = { bytes: 0 };
  const { host: h } = host({});
  const slice = String.prototype.slice;
  let run;
  try {
    run = await runProgram(
      { ...h, loader: countingLoader(h.loader, pulled) },
      'String.prototype.slice = function () { return String(this); }; return "x".repeat(60_000_000);',
    );
  } finally {
    String.prototype.slice = slice;
  }
  assert.equal(run.ok, false);
  if (!run.ok) assert.equal(run.error.code, 'sandbox_error');
  assert.equal(run.calls, 0);
  assert.ok(pulled.bytes <= 65_536 + 16_384, `parent pulled ${pulled.bytes} bytes`);
  assert.ok(renderExecution(run).length < RESULT_CAP);
});

it('refuses a sandbox response whose declared length is over the cap without reading it', async () => {
  let read = false;
  const body = new ReadableStream({ pull() { read = true; } }, { highWaterMark: 0 });
  const headers = { 'content-length': '70000', 'x-execution-calls': '1', 'x-execution-completed': '1' };
  const loader = { load: () => ({ getEntrypoint: () => ({ fetch: async () => new Response(body, { headers }) }) }) } as unknown as WorkerLoader;
  const { host: h } = host({});
  const run = await runProgram({ ...h, loader }, 'return 1;');
  assert.equal(run.ok, false);
  if (!run.ok) assert.equal(run.error.code, 'sandbox_error');
  assert.equal(run.calls, 1);
  assert.equal(read, false);
});

it('an honest result at the render cap in three-byte characters fits under the parent read cap', async () => {
  const { host: h } = host({});
  const run = await runProgram(h, 'return { ["€".repeat(110)]: 1, rows: Array.from({ length: 100 }, () => "€".repeat(3000)) };');
  assert.equal(run.ok, true);
  assert.equal(run.truncated, true);
});
