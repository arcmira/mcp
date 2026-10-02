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
    await arcmira.quote('dQw4w9WgXcQ');
    const seen = urls.map((u) => `${u.pathname}?${u.searchParams}`);
    assert.deepEqual(seen, [
      '/v1/entities/resolve?q=Ramp&type=organization&limit=8',
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
      '/v1/transcripts/dQw4w9WgXcQ/quote?',
    ]);
    assert.equal(meter.calls, 12);
  });

  it('monitor methods: reads in either access, writes only with access write, each write a JSON body with its own Idempotency-Key', async () => {
    const sent: Array<{ method: string; path: string; body: unknown; key: string | null }> = [];
    const fetch = async (input: string, init?: RequestInit) => {
      sent.push({ method: init?.method ?? 'GET', path: new URL(input).pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, key: new Headers(init?.headers).get('idempotency-key') });
      return Response.json({ monitors: [], trackers: [], monitor: { id: 'mon_9' }, monitor_id: 'mon_9', results: [] });
    };
    let n = 0;
    const read = mod.createArcmira({ base: 'https://api.arcmira.com', fetch }).arcmira as unknown as { monitors: Record<string, (...a: unknown[]) => Promise<unknown>> };
    await read.monitors.list();
    await read.monitors.trackers('mon_1');
    await (read as unknown as { integrations: { slack(): Promise<unknown> } }).integrations.slack();
    for (const call of [() => read.monitors.create({ name: 'A', notifyFrequency: 'daily' }), () => read.monitors.update('mon_1', { isPaused: true }), () => read.monitors.addEntities('mon_1', ['ent_14']), () => read.monitors.attachTrackers('mon_1', ['trk_1'])])
      await assert.rejects(call(), (e: Error & { code: string }) => e.code === 'write_tool_required' && /arcmira_execute_write/.test(e.message));
    assert.deepEqual(sent.map((c) => `${c.method} ${c.path}`), ['GET /v1/monitors', 'GET /v1/monitors/mon_1/trackers', 'GET /v1/integrations/slack']);
    const write = mod.createArcmira({ base: 'https://api.arcmira.com', fetch, access: 'write', idempotencyKey: () => `k${++n}` }).arcmira as unknown as typeof read;
    await write.monitors.create({ name: 'Competitors', notifyFrequency: 'daily', notifySlack: undefined });
    await write.monitors.update('mon_9', { isPaused: true });
    await write.monitors.addEntities('mon_9', ['ent_14', 'ent_14', 'ent_99'], { personMatchMode: 'both' });
    await write.monitors.attachTrackers('mon_9', ['trk_1', 'trk_1']);
    assert.deepEqual(sent.slice(3), [
      { method: 'POST', path: '/v1/monitors', body: { name: 'Competitors', notifyFrequency: 'daily' }, key: 'k1' },
      { method: 'PATCH', path: '/v1/monitors/mon_9', body: { isPaused: true }, key: 'k2' },
      { method: 'POST', path: '/v1/monitors/mon_9/entities', body: { entity_ids: ['ent_14', 'ent_99'], person_match_mode: 'both' }, key: 'k3' },
      { method: 'POST', path: '/v1/monitors/mon_9/trackers', body: { trackerIds: ['trk_1'] }, key: 'k4' },
    ]);
    for (const [call, code] of [
      [() => write.monitors.create({ name: 'A' }), 'invalid_request'],
      [() => write.monitors.create({ name: 'A', notifyFrequency: 'weekly' }), 'invalid_request'],
      [() => write.monitors.create({ name: 'A', notifyFrequency: 'daily', color: 'red' }), 'invalid_request'],
      [() => write.monitors.update('Competitors monitor name that is far too long'.repeat(5), { isPaused: true }), 'id_required'],
      [() => write.monitors.update('mon_9', {}), 'invalid_request'],
      [() => write.monitors.addEntities('mon_9', ['Linear']), 'id_required'],
      [() => write.monitors.addEntities('mon_9', []), 'too_many'],
      [() => write.monitors.addEntities('mon_9', ['ent_1'], { personMatchMode: 'speakers' }), 'invalid_request'],
      [() => write.monitors.attachTrackers('mon_9', ['ent_14']), 'id_required'],
    ] as const)
      await assert.rejects(call(), (e: Error & { code: string }) => e.code === code);
    assert.equal(sent.length, 7);
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

  it('a gate error names the client option, not the /v1 query key', async () => {
    const gate = (param: string, message: string) => async () =>
      Response.json({ error: { code: 'freshness_requires_paid', param, message } }, { status: 402 });
    const cases: Array<[string, string, string]> = [
      ['date_from', 'Media published after 2026-09-01 requires Hobby. Open unlock.url to try Hobby for free, or set date_from to 2026-09-01 or earlier.', 'after'],
      ['published_after', 'set published_after to 2026-09-01 or earlier.', 'after'],
      ['date_to', 'set date_to to 2026-09-01 or earlier.', 'before'],
      ['published_before', 'set published_before to 2026-09-01 or earlier.', 'before'],
    ];
    for (const [param, message, option] of cases) {
      const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch: gate(param, message) });
      await assert.rejects(arcmira.mentions({ entityId: 'ent_14', after: '2026-09-25' }), (e: Error & { code: string; param: string }) => {
        assert.equal(e.code, 'freshness_requires_paid');
        assert.equal(e.param, option);
        assert.equal(e.message, message.replace(param, option));
        return true;
      });
    }
    const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch: gate('limit', 'limit takes 1 to 100.') });
    await assert.rejects(arcmira.mentions({ entityId: 'ent_14' }), (e: Error & { param: string }) => e.param === 'limit' && e.message === 'limit takes 1 to 100.');
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
        const route = `${init?.method ?? 'GET'} ${url.pathname}${url.pathname.endsWith('/quote') || url.pathname.startsWith('/v1/transcriptions') ? '' : `?${url.searchParams.get('quality') ?? 'captions'}`}`;
        sent.push({ route, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, key: new Headers(init?.headers).get('idempotency-key') });
        const queue = routes[route];
        if (!queue) throw new Error(`unexpected ${route}`);
        const answer = queue.length > 1 ? queue.shift()! : queue[0];
        return Response.json(answer.body, { status: answer.status, headers: answer.headers });
      },
    });
    return { arcmira, slept, sent };
  }
  const job = responses.get_transcription_pending.body;
  const PREMIUM = 'GET /v1/transcripts/dQw4w9WgXcQ?premium';
  const QUOTE = 'GET /v1/transcripts/dQw4w9WgXcQ/quote';
  const BUY = 'POST /v1/transcriptions';
  const POLL = `GET /v1/transcriptions/${job.id}`;

  it('a Premium read of a video not transcribed yet buys its quote, waits, and returns the lines', async () => {
    for (const [charge, cents, expected] of [
      [{ from: 'included' }, 99, 0],
      [{ from: 'mixed' }, 12.2, 13],
      [{ from: 'on_demand' }, 240, 240],
    ] as const) {
      const { arcmira, sent, slept } = api({
        [PREMIUM]: [responses.get_transcript_preparation_required, responses.get_transcript_ready],
        [QUOTE]: [{ status: 200, body: { ...responses.quote_transcription.body, charge, max_on_demand_cents: cents } }],
        [BUY]: [responses.submit_transcription_pending],
        [POLL]: [{ status: 200, body: { ...job, next_poll_seconds: 10 } }, responses.get_transcription_ready],
      });
      assert.deepEqual(await arcmira.transcript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { quality: 'premium' }), responses.get_transcript_ready.body);
      assert.deepEqual(sent.map((c) => c.route), [PREMIUM, QUOTE, BUY, POLL, POLL, PREMIUM]);
      assert.deepEqual(sent[2].body, { video_id: 'dQw4w9WgXcQ', max_rows: 300, max_on_demand_cents: expected });
      assert.ok(sent[2].key);
      assert.deepEqual(slept, [10]);
    }
  });

  it('a Premium read already pending waits on its job without buying', async () => {
    const { arcmira, sent } = api({
      [PREMIUM]: [responses.get_transcript_pending, responses.get_transcript_ready],
      [POLL]: [responses.get_transcription_ready],
    });
    assert.deepEqual(await arcmira.transcript('dQw4w9WgXcQ', { quality: 'premium' }), responses.get_transcript_ready.body);
    assert.deepEqual(sent.map((c) => c.route), [PREMIUM, POLL, PREMIUM]);
  });

  it('still pending after 25 seconds, it returns the job and says to read again; it honors Retry-After', async () => {
    const { next_poll_seconds: _drop, ...bare } = job;
    const { arcmira, slept } = api({
      [PREMIUM]: [responses.get_transcript_pending],
      [POLL]: [{ status: 200, body: bare, headers: { 'retry-after': '12' } }],
    });
    const t = await arcmira.transcript('dQw4w9WgXcQ', { quality: 'premium' });
    assert.equal(t.state, 'pending');
    assert.equal(t.job.id, job.id);
    assert.match(t.note, /never buys twice/);
    assert.deepEqual(slept, [12, 12, 1]);
  });

  it('a captions read and a ready Premium read make one call and buy nothing', async () => {
    const { arcmira, sent } = api({ 'GET /v1/transcripts/dQw4w9WgXcQ?captions': [responses.get_transcript_ready], [PREMIUM]: [responses.get_transcript_ready] });
    await arcmira.transcript('dQw4w9WgXcQ');
    await arcmira.transcript('dQw4w9WgXcQ', { quality: 'premium' });
    assert.equal(sent.length, 2);
  });

  it('a quote without rows buys nothing, and prepare and wait name the Premium read', async () => {
    const { arcmira, sent } = api({ [PREMIUM]: [responses.get_transcript_preparation_required], [QUOTE]: [{ status: 200, body: { quote: {} } }] });
    await assert.rejects(arcmira.transcript('dQw4w9WgXcQ', { quality: 'premium' }), (e: Error & { code: string }) => e.code === 'quote_unreadable');
    assert.ok(!sent.some((c) => c.route === BUY));
    for (const retired of [arcmira.prepare('dQw4w9WgXcQ'), arcmira.wait(job)]) {
      await assert.rejects(retired, (e: Error & { code: string }) => e.code === 'method_retired' && /quality: "premium"/.test(e.message));
    }
  });
});
