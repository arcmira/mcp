import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pkg from '../package.json' with { type: 'json' };
import worker from '../src/index.ts';
import { listingOf } from '../src/api.ts';
import { challenge, protectedResourceMetadata } from '../src/auth.ts';
import { hostLoadLines, type HostLoadContext } from '../src/host-load.ts';
import { TOOL_CALLS_PATH } from '../src/telemetry.ts';
import { fakeLoader } from './fake-loader.ts';
import { callTool, listTools, textOf, withFetch } from './handler.ts';

const TAG = 'x-arcmira-listing';
const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';

interface Sent {
  route: string;
  tag: string | null;
}

/** An API that answers every read, and records each request's route and source tag. */
function api(sent: Sent[]) {
  return (url: URL, init?: RequestInit): Response => {
    sent.push({ route: `${init?.method ?? 'GET'} ${url.pathname}`, tag: new Headers(init?.headers).get(TAG) });
    if (url.pathname === TOOL_CALLS_PATH) return new Response(null, { status: 202 });
    return Response.json({ best: { id: 'ent_14', name: 'TBPN', youtube_channel_id: TBPN }, chunks: [], state: 'ready', lines: [] });
  };
}

const RECORD = `POST ${TOOL_CALLS_PATH}`;
const SEARCH = { query: 'corporate cards', channel: ['TBPN'] };
const PROGRAM = { code: 'await arcmira.status({}); return (await fetch("https://api.arcmira.com/v1/me", { headers: { "x-arcmira-listing": "dir-other" } })).status;' };

// The Worker checks an account key once per isolate. Listing the tools first keeps that check out of every recording below.
before(() => listTools());

describe('listingOf', () => {
  it('reads one tag-shaped value and nothing else', () => {
    const of = (query: string) => listingOf(new URL(`https://mcp.arcmira.com/mcp${query}`));
    assert.equal(of('?listing=dir-example'), 'dir-example');
    assert.equal(of('?other=1&listing=agent-setup'), 'agent-setup');
    for (const query of ['', '?listing=', '?listing=Dir-Glama', '?listing=dir%20glama', '?listing=dir-example&listing=dir-second', `?listing=${'a'.repeat(41)}`, '?listing=-dir', '?listing=a%0d%0ab', '?LISTING=dir-example']) {
      assert.equal(of(query), null, query);
    }
  });
});

describe('the source tag on the address goes to the API with every call', () => {
  for (const path of ['/mcp', '/mcp/apps']) {
    it(`on ${path}?listing=dir-example, each API request of a search carries x-arcmira-listing: dir-example`, async () => {
      const sent: Sent[] = [];
      const reply = await callTool('arcmira_youtube_search', SEARCH, api(sent), {}, `${path}?listing=dir-example`);
      assert.equal(reply.result.isError, undefined, textOf(reply));
      const reads = sent.filter((request) => request.route !== RECORD);
      assert.ok(reads.length > 0);
      for (const request of reads) assert.equal(request.tag, 'dir-example', request.route);
    });
  }

  it('each request of a program carries the tag of the address, whatever header the program sets itself', async () => {
    const sent: Sent[] = [];
    const reply = await callTool('arcmira_execute_read', PROGRAM, api(sent), { LOADER: fakeLoader() }, '/mcp?listing=dir-example');
    assert.equal(reply.result.isError, undefined, textOf(reply));
    const reads = sent.filter((request) => request.route !== RECORD);
    assert.equal(reads.length, 2, 'one request from the client method and one from the raw fetch');
    for (const request of reads) assert.equal(request.tag, 'dir-example', request.route);
  });

  for (const query of ['', '?listing=Not%20A%20Tag', '?listing=dir-example&listing=dir-second']) {
    it(`an address with ${query === '' ? 'no tag' : query} sends no x-arcmira-listing, from a tool or from a program`, async () => {
      const sent: Sent[] = [];
      const search = await callTool('arcmira_youtube_search', SEARCH, api(sent), {}, `/mcp${query}`);
      const program = await callTool('arcmira_execute_read', PROGRAM, api(sent), { LOADER: fakeLoader() }, `/mcp${query}`);
      assert.equal(search.result.isError, undefined, textOf(search));
      assert.equal(program.result.isError, undefined, textOf(program));
      assert.ok(sent.length > 2);
      for (const request of sent) assert.equal(request.tag, null, request.route);
    });
  }
});

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`https://mcp.arcmira.com${path}`), {}, ctx);
}

describe('the source tag stays on the address through sign-in', () => {
  it('a request to /mcp?listing=dir-example with no credential is pointed at a document that names the tagged address', async () => {
    const response = await get('/mcp?listing=dir-example');
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer resource_metadata="https://mcp.arcmira.com/.well-known/oauth-protected-resource?listing=dir-example"');
    for (const path of ['/.well-known/oauth-protected-resource?listing=dir-example', '/.well-known/oauth-protected-resource/mcp?listing=dir-example']) {
      const doc = (await (await get(path)).json()) as { resource: string; authorization_servers: string[] };
      assert.equal(doc.resource, 'https://mcp.arcmira.com/mcp?listing=dir-example', path);
      assert.deepEqual(doc.authorization_servers, ['https://api.arcmira.com']);
    }
  });

  it('the bare address, and an address whose tag is not shaped like one, get the bare challenge and document', async () => {
    for (const query of ['', '?listing=Not%20A%20Tag', '?listing=dir-example&listing=dir-second']) {
      const response = await get(`/mcp${query}`);
      assert.equal(response.headers.get('www-authenticate'), 'Bearer resource_metadata="https://mcp.arcmira.com/.well-known/oauth-protected-resource"', query);
      const doc = (await (await get(`/.well-known/oauth-protected-resource${query}`)).json()) as { resource: string };
      assert.equal(doc.resource, 'https://mcp.arcmira.com/mcp', query);
    }
  });

  it('/mcp/apps keeps its bare address at sign-in, since the API accepts a tagged resource for /mcp alone', async () => {
    const response = await get('/mcp/apps?listing=dir-example');
    assert.equal(response.headers.get('www-authenticate'), 'Bearer resource_metadata="https://mcp.arcmira.com/.well-known/oauth-protected-resource/mcp/apps", scope="read offline_access"');
    const doc = (await (await get('/.well-known/oauth-protected-resource/mcp/apps?listing=dir-example')).json()) as { resource: string };
    assert.equal(doc.resource, 'https://mcp.arcmira.com/mcp/apps');
    // The two builders hold the rule themselves, so a caller that hands them a tag for /mcp/apps still gets the bare address.
    assert.equal(protectedResourceMetadata('https://mcp.arcmira.com', {}, '/mcp/apps', 'dir-example').resource, 'https://mcp.arcmira.com/mcp/apps');
    assert.equal(challenge('https://mcp.arcmira.com', 'no_credential', '/mcp/apps', 'dir-example').headers.get('www-authenticate'), response.headers.get('www-authenticate'));
  });
});

/** One JSON-RPC message through the Worker's fetch, with every line the Worker logs while it answers. */
async function send(
  path: string,
  message: unknown,
  options: { key: string | null; upstream: (url: URL) => Response; headers?: Record<string, string>; env?: Record<string, unknown>; body?: ReadableStream<Uint8Array> },
): Promise<{ response: Response; lines: Array<Record<string, unknown>> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...options.headers };
  if (options.key !== null) headers.authorization = `Bearer ${options.key}`;
  const request = new Request(`https://mcp.arcmira.com${path}`, { method: 'POST', headers, body: options.body ?? JSON.stringify(message), ...(options.body ? { duplex: 'half' } : {}) } as RequestInit);
  // The Worker writes its lines inside waitUntil, after the answer. The test waits for them, as the runtime does.
  const deferred: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => deferred.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const lines: Array<Record<string, unknown>> = [];
  const log = console.log;
  console.log = (...args: unknown[]) => {
    try {
      const line = JSON.parse(String(args[0])) as Record<string, unknown>;
      if (typeof line.event === 'string') lines.push(line);
    } catch {
      log(...args);
    }
  };
  try {
    const response = await withFetch(options.upstream, async () => {
      const answer = await worker.fetch(request, options.env ?? {}, ctx);
      await answer.clone().text();
      await Promise.all(deferred);
      return answer;
    });
    return { response, lines };
  } finally {
    console.log = log;
  }
}

const INITIALIZE = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-host', version: '1.2' } } };
const TOOLS_LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const keyApi = (url: URL) => (url.pathname === '/v1/me' ? Response.json({ account: { id: 'acct_fixture' } }) : Response.json({}));

describe('a host that loads the server leaves one log line per step', () => {
  it('initialize with an account key logs the account, the host, the release and the tag', async () => {
    const { response, lines } = await send('/mcp?listing=dir-example', INITIALIZE, {
      key: 'arc_sk_host_load_one',
      upstream: keyApi,
      headers: { 'user-agent': 'test-agent/9.9 (linux)' },
      env: { CF_VERSION_METADATA: { id: 'deploy_fixture', tag: '', timestamp: '' } },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(lines, [
      {
        event: 'mcp_host_initialize',
        account_id: 'acct_fixture',
        user_id: null,
        oauth_client_id: null,
        client: 'test-host/1.2',
        agent: 'test-agent/9.9',
        release: pkg.version,
        deploy: 'deploy_fixture',
        path: '/mcp',
        listing: 'dir-example',
      },
    ]);
  });

  it('tools/list with a sign-in logs the person and the registered client, and the host header when the host sends one', async () => {
    const session = (url: URL) =>
      url.pathname === '/api/auth/mcp/get-session'
        ? Response.json({ id: 'tok', clientId: 'client_fixture', userId: 'user_fixture', accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString() })
        : Response.json({});
    const { response, lines } = await send('/mcp/apps', TOOLS_LIST, { key: 'HostLoadTokenAAAAAAAAAAAAAAAAAAA', upstream: session, headers: { 'x-arcmira-client': 'named-host/3' } });
    assert.equal(response.status, 200);
    assert.deepEqual(lines, [
      {
        event: 'mcp_host_tools_list',
        account_id: null,
        user_id: 'user_fixture',
        oauth_client_id: 'client_fixture',
        client: 'named-host/3',
        agent: null,
        release: pkg.version,
        deploy: null,
        path: '/mcp/apps',
        listing: null,
      },
    ]);
  });

  it('a tool call, a notification and a refused credential log no line', async () => {
    const call = await send('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'arcmira_describe', arguments: {} } }, { key: 'arc_sk_host_load_one', upstream: keyApi });
    assert.equal(call.response.status, 200);
    assert.deepEqual(call.lines, []);
    const note = await send('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, { key: 'arc_sk_host_load_one', upstream: keyApi });
    assert.deepEqual(note.lines, []);
    const refused = await send('/mcp', INITIALIZE, { key: 'arc_sk_host_load_bad', upstream: () => Response.json({ error: { code: 'invalid_api_key', reason: 'invalid' } }, { status: 401 }) });
    assert.equal(refused.response.status, 401);
    assert.deepEqual(refused.lines, []);
    const keyless = await send('/mcp', INITIALIZE, { key: null, upstream: keyApi });
    assert.equal(keyless.response.status, 401);
    assert.deepEqual(keyless.lines, []);
  });

  it('a request the server refuses for its Origin is answered before its body ends, and logs no line', async () => {
    for (const path of ['/mcp/apps', '/mcp/apps?listing=dir-example']) {
      let cancel!: () => void;
      const unfinished = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"initialize",'));
          cancel = () => controller.close();
        },
      });
      const sent = send(path, null, { key: 'arc_sk_host_load_one', upstream: keyApi, headers: { origin: 'https://not-allowed.example' }, body: unfinished });
      const answered = await Promise.race([sent, new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000))]);
      cancel();
      assert.notEqual(answered, null, `${path} waited for the body to end`);
      assert.equal(answered!.response.status, 403, path);
      assert.deepEqual(answered!.lines, [], path);
    }
  });

  it('a host name from the x-arcmira-client header is cut to 120 characters, like one from clientInfo', async () => {
    const { lines } = await send('/mcp', TOOLS_LIST, { key: 'arc_sk_host_load_one', upstream: keyApi, headers: { 'x-arcmira-client': 'h'.repeat(9_000) } });
    assert.equal(lines.length, 1);
    assert.equal((lines[0]!.client as string).length, 120);
  });

  it('a runtime that cannot defer work still answers the host', async () => {
    const request = new Request('https://mcp.arcmira.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer arc_sk_host_load_one' },
      body: JSON.stringify(TOOLS_LIST),
    });
    const broken = {
      waitUntil() {
        throw new Error('waitUntil unavailable');
      },
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext;
    const response = await withFetch(keyApi, () => worker.fetch(request, {}, broken));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /arcmira_describe/);
  });

  it('a key the API will not confirm right now still opens the connection, and its line names no account', async () => {
    const { response, lines } = await send('/mcp', INITIALIZE, { key: 'arc_sk_host_load_over', upstream: () => Response.json({ error: { code: 'quota_exceeded' } }, { status: 402 }) });
    assert.equal(response.status, 200);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.account_id, null);
    assert.equal(lines[0]!.client, 'test-host/1.2');
  });
});

describe('hostLoadLines', () => {
  const context: HostLoadContext = { account_id: 'a', user_id: null, oauth_client_id: null, client: 'header-host/1', agent: null, release: '0', deploy: null, path: '/mcp', listing: null };

  it('reads each initialize and tools/list in a batch, and takes the host from clientInfo when the message has one', () => {
    const lines = hostLoadLines([INITIALIZE, { method: 'tools/call' }, TOOLS_LIST], context);
    assert.deepEqual(lines.map((line) => [line.event, line.client]), [['mcp_host_initialize', 'test-host/1.2'], ['mcp_host_tools_list', 'header-host/1']]);
  });

  it('has no line for a body that is not a message, and no host from a clientInfo that is not one', () => {
    for (const body of [null, 'initialize', 7, [], [null, 'x'], {}, { method: 7 }, { method: 'toString' }, { method: 'constructor' }]) assert.deepEqual(hostLoadLines(body, context), [], JSON.stringify(body));
    for (const params of [null, 'x', {}, { clientInfo: 'x' }, { clientInfo: { name: 7 } }, { clientInfo: { name: '' } }]) {
      assert.equal(hostLoadLines({ method: 'initialize', params }, context)[0]!.client, 'header-host/1', JSON.stringify(params));
    }
    assert.equal(hostLoadLines({ method: 'initialize', params: { clientInfo: { name: 'n'.repeat(300) } } }, context)[0]!.client?.length, 120);
    assert.equal(hostLoadLines(TOOLS_LIST, { ...context, client: 'h'.repeat(300) })[0]!.client?.length, 120);
  });
});
