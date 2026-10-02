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
