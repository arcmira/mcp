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
    for (const call of [() => read.monitors.create({ name: 'A', notifyFrequency: 'daily' }), () => read.monitors.update('mon_1', { isPaused: true }), () => read.monitors.addEntities('mon_1', ['ent_14'])])
      await assert.rejects(call(), (e: Error & { code: string }) => e.code === 'write_tool_required' && /arcmira_execute_write/.test(e.message));
    assert.equal(sent.length, 2);
    const write = mod.createArcmira({ base: 'https://api.arcmira.com', fetch, access: 'write', idempotencyKey: () => `k${++n}` }).arcmira as unknown as typeof read;
    await write.monitors.create({ name: 'Competitors', notifyFrequency: 'daily', notifySlack: undefined });
    await write.monitors.update('mon_9', { isPaused: true });
    await write.monitors.addEntities('mon_9', ['ent_14', 'ent_14', 'ent_99'], { personMatchMode: 'both' });
    assert.deepEqual(sent.slice(2), [
      { method: 'POST', path: '/v1/monitors', body: { name: 'Competitors', notifyFrequency: 'daily' }, key: 'k1' },
      { method: 'PATCH', path: '/v1/monitors/mon_9', body: { isPaused: true }, key: 'k2' },
      { method: 'POST', path: '/v1/monitors/mon_9/entities', body: { entity_ids: ['ent_14', 'ent_99'], person_match_mode: 'both' }, key: 'k3' },
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
    ] as const)
      await assert.rejects(call(), (e: Error & { code: string }) => e.code === code);
    assert.equal(sent.length, 5);
  });

  it('prepare reads the quote, then posts the quoted rows and on-demand cents with a key and returns the Job', async () => {
    for (const [charge, cents, expected] of [
      [{ from: 'included' }, 99, 0],
      [{ from: 'mixed' }, 12.2, 13],
      [{ from: 'on_demand' }, 240, 240],
    ] as const) {
      const sent: Array<{ method: string; path: string; body: unknown; key: string | null }> = [];
      const { arcmira } = mod.createArcmira({
        base: 'https://api.arcmira.com',
        fetch: async (input: string, init?: RequestInit) => {
          sent.push({ method: init?.method ?? 'GET', path: new URL(input).pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, key: new Headers(init?.headers).get('idempotency-key') });
          return init?.method === 'POST' ? Response.json(responses.submit_transcription_pending.body, { status: 202 }) : Response.json({ ...responses.quote_transcription.body, charge, max_on_demand_cents: cents });
        },
      });
      assert.deepEqual(await arcmira.prepare('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), responses.submit_transcription_pending.body.job);
      assert.deepEqual(sent.map((c) => [c.method, c.path]), [['GET', '/v1/transcripts/dQw4w9WgXcQ/quote'], ['POST', '/v1/transcriptions']]);
      assert.deepEqual(sent[1].body, { video_id: 'dQw4w9WgXcQ', max_rows: 300, max_on_demand_cents: expected });
      assert.ok(sent[1].key);
    }
    const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch: async () => Response.json({ quote: {} }) });
    await assert.rejects(arcmira.prepare('dQw4w9WgXcQ'), (e: Error & { code: string }) => e.code === 'quote_unreadable');
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
    await assert.rejects(arcmira.resolve('Sam', { context: ['co-host'] }), (e: Error & { code: string }) => e.code === 'invalid_request');
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

describe('Premium preparation in the sandbox client', () => {
  const pending = responses.get_transcription_pending;
  const ready = responses.get_transcription_ready;
  /** A clock that only moves when the client sleeps, and a fetch that answers the given polls in order. */
  function polling(answers: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
    let t = Date.parse('2026-10-01T00:00:00Z');
    const slept: number[] = [];
    const paths: string[] = [];
    const { arcmira } = mod.createArcmira({
      base: 'https://api.arcmira.com',
      now: () => new Date(t),
      sleep: async (ms: number) => {
        slept.push(ms / 1000);
        t += ms;
      },
      fetch: async (input: string) => {
        paths.push(new URL(input).pathname);
        const answer = answers.shift() ?? pending;
        if (answers.length === 0) answers.push(answer);
        return Response.json(answer.body, { status: answer.status, headers: answer.headers });
      },
    });
    return { arcmira, slept, paths };
  }

  it('a preparation_required read is data the program branches on, never a thrown error', async () => {
    const answer = responses.get_transcript_preparation_required;
    const { arcmira } = mod.createArcmira({ base: 'https://api.arcmira.com', fetch: async () => Response.json(answer.body, { status: answer.status }) });
    assert.deepEqual(await arcmira.transcript('dQw4w9WgXcQ', { quality: 'premium' }), answer.body);
  });

  it('wait polls the job until it is ready, sleeping next_poll_seconds between polls', async () => {
    const soon = { ...pending, body: { ...pending.body, next_poll_seconds: 10 } };
    const { arcmira, slept, paths } = polling([soon, soon, ready]);
    assert.deepEqual(await arcmira.wait(pending.body), ready.body);
    assert.deepEqual(paths, Array(3).fill(`/v1/transcriptions/${pending.body.id}`));
    assert.deepEqual(slept, [10, 10]);
  });

  it('wait takes a job, its id, or the body that carries it, and returns the latest job at the timeout', async () => {
    for (const given of [pending.body, pending.body.id, responses.get_transcript_pending.body, responses.submit_transcription_pending.body]) {
      const { arcmira, slept, paths } = polling([pending]);
      assert.deepEqual(await arcmira.wait(given, { timeoutSeconds: 20 }), pending.body);
      assert.equal(paths[0], `/v1/transcriptions/${pending.body.id}`);
      assert.deepEqual(slept, [20]);
      assert.equal(paths.length, 2);
    }
    await assert.rejects(polling([pending]).arcmira.wait({ state: 'pending' }), (e: Error & { code: string }) => e.code === 'invalid_request');
  });

  it('wait honors Retry-After when the job carries no poll hint, and never waits past 25 seconds', async () => {
    const { next_poll_seconds: _drop, ...bare } = pending.body;
    const { arcmira, slept } = polling([{ status: 200, body: bare, headers: { 'retry-after': '12' } }]);
    await arcmira.wait(bare.id, { timeoutSeconds: 600 });
    assert.deepEqual(slept, [12, 12, 1]);
  });
});
