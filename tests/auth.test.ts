import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROTECTED_RESOURCE_PATH, challenge, isOAuthBearer, protectedResourceMetadata, tokenIsLive } from '../src/auth.ts';

function withFetch<T>(handler: (url: URL, init: RequestInit) => Response, body: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => handler(new URL(String(input)), init ?? {})) as typeof fetch;
  return body().finally(() => {
    globalThis.fetch = original;
  });
}

describe('isOAuthBearer', () => {
  it('is anything that is not an Arcmira key', () => {
    assert.equal(isOAuthBearer('AbCdEfGhIjKlMnOpQrStUvWxYz012345'), true);
    assert.equal(isOAuthBearer('arc_sk_abc'), false);
    assert.equal(isOAuthBearer('arc_tk_abc'), false);
    assert.equal(isOAuthBearer(null), false);
  });
});

describe('challenge', () => {
  it('is a 401 naming the protected-resource document, with the mint action still in the body', async () => {
    const response = challenge('https://mcp.arcmira.com');
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), `Bearer resource_metadata="https://mcp.arcmira.com${PROTECTED_RESOURCE_PATH}"`);
    assert.equal(response.headers.get('access-control-expose-headers'), 'WWW-Authenticate');
    const body = (await response.json()) as { jsonrpc: string; error: { code: number; data: { code: string; unlock: { action: { kind: string } } } } };
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.error.code, -32000);
    assert.equal(body.error.data.code, 'invalid_api_key');
    assert.equal(body.error.data.unlock.action.kind, 'mint_trial_key');
  });
});

describe('protectedResourceMetadata', () => {
  it('names the MCP endpoint as the resource and the API as the authorization server', () => {
    const doc = protectedResourceMetadata('https://mcp.arcmira.com', {});
    assert.equal(doc.resource, 'https://mcp.arcmira.com/mcp');
    assert.deepEqual(doc.authorization_servers, ['https://api.arcmira.com']);
    assert.deepEqual(doc.bearer_methods_supported, ['header']);
    const local = protectedResourceMetadata('http://localhost:8790', { ARCMIRA_API_BASE: 'http://localhost:8787/' });
    assert.deepEqual(local.authorization_servers, ['http://localhost:8787']);
  });
});

describe('tokenIsLive', () => {
  const env = { ARCMIRA_API_BASE: 'https://api.test' };

  it('asks the session endpoint once with the bearer, answers from cache until the token expires, then asks again', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const now = Date.parse('2026-09-02T12:00:00Z');
    const result = await withFetch(
      (url, init) => {
        calls.push({ url, init });
        return Response.json({ id: 'tok', accessTokenExpiresAt: '2026-09-02T12:02:00Z' });
      },
      async () => {
        const first = await tokenIsLive('LiveTokenAAAAAAAAAAAAAAAAAAAAAAA', env, now);
        const second = await tokenIsLive('LiveTokenAAAAAAAAAAAAAAAAAAAAAAA', env, now + 60_000);
        const afterExpiry = await tokenIsLive('LiveTokenAAAAAAAAAAAAAAAAAAAAAAA', env, now + 3 * 60_000);
        return { first, second, afterExpiry };
      },
    );
    assert.deepEqual(result, { first: true, second: true, afterExpiry: false });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url.toString(), 'https://api.test/api/auth/mcp/get-session');
    assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer LiveTokenAAAAAAAAAAAAAAAAAAAAAAA');
  });

  it('treats null, a non-2xx, or an already-expired row as not live and caches none of them', async () => {
    let answer: () => Response = () => Response.json(null);
    let count = 0;
    await withFetch(
      () => {
        count += 1;
        return answer();
      },
      async () => {
        assert.equal(await tokenIsLive('DeadTokenAAAAAAAAAAAAAAAAAAAAAAA', env), false);
        answer = () => new Response('nope', { status: 401 });
        assert.equal(await tokenIsLive('DeadTokenAAAAAAAAAAAAAAAAAAAAAAA', env), false);
        answer = () => Response.json({ accessTokenExpiresAt: '2020-01-01T00:00:00Z' });
        assert.equal(await tokenIsLive('DeadTokenAAAAAAAAAAAAAAAAAAAAAAA', env), false);
      },
    );
    assert.equal(count, 3);
  });
});
