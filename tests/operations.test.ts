import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createApiClient } from '../src/api.ts';
import { createOperationServer } from '../src/operations/server.ts';

async function connect(run: (client: Client) => Promise<void>, authenticated = true) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createOperationServer(authenticated ? createApiClient({ ARCMIRA_API_BASE: 'https://api.example.test' }, 'arc_sk_test') : null);
  const client = new Client({ name: 'operation-test', version: '1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await run(client); } finally { await client.close(); await server.close(); }
}

const readCases = [
  ['get_me', {}, '/v1/me', {}],
  ['resolve_entity', { q: 'Acme', type: 'organization' }, '/v1/entities/resolve', { q: 'Acme', type: 'organization' }],
  ['get_entity', { id: 'ent_14' }, '/v1/entities/ent_14', {}],
  ['search', { q: 'energy', by: 'ent_14', limit: 2, source: 'arcmira_premium' }, '/v1/search', { q: 'energy', by: 'ent_14', limit: '2', source: 'arcmira_premium' }],
  ['list_mentions', { entity_id: 'ent_14', is_appearance: true }, '/v1/mentions', { entity_id: 'ent_14', is_appearance: 'true' }],
  ['list_recommendations', { entity_id: 'ent_14', class: 'organic' }, '/v1/recommendations', { entity_id: 'ent_14', class: 'organic' }],
  ['list_channel_sponsors', { channel_id: 'UC-DRzaGnL_vtBUpCFH5M0tg', min_ad_reads: 3 }, '/v1/channels/UC-DRzaGnL_vtBUpCFH5M0tg/sponsors', { min_ad_reads: '3' }],
  ['get_entity_momentum', { id: 'ent_14' }, '/v1/entities/ent_14/momentum', {}],
  ['get_channel_coverage', { channel_id: 'UC-DRzaGnL_vtBUpCFH5M0tg' }, '/v1/channels/UC-DRzaGnL_vtBUpCFH5M0tg/coverage', {}],
  ['list_channel_videos', { channel_id: 'UC-DRzaGnL_vtBUpCFH5M0tg', after: '2026-09-01' }, '/v1/channels/UC-DRzaGnL_vtBUpCFH5M0tg/videos', { after: '2026-09-01' }],
  ['count_mentions', { entity_ids: 'ent_14' }, '/v1/mentions/counts', { entity_ids: 'ent_14' }],
  ['get_transcript', { video_id: 'dQw4w9WgXcQ', quality: 'premium', timestamps: false, retry: false }, '/v1/transcripts/dQw4w9WgXcQ', { quality: 'premium', timestamps: 'false', retry: 'false' }],
  ['quote_transcription', { video_id: 'dQw4w9WgXcQ' }, '/v1/transcripts/dQw4w9WgXcQ/quote', {}],
  ['list_monitors', {}, '/v1/monitors', {}],
  ['list_monitor_trackers', { id: 'mon/one' }, '/v1/monitors/mon%2Fone/trackers', {}],
  ['list_slack_integrations', {}, '/v1/integrations/slack', {}],
] as const;

const writeCases = [
  ['create_monitor', 'POST', '/v1/monitors', {}, { name: 'Sponsors', notify_frequency: 'daily' }],
  ['update_monitor', 'PATCH', '/v1/monitors/mon_one', { id: 'mon_one' }, { paused: true }],
  ['add_monitor_trackers', 'POST', '/v1/monitors/mon_one/trackers', { id: 'mon_one' }, { tracker_ids: ['trk_one'] }],
  ['add_monitor_entities', 'POST', '/v1/monitors/mon_one/entities', { id: 'mon_one' }, { entity_ids: ['ent_14'] }],
  ['submit_feedback', 'POST', '/v1/feedback', { type: 'experience', query: 'energy' }, { type: 'experience', category: 'missing', notes: 'No cited passage was returned.' }],
] as const;

describe('explicit operation MCP candidate', () => {
  it('exposes all 21 operations individually with effect annotations and no executor', async () => {
    await connect(async (client) => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), [...readCases, ...writeCases].map(([id]) => `arcmira_${id}`).sort());
      for (const tool of tools) {
        assert.ok(tool.description);
        for (const name of ['readOnlyHint', 'destructiveHint', 'openWorldHint'] as const) assert.equal(typeof tool.annotations?.[name], 'boolean');
        for (const name of ['code', 'intent', 'operation', 'url', 'api_key', 'src']) assert.equal(name in (tool.inputSchema.properties ?? {}), false);
      }
      const transcript = tools.find((t) => t.name === 'arcmira_get_transcript');
      assert.equal(transcript?.annotations?.readOnlyHint, false);
      assert.equal(transcript?.annotations?.destructiveHint, true);
      const search = tools.find((t) => t.name === 'arcmira_search');
      assert.equal(search?.annotations?.readOnlyHint, true);
      assert.equal(search?.annotations?.destructiveHint, false);
    });
  });

  for (const [id, args, path, expected] of readCases) {
    it(`${id} sends only its own bound route and preserves explicit filters`, async (t) => {
      const requests: URL[] = [];
      t.mock.method(globalThis, 'fetch', async (url: string | URL, init: RequestInit) => {
        const actual = new URL(url);
        requests.push(actual);
        assert.equal(actual.origin, 'https://api.example.test');
        assert.equal(actual.pathname, path);
        assert.equal(init.method, 'GET');
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer arc_sk_test');
        for (const [key, value] of Object.entries(expected)) assert.equal(actual.searchParams.get(key), value);
        assert.equal(actual.searchParams.get('src'), 'mcp-tool');
        return Response.json({ data: [{ text: 'A timestamped passage', start: 42 }] });
      });
      await connect(async (client) => {
        const result = await client.callTool({ name: `arcmira_${id}`, arguments: args });
        assert.notEqual(result.isError, true);
        assert.deepEqual(result.structuredContent, { data: [{ text: 'A timestamped passage', start: 42 }] });
      });
      assert.equal(requests.length, 1);
    });
  }

  for (const [id, method, path, args, body] of writeCases) {
    it(`${id} forwards the body and stable retry key with the correct verb`, async (t) => {
      const requests: string[] = [];
      t.mock.method(globalThis, 'fetch', async (url: string | URL, init: RequestInit) => {
        const actual = new URL(url);
        requests.push(actual.pathname);
        assert.equal(actual.pathname, path);
        assert.equal(init.method, method);
        assert.equal(new Headers(init.headers).get('idempotency-key'), 'operation-test-retry-1');
        assert.deepEqual(JSON.parse(String(init.body)), body);
        if (id === 'submit_feedback') {
          assert.equal(actual.searchParams.get('type'), 'experience');
          assert.equal(actual.searchParams.get('query'), 'energy');
        }
        return Response.json({ id: 'saved_one' });
      });
      await connect(async (client) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await client.callTool({ name: `arcmira_${id}`, arguments: { ...args, body, idempotency_key: 'operation-test-retry-1' } });
          assert.notEqual(result.isError, true);
        }
      });
      assert.equal(requests.length, 2);
    });
  }

  for (const state of ['ready', 'pending', 'failed']) {
    it(`preserves Premium ${state} without a caption fallback or implicit retry`, async (t) => {
      let calls = 0;
      const body = { state, quality: 'premium', ...(state === 'ready' ? { lines: [{ start: 42, text: 'Hello' }] } : { job: { state } }) };
      t.mock.method(globalThis, 'fetch', async (url: string | URL) => {
        calls++;
        assert.equal(new URL(url).searchParams.get('quality'), 'premium');
        return Response.json(body, { status: state === 'pending' ? 202 : 200 });
      });
      await connect(async (client) => {
        const result = await client.callTool({ name: 'arcmira_get_transcript', arguments: { video_id: 'dQw4w9WgXcQ', quality: 'premium' } });
        assert.deepEqual(result.structuredContent, body);
      });
      assert.equal(calls, 1);
    });
  }

  it('preserves entitlement failures without widening the query or retrying', async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return Response.json({ error: { type: 'permission_error', code: 'filter_requires_paid', message: 'This source is unavailable for the account.', doc_url: 'https://arcmira.com/docs/errors', request_id: 'req_test' } }, { status: 403 });
    });
    await connect(async (client) => {
      const result = await client.callTool({ name: 'arcmira_search', arguments: { q: 'energy', source: 'arcmira_premium' } });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /filter_requires_paid/);
    });
    assert.equal(calls, 1);
  });

  it('rejects invalid filters, executor fields and writes without bodies or retry keys before fetching', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not send invalid input'); });
    await connect(async (client) => {
      for (const [name, args] of [
        ['arcmira_search', { q: 'x' }],
        ['arcmira_search', { q: 'energy', limit: 999 }],
        ['arcmira_search', { q: 'energy', code: 'return fetch("https://evil.test")' }],
        ['arcmira_create_monitor', { body: { name: 'News' } }],
        ['arcmira_create_monitor', { idempotency_key: 'test' }],
      ] as const) {
        const result = await client.callTool({ name, arguments: args });
        assert.equal(result.isError, true);
      }
    });
    assert.equal(fetch.mock.callCount(), 0);
  });

  it('refuses calls without a connected account', async () => {
    await connect(async (client) => {
      const result = await client.callTool({ name: 'arcmira_search', arguments: { q: 'energy' } });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /invalid_api_key/);
    }, false);
  });
});
