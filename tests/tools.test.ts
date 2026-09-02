import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { READ_ONLY, SERVER_INSTRUCTIONS, TOOLS, TOOL_NAMES } from '../src/tools.ts';
import { resolvePublishedAfter } from '../src/recency.ts';
import { fakeApi, gate, ok } from './fake-api.ts';

const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';
const NOW = new Date('2026-09-02T12:00:00.000Z');

describe('the manifest', () => {
  it('is the seven tools in the spec order', () => {
    assert.deepEqual(TOOLS.map((tool) => tool.name), [...TOOL_NAMES]);
  });

  it('marks every tool read-only, non-destructive, idempotent, closed-world', () => {
    assert.deepEqual(READ_ONLY, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  });

  for (const tool of TOOLS) {
    it(`${tool.name}: description under 220 words, no em dash, every input described, fronts named`, () => {
      assert.ok(!tool.description.includes('—'), 'em dash in description');
      assert.ok(tool.description.split(/\s+/).length < 220, 'description too long');
      const schema = z.toJSONSchema(tool.inputSchema) as { properties?: Record<string, { description?: string }> };
      for (const [name, property] of Object.entries(schema.properties ?? {})) {
        const description = property.description ?? '';
        assert.ok(description.length > 0, `${tool.name}.${name} has no description`);
        assert.ok(!description.includes('—'), `${tool.name}.${name} has an em dash`);
      }
      assert.ok(tool.fronts.length > 0);
    });
  }

  it('server instructions carry no em dash and name the trial key mint', () => {
    assert.ok(!SERVER_INSTRUCTIONS.includes('—'));
    assert.match(SERVER_INSTRUCTIONS, /POST https:\/\/api\.arcmira\.com\/v1\/trial-keys\?src=mcp-tool/);
  });
});

describe('recency', () => {
  it('resolves the shorthand on server time and lets an explicit date win', () => {
    assert.equal(resolvePublishedAfter({ recency: 'recent' }, NOW), '2026-08-03');
    assert.equal(resolvePublishedAfter({ recency: 'quarter' }, NOW), '2026-06-04');
    assert.equal(resolvePublishedAfter({ recency: 'year' }, NOW), '2025-09-02');
    assert.equal(resolvePublishedAfter({ recency: 'all' }, NOW), null);
    assert.equal(resolvePublishedAfter({}, NOW), null);
    assert.equal(resolvePublishedAfter({ recency: 'recent', publishedAfter: '2026-01-01' }, NOW), '2026-01-01');
  });
});

function toolNamed(name: string) {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(name);
  return tool;
}

describe('search_transcripts', () => {
  it('sends the v1 query with the resolved window and forwards the body', async () => {
    const api = fakeApi({ '/v1/transcripts/search': ok({ chunks: [], as_of: null, note: 'n' }) });
    const result = await toolNamed('search_transcripts').run({ query: 'Ramp', channelIds: [TBPN], recency: 'year', maxResults: 3 }, api);
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, { chunks: [], as_of: null, note: 'n' });
    const [call] = api.calls;
    assert.equal(call.path, '/v1/transcripts/search');
    assert.equal(call.query.q, 'Ramp');
    assert.deepEqual(call.query.channel_ids, [TBPN]);
    assert.equal(call.query.limit, 3);
    assert.match(String(call.query.published_after), /^\d{4}-\d{2}-\d{2}$/);
  });

  it('forwards a gate untouched as an isError result', async () => {
    const denial = gate('filter_requires_paid', { param: 'source' });
    const api = fakeApi({ '/v1/transcripts/search': denial });
    const result = await toolNamed('search_transcripts').run({ query: 'Ramp', source: 'arcmira_premium' }, api);
    assert.equal(result.isError, true);
    if (!denial.ok) assert.deepEqual(result.structuredContent, { error: denial.error });
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  });
});

describe('resolve_entities', () => {
  it('keeps the catalog row fields and writes a note the agent can act on', async () => {
    const api = fakeApi({
      '/v1/entities/search': ok({
        data: [{ id: 'ent_6', numeric_id: 6, name: 'TBPN', slug: 'tbpn', type: 'channel', appearance_count: 412, youtube_channel_id: TBPN, suggested: true, recommendations_summary: { x: 1 } }],
        query: '@TBPNLive',
        has_more: false,
      }),
    });
    const result = await toolNamed('resolve_entities').run({ q: '@TBPNLive' }, api);
    const body = result.structuredContent as { entities: Array<Record<string, unknown>>; note: string };
    assert.deepEqual(body.entities, [{ id: 'ent_6', name: 'TBPN', slug: 'tbpn', type: 'channel', appearance_count: 412, youtube_channel_id: TBPN, suggested: true }]);
    assert.match(body.note, /without asking/);
    assert.equal(api.calls[0].query.limit, 8);
  });
});

describe('list_mentions', () => {
  it('maps v1 rows to the manifest row and reads indexed_through from coverage', async () => {
    const api = fakeApi({
      '/v1/mentions': ok({
        data: [{ id: 'men_1', is_appearance: false, start_seconds: 72, media: { video_id: 'abcdefghijk', title: 'T', published_at: '2026-08-04', channel_id: TBPN, source_channel: { id: 'ent_6', name: 'TBPN' } } }],
        entity: { id: 'ent_14', name: 'Ramp', type: 'organization', numeric_id: 14 },
        has_more: false,
      }),
      [`/v1/channels/${TBPN}/coverage`]: ok({ channel: { indexed_through: '2026-09-01' } }),
    });
    const result = await toolNamed('list_mentions').run({ entityId: 'ent_14', channelId: TBPN }, api);
    const body = result.structuredContent as Record<string, unknown> & { mentions: Array<Record<string, unknown>> };
    assert.deepEqual(body.entity, { id: 'ent_14', name: 'Ramp', type: 'organization' });
    assert.equal(body.indexed_through, '2026-09-01');
    assert.equal(body.count, 1);
    assert.equal(body.mentions[0].watch_url, 'https://arcmira.com/watch?v=abcdefghijk&t=72');
    assert.equal(body.mentions[0].channel_name, 'TBPN');
    assert.equal(body.as_of, '2026-08-04');
    assert.equal(api.calls.length, 2);
  });

  it('a pagination gate is forwarded before any coverage read', async () => {
    const api = fakeApi({ '/v1/mentions': gate('filter_requires_paid', { param: 'dateTo' }) });
    const result = await toolNamed('list_mentions').run({ entityId: 'ent_14', channelId: TBPN, dateTo: '2026-01-01' }, api);
    assert.equal(result.isError, true);
    assert.equal(api.calls.length, 1);
  });
});

describe('entity_momentum', () => {
  it('fans out per id, keeps unresolved ids, and lifts the card note', async () => {
    const api = fakeApi({
      '/v1/entities/ent_14/momentum': ok({ entity: { id: 'ent_14' }, verdict: 'fading', note: 'lead with verdict' }),
      '/v1/entities/ent_0/momentum': { ok: false, status: 404, error: { type: 'not_found', code: 'entity_not_found', message: 'x', doc_url: 'd', request_id: 'r' } },
    });
    const result = await toolNamed('entity_momentum').run({ entityIds: ['ent_14', 'ent_0', 'ent_14'] }, api);
    const body = result.structuredContent as { cards: unknown[]; unresolved: string[]; note: string };
    assert.equal(body.cards.length, 1);
    assert.deepEqual(body.unresolved, ['ent_0']);
    assert.equal(body.note, 'lead with verdict');
    assert.equal(api.calls.length, 2);
  });

  it('a gate on any card is the answer', async () => {
    const api = fakeApi({ '/v1/entities/ent_14/momentum': gate('trial_rows_exhausted') });
    const result = await toolNamed('entity_momentum').run({ entityIds: ['ent_14'] }, api);
    assert.equal(result.isError, true);
  });
});

describe('list_sponsors', () => {
  it('passes paid filters only when given and notes the free slice', async () => {
    const api = fakeApi({
      [`/v1/channels/${TBPN}/sponsors`]: ok({
        channel: { id: 'ent_6' },
        sponsors: [{ entity: { id: 'ent_14' }, last_seen: '2026-08-20' }],
        meta: { min_ad_reads: 3, count: 1, total: 48 },
        access: { code: 'recommendations_not_enabled' },
      }),
    });
    const result = await toolNamed('list_sponsors').run({ youtubeChannelId: TBPN }, api);
    const body = result.structuredContent as { note: string; as_of: string };
    assert.deepEqual(Object.keys(api.calls[0].query).filter((key) => api.calls[0].query[key] !== undefined), []);
    assert.match(body.note, /free slice/);
    assert.equal(body.as_of, '2026-08-20');
    assert.equal(result.isError, undefined);
  });
});

describe('index_status', () => {
  it('needs a channel or a job', () => {
    const schema = toolNamed('index_status').inputSchema;
    assert.equal(schema.safeParse({}).success, false);
    assert.equal(schema.safeParse({ youtubeChannelId: TBPN }).success, true);
  });

  it('a trial key polling a job gets the account gate', async () => {
    const api = fakeApi({ '/v1/transcriptions': gate('job_requires_account') });
    const result = await toolNamed('index_status').run({ jobId: '00000000-0000-4000-8000-000000000000' }, api);
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { error: { code: string } }).error.code, 'job_requires_account');
  });
});

describe('count_occurrences', () => {
  it('needs channels or entities and resolves recency', async () => {
    const schema = toolNamed('count_occurrences').inputSchema;
    assert.equal(schema.safeParse({ entityTypes: ['topic'] }).success, false);
    const api = fakeApi({ '/v1/mentions/counts': ok({ rows: [], shared: [], note: 'n' }) });
    await toolNamed('count_occurrences').run({ channelIds: [TBPN], entityTypes: ['topic'], recency: 'recent' }, api);
    const [call] = api.calls;
    assert.deepEqual(call.query.entity_types, ['topic']);
    assert.match(String(call.query.published_after), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(call.query.limit, 20);
  });
});
