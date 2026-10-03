import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { z } from 'zod';
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
        assert.deepEqual(result.structuredContent, {});
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

describe('reviewed operation responses', () => {
  it('preserves transcript words, timing, speaker joins, revision and publication dates', async (t) => {
    const expected = {
      state: 'ready', quality: 'premium', source: 'arcmira_premium', revision: 'rev_one',
      video: { id: 'dQw4w9WgXcQ', published_at: '2026-09-01T12:00:00Z', watch_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      lines: [{ start: 42, end: 47, text: 'Try the sponsor offer at example.com.', speaker: 0, index: 3 }],
      speakers: [{ id: 0, name: 'Alex', entity_id: 'ent_14', confidence: 'high' }],
    };
    t.mock.method(globalThis, 'fetch', async () => Response.json({ ...expected, trace_id: 'hidden', video: { ...expected.video, internal_id: 55 } }));
    await connect(async (client) => {
      const result = await client.callTool({ name: 'arcmira_get_transcript', arguments: { video_id: 'dQw4w9WgXcQ', quality: 'premium' } });
      assert.deepEqual(result.structuredContent, expected);
      assert.doesNotMatch(JSON.stringify(result), /hidden|internal_id/);
    });
  });

  it('retains sponsor recommendations, quoted offers, citations and pagination', async (t) => {
    const expected = {
      recommendations: [{ id: 'rec_one', class: 'sponsored', offer: '20% off', promo_code: 'PODCAST',
        verbatim_quote: 'Use PODCAST for 20% off.', start_seconds: 55, end_seconds: 62,
        media: { video_id: 'dQw4w9WgXcQ', published_at: '2026-09-01T12:00:00Z' } }],
      has_more: true, next_cursor: 'next_page', entity: { id: 'ent_14', name: 'Acme' },
    };
    t.mock.method(globalThis, 'fetch', async () => Response.json({ ...expected, entity: { ...expected.entity, image_checked_at: 'internal' } }));
    await connect(async (client) => {
      const result = await client.callTool({ name: 'arcmira_list_recommendations', arguments: { entity_id: 'ent_14' } });
      assert.deepEqual(result.structuredContent, expected);
    });
  });

  it('returns account entitlements and balances without key or account identifiers', async (t) => {
    const expected = { tier: 'pro', scopes: ['read'], period_resets_at: '2026-11-01T00:00:00Z',
      usage: { credits: { available: 200, plan: { credits: 100, used: 90, resets_at: '2026-11-01T00:00:00Z' },
        granted: 20, purchased: 30, on_demand: { enabled: true, cap_credits: 500, used: 2 } } } };
    t.mock.method(globalThis, 'fetch', async () => Response.json({ ...expected, user_id: 'private_user', key_id: 'private_key', key_label: 'private_label', email_masked: 'private_email', credential_kind: 'api_key', new_secret: 'private_future' }));
    await connect(async (client) => {
      const result = await client.callTool({ name: 'arcmira_get_me', arguments: {} });
      assert.deepEqual(result.structuredContent, expected);
      assert.doesNotMatch(JSON.stringify(result), /private_/);
    });
  });

  it('preserves search sources and partial coverage while omitting internal index diagnostics', async (t) => {
    const chunks = [{ video_id: 'dQw4w9WgXcQ', text: 'Energy prices are falling.', start_seconds: 22,
      source: 'arcmira_premium', speakers: ['Alex'], watch_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=22',
      speakers_by: [{ id: 'ent_14', name: 'Alex', type: 'person' }] }];
    t.mock.method(globalThis, 'fetch', async () => Response.json({ chunks, partial: true, failed_batches: 3,
      search_index: { internal: 'hidden' }, access: { type: 'permission_error', code: 'freshness_requires_paid',
        message: 'Upgrade now at https://arcmira.com/upgrade', gate: 'freshness',
        resource: { kind: 'freshness', cutoff: '2026-09-01' }, unlock: { url: 'https://arcmira.com/upgrade' }, request_id: 'hidden' } }));
    await connect(async (client) => {
      const result = await client.callTool({ name: 'arcmira_search', arguments: { q: 'energy' } });
      const output = z.record(z.string(), z.unknown()).parse(result.structuredContent);
      assert.deepEqual(output.chunks, chunks);
      assert.equal(output.partial, true);
      assert.match(JSON.stringify(result), /freshness_requires_paid|2026-09-01/);
      assert.match(JSON.stringify(result), /https:\/\/arcmira.com\/docs\/usage-and-billing/);
      assert.doesNotMatch(JSON.stringify(result), /Upgrade now|\/upgrade|hidden|failed_batches|search_index/);
    });
  });

  it('preserves actionable error details and retry timing without raw response diagnostics', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ raw_stack: 'private_stack', error: {
      type: 'rate_limit_error', code: 'rate_limited', message: 'Wait before retrying.', retry_after_seconds: 30,
      details: { existing_id: 'trk_one', count: 5, limit: 5, diagnostic: 'private_detail' },
      request_id: 'private_request', doc_url: 'https://arcmira.com/docs/errors',
    } }, { status: 429, headers: { 'retry-after': '30' } }));
    await connect(async (client) => {
      const result = await client.callTool({ name: 'arcmira_search', arguments: { q: 'energy' } });
      assert.equal(result.isError, true);
      assert.deepEqual(z.record(z.string(), z.unknown()).parse(result.structuredContent).error, { type: 'rate_limit_error', code: 'rate_limited',
        message: 'Wait before retrying.', retry_after_seconds: 30, retry_after: '30',
        details: { existing_id: 'trk_one', count: 5, limit: 5 }, doc_url: 'https://arcmira.com/docs/errors' });
      assert.doesNotMatch(JSON.stringify(result), /private_/);
    });
  });

  it('preserves Premium job charges, refund state and polling without diagnostic job IDs', async (t) => {
    const job = { video_id: 'dQw4w9WgXcQ', state: 'pending', status: 'transcribing',
      charge: { unit: 'credits', amount: 100, from: 'included' }, eta_seconds: 20, next_poll_seconds: 10,
      status_url: 'https://api.arcmira.com/v1/transcripts/dQw4w9WgXcQ?quality=premium' };
    t.mock.method(globalThis, 'fetch', async () => Response.json({ state: 'pending', job: { ...job, id: 'private_job', created_at: 'private_time' } }, { status: 202 }));
    await connect(async (client) => {
      const result = await client.callTool({ name: 'arcmira_get_transcript', arguments: { video_id: 'dQw4w9WgXcQ', quality: 'premium' } });
      assert.deepEqual(result.structuredContent, { state: 'pending', job });
    });
  });

  it('keeps monitor recipient consent states and flags incomplete secret setup', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ monitor: { id: 'mon_one', name: 'News',
      email_recipients: [{ email: 'reader@example.test', role: 'external', user_id: 'private_user', status: 'pending', invitation_status: 'sent' }],
      webhook_secret: 'private_secret', webhook_secret_hint: 'private_hint', webhook_secret_set: true } }));
    await connect(async (client) => {
      const result = await client.callTool({ name: 'arcmira_create_monitor', arguments: { body: { name: 'News' }, idempotency_key: 'response-test-1' } });
      assert.notEqual(result.isError, true);
      assert.match(JSON.stringify(result), /mon_one|reader@example.test|pending|setup is incomplete/);
      assert.doesNotMatch(JSON.stringify(result), /private_/);
    });
  });

  it('rejects an object smuggled into transcript text without exposing its contents', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ state: 'ready', lines: [{ start: 0, end: 1, text: { secret: 'private_data' } }] }));
    await connect(async (client) => {
      const result = await client.callTool({ name: 'arcmira_get_transcript', arguments: { video_id: 'dQw4w9WgXcQ' } });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /unexpected_response/);
      assert.doesNotMatch(JSON.stringify(result), /private_data/);
    });
  });

  it('sends unauthenticated users to authentication docs without signup actions', async () => {
    await connect(async (client) => {
      const result = await client.callTool({ name: 'arcmira_search', arguments: { q: 'energy' } });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /docs\/authentication/);
      assert.doesNotMatch(JSON.stringify(result), /unlock|request_id|send_signup_code|POST/);
    }, false);
  });
});

it('returns transcription cost facts and informational docs without purchase links', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ video_id: 'dQw4w9WgXcQ', eligible: false,
    quote: { quarters: 2, rows: 500 }, charge: { unit: 'credits', amount: 2000 },
    upgrade: { url: 'https://arcmira.com/upgrade', action: { method: 'POST', url: 'https://api.arcmira.com/purchase' } } }));
  await connect(async (client) => {
    const result = await client.callTool({ name: 'arcmira_quote_transcription', arguments: { video_id: 'dQw4w9WgXcQ' } });
    assert.deepEqual(result.structuredContent, {
      video_id: 'dQw4w9WgXcQ', eligible: false, quote: { quarters: 2, rows: 500 }, charge: { unit: 'credits', amount: 2000 },
      account_information: { message: 'Some requested data or features are outside the account allowance. See the API documentation for access details.', doc_url: 'https://arcmira.com/docs/usage-and-billing' },
    });
    assert.doesNotMatch(JSON.stringify(result), /\/upgrade|\/purchase|POST/);
  });
});

it('returns feedback outcomes without echoing arbitrary feedback query data', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ feedback_id: 'feedback_one', type: 'experience', logged: true,
    query: { internal_diagnostic: 'private_data' } }));
  await connect(async (client) => {
    const result = await client.callTool({ name: 'arcmira_submit_feedback', arguments: { type: 'experience', query: 'energy',
      body: { type: 'experience', category: 'missing', notes: 'No cited passage was returned.' }, idempotency_key: 'feedback-response-1' } });
    assert.deepEqual(result.structuredContent, { feedback_id: 'feedback_one', type: 'experience', logged: true });
  });
});
