import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { OPENAI_APPS_CHALLENGE, OPENAI_APPS_CHALLENGE_PATH } from '../src/openai-challenge.ts';

const context = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const get = (path: string, method = 'GET') => worker.fetch(new Request(`https://mcp.arcmira.com${path}`, { method }), {} as never, context);

describe("OpenAI's domain check", () => {
  it('answers the issued token as the whole body, in plain text', async () => {
    assert.equal(OPENAI_APPS_CHALLENGE_PATH, '/.well-known/openai-apps-challenge');
    const response = await get(OPENAI_APPS_CHALLENGE_PATH);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/plain/);
    assert.equal(await response.text(), 'y8wT9QBmMKOJz8MYWNTaOOrBraLHwLeGUrDan5jf8Bc');
    assert.equal(OPENAI_APPS_CHALLENGE, 'y8wT9QBmMKOJz8MYWNTaOOrBraLHwLeGUrDan5jf8Bc');
  });

  it('answers it without a credential, and nowhere else', async () => {
    assert.equal((await get(OPENAI_APPS_CHALLENGE_PATH, 'HEAD')).status, 200);
    assert.equal((await get(`${OPENAI_APPS_CHALLENGE_PATH}/x`)).status, 404);
    assert.equal((await get('/.well-known/openai-apps-challenge.txt')).status, 404);
  });
});

describe('the entry module', () => {
  it('exports only what workerd loads as an entrypoint', async () => {
    // workerd treats every named export of the entry module as an entrypoint and refuses to start on anything else.
    assert.deepEqual(Object.keys(await import('../src/index.ts')).sort(), ['ApiOutbound', 'default']);
  });
});
