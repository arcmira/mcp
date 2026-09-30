import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RESULT_CAP, programModule, renderExecution, runProgram } from '../src/sandbox.ts';
import { fakeLoader, fakeOutbound } from './fake-loader.ts';

const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';

function host(answers: Parameters<typeof fakeOutbound>[0]) {
  const outbound = fakeOutbound(answers);
  return { host: { loader: fakeLoader(), outbound, apiBase: 'https://api.arcmira.com' }, outbound };
}

describe('the sandbox program', () => {
  it('runs the code as an async function body with arcmira in scope and returns lines, value and the meter', async () => {
    const { host: h, outbound } = host({ '/v1/entities/ent_14/momentum': () => Response.json({ verdict: 'flat' }, { headers: { 'ratelimit-limit': '20', 'ratelimit-remaining': '19', 'ratelimit-reset': '5' } }) });
    const run = await runProgram(h, 'console.log("start", 1); const m = await arcmira.momentum("ent_14"); return { v: m.verdict };');
    assert.deepEqual(run, { ok: true, value: { v: 'flat' }, lines: ['start 1'], calls: 1, rate_limit: { limit: 20, remaining: 19, reset: 5 }, api_build: null });
    assert.equal(outbound.urls[0]?.pathname, '/v1/entities/ent_14/momentum');
    assert.equal(renderExecution(run), 'start 1\nRETURN: {"v":"flat"}');
  });

  it('reports an id_required throw as ERROR with the code, before any call', async () => {
    const { host: h, outbound } = host({});
    const run = await runProgram(h, `return await arcmira.sponsors("TBPN");`);
    assert.equal(run.ok, false);
    if (run.ok) return;
    assert.equal(run.error.code, 'id_required');
    assert.match(run.error.message, /arcmira\.resolve/);
    assert.equal(outbound.urls.length, 0);
    assert.match(renderExecution(run), /^ERROR: \{"name":"ArcmiraError","code":"id_required"/);
  });

  it('forwards a gate with its unlock', async () => {
    const { host: h } = host({ [`/v1/channels/${TBPN}/sponsors`]: () => Response.json({ error: { code: 'filter_requires_paid', message: 'Pro+', unlock: { tier: 'pro_plus', url: 'https://arcmira.com/pricing' } } }, { status: 403 }) });
    const run = await runProgram(h, `return await arcmira.sponsors("${TBPN}", { status: "active" });`);
    assert.equal(run.ok, false);
    if (run.ok) return;
    assert.equal(run.error.code, 'filter_requires_paid');
    assert.deepEqual(run.error.unlock, { tier: 'pro_plus', url: 'https://arcmira.com/pricing' });
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
    assert.equal(renderExecution(silent), '(no output: the program printed nothing and returned nothing)');
  });

  it('caps the rendered output and says how to shrink it', async () => {
    const { host: h } = host({});
    const run = await runProgram(h, `return "x".repeat(${RESULT_CAP + 500});`);
    const text = renderExecution(run);
    assert.ok(text.length < RESULT_CAP + 200);
    assert.match(text, /\[truncated 508 characters; return fewer fields or a smaller limit\]$/);
  });

  it('the module hands the program only arcmira, ArcmiraError and console', () => {
    const source = programModule('return typeof ArcmiraError;');
    assert.match(source, /async \(arcmira, ArcmiraError, console\) => \{\nreturn typeof ArcmiraError;/);
    assert.match(source, /import \{ createArcmira, ArcmiraError \} from '\.\/client\.js'/);
  });
});
