import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

type Arcmira = Record<string, (...args: any[]) => Promise<any>> & { today(): string; daysAgo(n: number): string };
const mod = (await import(new URL('../src/sandbox/client.js', import.meta.url).href)) as {
  createArcmira(o: { base: string; fetch?: unknown; maxCalls?: number; now?: () => Date }): { arcmira: Arcmira; meter: { calls: number; rate_limit: unknown; api_build: string | null } };
  pickResolved(q: string, rows: Array<Record<string, unknown>>): { best: unknown; confidence: string };
  ArcmiraError: new (...args: any[]) => Error & { code: string };
};

function recording(body: Record<string, unknown> = { data: [] }, init: ResponseInit = {}) {
  const urls: URL[] = [];
  const fetch = async (input: string) => {
    urls.push(new URL(input));
    return Response.json(body, init);
  };
  return { urls, fetch };
}

const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';

describe('the sandbox client', () => {
  it('a string where the options object belongs names the signature', async () => {
    const { arcmira } = mod.createArcmira({ base: 'https://api.test', fetch: async () => Response.json({}) });
    const shape = (error: Error & { code: string }) => error.code === 'invalid_request' && /arcmira\.(search|mentions)\(\{ (query|entityId)/.test(error.message);
    await assert.rejects(arcmira.search('stablecoins', { channelId: TBPN }), shape);
    await assert.rejects(arcmira.mentions('ent_14'), shape);
  });

  it('refuses a name where an id belongs before any network call, naming resolve', async () => {
    const { urls, fetch } = recording();
    const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch });
    for (const call of [
      () => arcmira.momentum('Ramp'),
      () => arcmira.mentions({ entityId: 'ent_14', channelId: 'TBPN' }),
      () => arcmira.sponsors('@TBPNLive'),
      () => arcmira.search({ query: 'cards', entityIds: ['Ramp'] }),
      () => arcmira.occurrences({ channelIds: ['tbpn'] }),
    ]) {
      await assert.rejects(call, (error: Error & { code: string }) => error.code === 'id_required' && /arcmira\.resolve\(/.test(error.message));
    }
    assert.equal(urls.length, 0);
  });

  it('maps every method to its v1 route with the CLI flag names as query keys', async () => {
    const { urls, fetch } = recording({ data: [], chunks: [], rows: [], sponsors: [], episodes: [] });
    const { arcmira, meter } = mod.createArcmira({ base: 'https://api.arcmira.com/', fetch });
    await arcmira.resolve('Ramp', { type: 'organization' });
    await arcmira.search({ query: 'cards', channelIds: [TBPN], after: '2026-08-01', limit: 3 });
    await arcmira.mentions({ entityId: 'ent_14', channelId: TBPN, before: '2026-09-01T00:00:00Z' });
    await arcmira.momentum('ent_14');
    await arcmira.sponsors(TBPN, { minAdReads: 3 });
    await arcmira.recommendations('ent_14', { kind: 'organic' });
    await arcmira.episodes(TBPN, { limit: 1 });
    await arcmira.transcript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { quality: 'premium', start: 0, end: 60, timestamps: false });
    await arcmira.occurrences({ videoIds: ['dQw4w9WgXcQ'], types: ['organization', 'product'], before: '2026-08-31' });
    await arcmira.status({ channelId: TBPN });
    await arcmira.status();
    const seen = urls.map((u) => `${u.pathname}?${u.searchParams}`);
    assert.deepEqual(seen, [
      '/v1/entities/search?q=Ramp&type=organization&limit=8',
      `/v1/transcripts/search?q=cards&channel_ids=${TBPN}&published_after=2026-08-01&limit=3`,
      `/v1/mentions?entity_id=ent_14&channel_id=${TBPN}&date_to=2026-09-01&limit=10`,
      '/v1/entities/ent_14/momentum?',
      `/v1/channels/${TBPN}/sponsors?min_ad_reads=3`,
      '/v1/entities/ent_14/recommendations?mention_class=endorsement&limit=10',
      `/v1/channels/${TBPN}/videos?limit=1`,
      '/v1/transcripts/dQw4w9WgXcQ?quality=premium&timestamps=false&start=0&end=60',
      '/v1/mentions/counts?video_ids=dQw4w9WgXcQ&entity_types=organization%2Cproduct&published_before=2026-09-01&limit=20',
      `/v1/channels/${TBPN}/coverage?`,
      '/v1/me?',
    ]);
    assert.equal(meter.calls, 11);
  });

  it('resolve picks best only for a suggested row or a single exact name match', () => {
    const ramp = { id: 'ent_14', name: 'Ramp', type: 'organization' };
    const rampCard = { id: 'ent_99', name: 'Ramp Card', type: 'product' };
    assert.deepEqual(mod.pickResolved('ramp', [rampCard, ramp]), { best: ramp, confidence: 'exact' });
    assert.deepEqual(mod.pickResolved('Mercury', [{ id: 'a', name: 'Mercury', type: 'organization' }, { id: 'b', name: 'Mercury', type: 'topic' }]).confidence, 'ambiguous');
    assert.deepEqual(mod.pickResolved('Rmp', [rampCard]), { best: rampCard, confidence: 'single_fuzzy' });
    assert.deepEqual(mod.pickResolved('Rmp', [rampCard, ramp]), { best: null, confidence: 'fuzzy' });
    assert.deepEqual(mod.pickResolved('Rmp', []), { best: null, confidence: 'none' });
    assert.deepEqual(mod.pickResolved('x', [rampCard, { ...ramp, suggested: true }]).best, { ...ramp, suggested: true });
  });

  it('turns a v1 error body into an ArcmiraError with the code and unlock, and keeps the rate limit', async () => {
    const error = { type: 'permission_error', code: 'filter_requires_paid', message: 'Pro+', unlock: { tier: 'pro_plus', url: 'https://arcmira.com/pricing' } };
    const { fetch } = recording({ error }, { status: 403, headers: { 'ratelimit-limit': '20', 'ratelimit-remaining': '3', 'ratelimit-reset': '99', 'x-arcmira-build': 'b1' } });
    const { arcmira, meter } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch });
    await assert.rejects(arcmira.sponsors(TBPN, { status: 'active' }), (e: Error & { code: string; unlock: { url: string }; status: number }) => e.code === 'filter_requires_paid' && e.unlock.url === 'https://arcmira.com/pricing' && e.status === 403);
    assert.deepEqual(meter.rate_limit, { limit: 20, remaining: 3, reset: 99 });
    assert.equal(meter.api_build, 'b1');
  });

  it('stops at the call budget with a message that names the fix', async () => {
    const { urls, fetch } = recording();
    const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch, maxCalls: 2 });
    await arcmira.momentum('ent_1');
    await arcmira.momentum('ent_2');
    await assert.rejects(arcmira.momentum('ent_3'), (e: Error & { code: string }) => e.code === 'call_budget' && /2 API calls/.test(e.message));
    assert.equal(urls.length, 2);
  });

  it('dates come from the injected clock and reject non-ISO input', async () => {
    const { fetch } = recording();
    const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch, now: () => new Date('2026-09-30T12:00:00Z') });
    assert.equal(arcmira.today(), '2026-09-30');
    assert.equal(arcmira.daysAgo(90), '2026-07-02');
    await assert.rejects(arcmira.episodes(TBPN, { after: 'last week' }), (e: Error & { code: string }) => e.code === 'invalid_date');
  });
});
