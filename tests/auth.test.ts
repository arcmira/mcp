import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
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
    assert.equal(isOAuthBearer(null), false);
  });
});

describe('challenge', () => {
  it('is a 401 naming the protected-resource document, with the signup action in the body', async () => {
    const response = challenge('https://mcp.arcmira.com');
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get('www-authenticate'),
      `Bearer resource_metadata="https://mcp.arcmira.com${PROTECTED_RESOURCE_PATH}"`,
    );
    assert.equal(response.headers.get('access-control-expose-headers'), 'WWW-Authenticate');
    const body = (await response.json()) as {
      jsonrpc: string;
      error: {
        code: number;
        data: {
          code: string;
          unlock: { url: string; action: { kind: string; url: string } };
        };
      };
    };
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.error.code, -32000);
    assert.equal(body.error.data.code, 'invalid_api_key');
    assert.equal((body.error.data as { reason?: string }).reason, 'no_credential');
    assert.equal(body.error.data.unlock.action.kind, 'send_signup_code');
    assert.equal(body.error.data.unlock.action.url, 'https://api.arcmira.com/v1/signups?src=mcp-tool');
    assert.equal(
      body.error.data.unlock.url,
      'https://arcmira.com/docs/authentication?src=mcp-tool#sign-up-from-the-api',
    );
  });
});

describe('protectedResourceMetadata', () => {
  it('names the MCP endpoint as the resource and the API as the authorization server', () => {
    const doc = protectedResourceMetadata('https://mcp.arcmira.com', {});
    assert.equal(doc.resource, 'https://mcp.arcmira.com/mcp');
    assert.deepEqual(doc.authorization_servers, ['https://api.arcmira.com']);
    assert.deepEqual(doc.bearer_methods_supported, ['header']);
    const local = protectedResourceMetadata('http://localhost:8790', {
      ARCMIRA_API_BASE: 'http://localhost:8787/',
    });
    assert.deepEqual(local.authorization_servers, ['http://localhost:8787']);
  });

  it('advertises the write scopes arcmira_execute_write needs, so hosts request them at sign-in', () => {
    const scopes = protectedResourceMetadata('https://mcp.arcmira.com', {}).scopes_supported as string[];
    for (const scope of ['read', 'monitors:write', 'trackers:write']) assert.ok(scopes.includes(scope), scope);
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
        return Response.json({
          id: 'tok',
          accessTokenExpiresAt: '2026-09-02T12:02:00Z',
        });
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

/** One initialize handshake through the Worker's fetch, the way a host opens the connection. */
function initialize(key: string | null, upstream: (url: URL) => Response): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  const request = new Request('https://mcp.arcmira.com/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    }),
  });
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  return withFetch(upstream, () => worker.fetch(request, { ARCMIRA_API_BASE: 'https://api.test' }, ctx));
}

/** Every challenge mints its own request_id, so the rest of the body is what two of them share. */
async function challengeBody(response: Response): Promise<unknown> {
  const body = (await response.json()) as {
    error: { data: { request_id?: string } };
  };
  assert.match(body.error.data.request_id ?? '', /^mcp_/);
  delete body.error.data.request_id;
  return body;
}

function me(status: number, body: Record<string, unknown> = { id: 'usr_1' }): (url: URL) => Response {
  return (url) => (url.pathname === '/v1/me' ? Response.json(body, { status }) : Response.json({}));
}

describe('the handshake checks the account key', () => {
  it('opens the connection for a key the API knows', async () => {
    const response = await initialize('arc_sk_live_one', me(200));
    assert.equal(response.status, 200);
  });

  it('answers a key the API does not know with the same header and a body that says the key was refused', async () => {
    const response = await initialize('arc_sk_garbage', me(401, { error: { code: 'invalid_api_key', reason: 'invalid' } }));
    const keyless = challenge('https://mcp.arcmira.com');
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), keyless.headers.get('www-authenticate'));
    assert.deepEqual(await challengeBody(response), await challengeBody(challenge('https://mcp.arcmira.com', 'invalid')));
    const body = (await challenge('https://mcp.arcmira.com', 'invalid').json()) as { error: { data: { reason: string; message: string } } };
    assert.equal(body.error.data.reason, 'invalid');
    assert.notEqual(body.error.data.message, ((await keyless.json()) as { error: { data: { message: string } } }).error.data.message);
  });

  it('carries revoked through from v1', async () => {
    const response = await initialize('arc_sk_old', me(401, { error: { code: 'invalid_api_key', reason: 'revoked' } }));
    assert.equal(response.status, 401);
    assert.deepEqual(await challengeBody(response), await challengeBody(challenge('https://mcp.arcmira.com', 'revoked')));
    const body = (await challenge('https://mcp.arcmira.com', 'revoked').json()) as { error: { data: { message: string } } };
    assert.equal(body.error.data.message, 'The key sent has been revoked. Create a new key at https://arcmira.com/dashboard/api and send it with Authorization: Bearer.');
  });

  it('answers no key at all with that same challenge', async () => {
    const response = await initialize(null, me(200));
    const keyless = challenge('https://mcp.arcmira.com');
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), keyless.headers.get('www-authenticate'));
    assert.deepEqual(await challengeBody(response), await challengeBody(keyless));
  });

  it('asks /v1/me once for five minutes of handshakes', async () => {
    let asks = 0;
    const upstream = (url: URL) => {
      if (url.pathname === '/v1/me') asks += 1;
      return Response.json({ id: 'usr_2' });
    };
    await initialize('arc_sk_cached', upstream);
    await initialize('arc_sk_cached', upstream);
    assert.equal(asks, 1);
  });

  it('lets an over-quota key through, so the first tool call renders the real gate', async () => {
    const response = await initialize('arc_sk_quota', me(402, { error: { code: 'over_quota' } }));
    assert.equal(response.status, 200);
  });
});

describe('authentication availability is not a credential verdict', () => {
  for (const prefix of ['arc_sk_', 'OAuth'])
    for (const status of [429, 503]) {
      it(`preserves ${status} for ${prefix} without a reconnect challenge`, async () => {
        const response = await initialize(`${prefix}${status}availability`, () =>
          Response.json({ error: { code: 'upstream_busy' } }, { status, headers: { 'retry-after': '9' } }),
        );
        assert.equal(response.status, status);
        assert.equal(response.headers.get('www-authenticate'), null);
        assert.equal(response.headers.get('retry-after'), '9');
      });
    }
  it('refuses a bearer redirect during OAuth validation', async () => {
    let targetCalls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('evil.invalid')) targetCalls++;
      assert.equal(init?.redirect, 'manual');
      return new Response(null, {
        status: 302,
        headers: { location: 'https://evil.invalid/token' },
      });
    };
    try {
      await assert.rejects(tokenIsLive('OAuthRedirectUnique', {}), /temporarily unavailable/);
      assert.equal(targetCalls, 0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

it('unreadable OAuth verification remains a temporary outage', async () => {
  await withFetch(
    () => new Response('not-json', { headers: { 'retry-after': '7' } }),
    () => assert.rejects(tokenIsLive('malformed-oauth-response', {}), /temporarily unavailable/),
  );
});
