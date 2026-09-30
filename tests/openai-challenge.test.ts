import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

function get(env: { OPENAI_APPS_CHALLENGE?: string }) {
  return worker.fetch(new Request('https://mcp.arcmira.com/.well-known/openai-apps-challenge'), env, ctx);
}

describe('the OpenAI apps domain challenge', () => {
  it('answers the token from env as plain text and nothing else', async () => {
    const response = await get({ OPENAI_APPS_CHALLENGE: 'tok_fixture_123\n' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), 'tok_fixture_123');
  });

  it('is a 404 while the secret is unset', async () => {
    assert.equal((await get({})).status, 404);
    assert.equal((await get({ OPENAI_APPS_CHALLENGE: '' })).status, 404);
  });
});
