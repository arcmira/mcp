import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import responses from './fixtures/transcription-responses.json' with { type: 'json' };

type Arcmira = Record<string, (...args: any[]) => Promise<any>> & { today(): string; daysAgo(n: number): string };
const mod = (await import(new URL('../src/sandbox/client.js', import.meta.url).href)) as {
  createArcmira(o: { base: string; fetch?: unknown; maxCalls?: number; now?: () => Date; sleep?: (ms: number) => Promise<void>; access?: 'read' | 'write'; idempotencyKey?: () => string }): { arcmira: Arcmira; meter: { calls: number; rate_limit: unknown; api_build: string | null } };
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
    const { urls, fetch } = recording({ mentions: [], recommendations: [], chunks: [], rows: [], sponsors: [], episodes: [] });
    const { arcmira, meter } = mod.createArcmira({ base: 'https://api.arcmira.com/', fetch });
    await arcmira.resolve('Ramp', { type: 'organization' });
    await arcmira.search({ query: 'cards', channelIds: [TBPN], after: '2026-08-01', limit: 3 });
    await arcmira.mentions({ entityId: 'ent_14', channelId: TBPN, before: '2026-09-01T00:00:00Z' });
    await arcmira.momentum('ent_14');
    await arcmira.sponsors(TBPN, { minAdReads: 3 });
    await arcmira.recommendations('ent_14', { kind: 'organic' });
    await arcmira.recommendations('ent_14');
    await arcmira.search({ query: 'cards', kind: ['sponsored', 'organic'], before: '2026-09-01' });
    await arcmira.episodes(TBPN, { limit: 1 });
    await arcmira.transcript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { quality: 'premium', start: 0, end: 60, timestamps: false });
    await arcmira.occurrences({ videoIds: ['dQw4w9WgXcQ'], types: ['organization', 'product'], before: '2026-08-31' });
    await arcmira.status({ channelId: TBPN });
    await arcmira.status();
    await arcmira.quote('dQw4w9WgXcQ');
    const seen = urls.map((u) => `${u.pathname}?${u.searchParams}`);
    assert.deepEqual(seen, [
      '/v1/entities/resolve?q=Ramp&type=organization&limit=8',
      `/v1/search?q=cards&channel_ids=${TBPN}&after=2026-08-01&limit=3`,
      `/v1/mentions?entity_id=ent_14&channel_id=${TBPN}&before=2026-09-01T00%3A00%3A00Z&limit=10`,
      '/v1/entities/ent_14/momentum?',
      `/v1/channels/${TBPN}/sponsors?min_ad_reads=3`,
      '/v1/recommendations?entity_id=ent_14&class=organic&limit=10',
      '/v1/recommendations?entity_id=ent_14&limit=10',
      '/v1/search?q=cards&kind=sponsored%2Corganic&before=2026-09-01&limit=5',
      `/v1/channels/${TBPN}/videos?limit=1`,
      '/v1/transcripts/dQw4w9WgXcQ?quality=premium&timestamps=false&start=0&end=60',
      '/v1/mentions/counts?video_ids=dQw4w9WgXcQ&entity_types=organization%2Cproduct&before=2026-08-31&limit=20',
      `/v1/channels/${TBPN}/coverage?`,
      '/v1/me?',
      '/v1/transcripts/dQw4w9WgXcQ/quote?',
    ]);
    assert.equal(meter.calls, 14);
  });

  it('monitor methods: reads in either access, writes only with access write, each write a JSON body with its own Idempotency-Key', async () => {
    const sent: Array<{ method: string; path: string; body: unknown; key: string | null }> = [];
    const fetch = async (input: string, init?: RequestInit) => {
      sent.push({ method: init?.method ?? 'GET', path: new URL(input).pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, key: new Headers(init?.headers).get('idempotency-key') });
      if (input.endsWith('/v1/trackers') && JSON.parse(String(init?.body)).entity_name === 'Acme') return Response.json({ error: { code: 'tracker_already_exists', message: 'exists', details: { existing_id: 'trk_7' } } }, { status: 409 });
      return Response.json({ monitors: [], trackers: [], monitor: { id: 'mon_9' }, tracker: { id: 'trk_2', entity_name: 'Acme Robotics', entity_type: 'organization' }, monitor_id: 'mon_9', results: [] });
    };
    let n = 0;
    const read = mod.createArcmira({ base: 'https://api.arcmira.com', fetch }).arcmira as unknown as { monitors: Record<string, (...a: unknown[]) => Promise<unknown>> };
    await read.monitors.list();
    await read.monitors.trackers('mon_1');
    await (read as unknown as { integrations: { slack(): Promise<unknown> } }).integrations.slack();
    for (const call of [() => read.monitors.create({ name: 'A', notify_frequency: 'daily' }), () => read.monitors.update('mon_1', { paused: true }), () => read.monitors.addEntities('mon_1', ['ent_14']), () => read.monitors.addName('mon_1', { name: 'Acme', type: 'org' }), () => read.monitors.attachTrackers('mon_1', ['trk_1'])])
      await assert.rejects(call(), (e: Error & { code: string }) => e.code === 'write_tool_required' && /arcmira_execute_write/.test(e.message));
    assert.deepEqual(sent.map((c) => `${c.method} ${c.path}`), ['GET /v1/monitors', 'GET /v1/monitors/mon_1/trackers', 'GET /v1/integrations/slack']);
    const write = mod.createArcmira({ base: 'https://api.arcmira.com', fetch, access: 'write', idempotencyKey: () => `k${++n}` }).arcmira as unknown as typeof read;
    await write.monitors.create({ name: 'Competitors', notify_frequency: 'daily', notify_slack: undefined });
    await write.monitors.update('mon_9', { paused: true });
    await write.monitors.addEntities('mon_9', ['ent_14', 'ent_14', 'ent_99'], { personMatchMode: 'both' });
    await write.monitors.attachTrackers('mon_9', ['trk_1', 'trk_1']);
    assert.deepEqual(await write.monitors.addName('mon_9', { name: ' Acme Robotics ', type: 'org' }), { tracker_id: 'trk_2', entity_name: 'Acme Robotics', entity_type: 'organization', created: true, attached: true });
    assert.deepEqual(await write.monitors.addName('mon_9', { name: 'Acme', type: 'organization' }), { tracker_id: 'trk_7', entity_name: 'Acme', created: false, attached: false, reason: 'tracker_exists' });
    assert.deepEqual(sent.slice(3), [
      { method: 'POST', path: '/v1/monitors', body: { name: 'Competitors', notify_frequency: 'daily' }, key: 'k1' },
      { method: 'PATCH', path: '/v1/monitors/mon_9', body: { paused: true }, key: 'k2' },
      { method: 'POST', path: '/v1/monitors/mon_9/entities', body: { entity_ids: ['ent_14', 'ent_99'], person_match_mode: 'both' }, key: 'k3' },
      { method: 'POST', path: '/v1/monitors/mon_9/trackers', body: { tracker_ids: ['trk_1'] }, key: 'k4' },
      { method: 'POST', path: '/v1/trackers', body: { entity_name: 'Acme Robotics', entity_type: 'organization' }, key: 'k5' },
      { method: 'POST', path: '/v1/monitors/mon_9/trackers', body: { tracker_ids: ['trk_2'] }, key: 'k6' },
      { method: 'POST', path: '/v1/trackers', body: { entity_name: 'Acme', entity_type: 'organization' }, key: 'k7' },
    ]);
    for (const [call, code] of [
      [() => write.monitors.create({ name: 'A' }), 'invalid_request'],
      [() => write.monitors.create({ name: 'A', notify_frequency: 'weekly' }), 'invalid_request'],
      [() => write.monitors.create({ name: 'A', notify_frequency: 'daily', color: 'red' }), 'invalid_request'],
      [() => write.monitors.create({ name: 'A', notifyFrequency: 'daily' }), 'invalid_request'],
      [() => write.monitors.update('Competitors monitor name that is far too long'.repeat(5), { paused: true }), 'id_required'],
      [() => write.monitors.update('mon_9', { isPaused: true }), 'invalid_request'],
      [() => write.monitors.addName('mon_9', { name: 'TBPN', type: 'channel' }), 'id_required'],
      [() => write.monitors.addName('mon_9', { name: 'Acme', type: 'company' }), 'invalid_request'],
      [() => write.monitors.addName('mon_9', { name: 'Acme', type: 'org', personMatchMode: 'both' }), 'invalid_request'],
      [() => write.monitors.update('mon_9', {}), 'invalid_request'],
      [() => write.monitors.addEntities('mon_9', ['Linear']), 'id_required'],
      [() => write.monitors.addEntities('mon_9', []), 'too_many'],
      [() => write.monitors.addEntities('mon_9', ['ent_1'], { personMatchMode: 'speakers' }), 'invalid_request'],
      [() => write.monitors.attachTrackers('mon_9', ['ent_14']), 'id_required'],
    ] as const)
      await assert.rejects(call(), (e: Error & { code: string }) => e.code === code);
    assert.equal(sent.length, 10);
  });

  it('resolve sends context and returns the server answer verbatim', async () => {
    const suggested = { id: 'ent_7', name: 'Sam Parr', type: 'person', appearance_count: 900, match: 'word', reason: 'context', evidence: 'the context matches its description', assumed: true };
    const ask = { question: 'Which Sam do you mean?', options: [{ id: 'ent_7', name: 'Sam Parr', type: 'person', label: 'Sam Parr (person)' }] };
    const body = { query: 'Sam', context: 'the My First Million co-host', confidence: 'ambiguous', best: null, suggested, ask: null, candidates: [{ id: 'ent_1', name: 'Sam', type: 'person', appearance_count: 265, match: 'exact' }], note: 'n' };
    const { urls, fetch } = recording(body);
    const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch });
    assert.deepEqual(await arcmira.resolve('Sam', { context: 'the My First Million co-host' }), body);
    assert.equal(`${urls[0]?.pathname}?${urls[0]?.searchParams}`, '/v1/entities/resolve?q=Sam&context=the+My+First+Million+co-host&limit=8');
    const asked = { ...body, context: null, suggested: null, ask };
    const second = mod.createArcmira({ base: 'https://api.arcmira.com', fetch: recording(asked).fetch });
    assert.deepEqual((await second.arcmira.resolve('Sam')).ask, ask);
    await arcmira.resolve({ name: 'Sam', context: 'the My First Million co-host' });
    assert.equal(`${urls[1]?.pathname}?${urls[1]?.searchParams}`, '/v1/entities/resolve?q=Sam&context=the+My+First+Million+co-host&limit=8');
    await assert.rejects(arcmira.resolve('Sam', { context: ['co-host'] }), (e: Error & { code: string }) => e.code === 'invalid_request');
  });

  it('resolve says to move a description into context when a multi-word name finds nothing', async () => {
    const none = { query: 'Ramp fintech company', context: null, confidence: 'none', best: null, suggested: null, ask: null, candidates: [], note: 'No match under that name.' };
    const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch: recording(none).fetch });
    assert.match((await arcmira.resolve('Ramp fintech company')).note, /only the name and the description as context/);
    assert.equal((await arcmira.resolve('Ramp fintech company', { context: 'fintech' })).note, 'No match under that name.');
    assert.equal((await arcmira.resolve('Zzyzx')).note, 'No match under that name.');
  });

  it('refuses an option name it does not know before any network call, naming the signature', async () => {
    const { urls, fetch } = recording();
    const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch });
    await assert.rejects(arcmira.search({ query: 'Anthropic pricing', publishedAfter: '2026-09-01' }), (e: Error & { code: string }) => e.code === 'invalid_request' && /publishedAfter/.test(e.message) && /after\?/.test(e.message));
    await assert.rejects(arcmira.recommendations('ent_14', { since: '2026-09-01' }), (e: Error & { code: string }) => e.code === 'invalid_request');
    await assert.rejects(arcmira.resolve({ name: 'Ramp', hint: 'fintech' }), (e: Error & { code: string }) => e.code === 'invalid_request');
    assert.equal(urls.length, 0);
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

  it('an error names the /v1 parameter, which is the client option for every date bound', async () => {
    const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch: async () => Response.json({ error: { code: 'freshness_requires_paid', param: 'after', message: 'set after to 2026-09-01 or earlier.' } }, { status: 402 }) });
    await assert.rejects(arcmira.mentions({ entityId: 'ent_14', after: '2026-09-25' }), (e: Error & { code: string; param: string }) => e.code === 'freshness_requires_paid' && e.param === 'after' && e.message === 'set after to 2026-09-01 or earlier.');
  });

  it('after and before go out as written, a date or a datetime with offset, half-open on the API', async () => {
    const { urls, fetch } = recording({ episodes: [] });
    const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch });
    await arcmira.episodes(TBPN, { after: '2026-08-01', before: '2026-09-01' });
    await arcmira.episodes(TBPN, { after: '2026-08-01T12:00:00+02:00' });
    assert.deepEqual(urls.map((u) => [u.searchParams.get('after'), u.searchParams.get('before')]), [['2026-08-01', '2026-09-01'], ['2026-08-01T12:00:00+02:00', null]]);
    await assert.rejects(arcmira.episodes(TBPN, { before: '2026-09-01 noon' }), (e: Error & { code: string }) => e.code === 'invalid_date');
  });

  it('status no longer reads a job: a pending Premium read returns its own job', async () => {
    const { urls, fetch } = recording();
    const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch });
    await assert.rejects(arcmira.status({ jobId: 'j' }), (e: Error & { code: string }) => e.code === 'invalid_request' && /status\(\{ channelId\? \}\)/.test(e.message));
    assert.equal(urls.length, 0);
  });
});

it('preserves Retry-After even when an upstream error omits the numeric body field', async () => {
  const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch: async () => Response.json({ error: { code: 'rate_limited' } }, { status: 429, headers: { 'retry-after': '9' } }) });
  await assert.rejects(arcmira.status({}), error => error instanceof Error && 'retry_after' in error && error.retry_after === '9');
});

describe('Premium reads in the sandbox client', () => {
  type Answer = { status: number; body: unknown; headers?: Record<string, string> };
  /**
   * A clock that only moves when the client sleeps, and a fetch that answers each route from its own queue
   * (the last answer repeats), recording every request.
   */
  function api(routes: Record<string, Answer[]>) {
    let t = Date.parse('2026-10-01T00:00:00Z');
    const slept: number[] = [];
    const sent: Array<{ route: string; body: unknown; key: string | null }> = [];
    const { arcmira } = mod.createArcmira({
      base: 'https://api.arcmira.com',
      now: () => new Date(t),
      sleep: async (ms: number) => {
        slept.push(ms / 1000);
        t += ms;
      },
      fetch: async (input: string, init?: RequestInit) => {
        const url = new URL(input);
        const route = `${init?.method ?? 'GET'} ${url.pathname}?${url.searchParams.get('quality') ?? 'captions'}`;
        sent.push({ route, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, key: new Headers(init?.headers).get('idempotency-key') });
        const queue = routes[route];
        if (!queue) throw new Error(`unexpected ${route}`);
        const answer = queue.length > 1 ? queue.shift()! : queue[0];
        return Response.json(answer.body, { status: answer.status, headers: answer.headers });
      },
    });
    return { arcmira, slept, sent };
  }
  const job = responses.get_transcript_pending.body.job;
  const PREMIUM = 'GET /v1/transcripts/dQw4w9WgXcQ?premium';

  it('a Premium read of a video not transcribed yet is one read: 202 with the job, then the lines at Retry-After', async () => {
    const { arcmira, sent, slept } = api({ [PREMIUM]: [responses.get_transcript_pending, responses.get_transcript_premium_ready] });
    assert.deepEqual(await arcmira.transcript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { quality: 'premium' }), responses.get_transcript_premium_ready.body);
    assert.deepEqual(sent.map((c) => c.route), [PREMIUM, PREMIUM]);
    assert.ok(sent.every((c) => c.body === null && c.key === null));
    assert.deepEqual(slept, [25]);
  });

  it('still pending after 25 seconds, it returns the job with eta_seconds and says to read again; it honors Retry-After', async () => {
    const { arcmira, slept, sent } = api({ [PREMIUM]: [{ ...responses.get_transcript_pending, headers: { 'retry-after': '12' } }] });
    const t = await arcmira.transcript('dQw4w9WgXcQ', { quality: 'premium' });
    assert.equal(t.state, 'pending');
    assert.equal(t.job.id, job.id);
    assert.equal(t.eta_seconds, 172);
    assert.match(t.note, /about 3 min left.*never buys twice/);
    assert.deepEqual(slept, [12, 12, 1]);
    assert.equal(sent.length, 4);
  });

  it('a captions read and a ready Premium read make one call each', async () => {
    const { arcmira, sent } = api({ 'GET /v1/transcripts/dQw4w9WgXcQ?captions': [responses.get_transcript_ready], [PREMIUM]: [responses.get_transcript_premium_ready] });
    await arcmira.transcript('dQw4w9WgXcQ');
    await arcmira.transcript('dQw4w9WgXcQ', { quality: 'premium' });
    assert.equal(sent.length, 2);
  });

  it('a refused Premium read throws with the quote from error.details, and prepare and wait name the read', async () => {
    for (const refusal of [responses.get_transcript_spend_limit_exceeded, responses.get_transcript_paid_plan_required]) {
      const { arcmira, sent } = api({ [PREMIUM]: [refusal] });
      await assert.rejects(arcmira.transcript('dQw4w9WgXcQ', { quality: 'premium' }), (e: Error & { code: string; quote: unknown; unlock: unknown }) => {
        assert.equal(e.code, refusal.body.error.code);
        assert.deepEqual(e.quote, refusal.body.error.details.quote);
        assert.deepEqual(e.unlock, refusal.body.error.unlock);
        return true;
      });
      assert.equal(sent.length, 1);
      for (const retired of [arcmira.prepare('dQw4w9WgXcQ'), arcmira.wait(job)]) {
        await assert.rejects(retired, (e: Error & { code: string }) => e.code === 'method_retired' && /quality: "premium"/.test(e.message));
      }
    }
  });
});
