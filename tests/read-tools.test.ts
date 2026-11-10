import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { OUTPUT_BUDGET } from '../src/output.ts';
import { youtubeSearchTool } from '../src/read-tools.ts';
import { callTool, listTools, textOf, withFetch, type ToolReply } from './handler.ts';

const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';
const VIDEO = 'dQw4w9WgXcQ';

/** The upstream for one test: /v1/me passes the key check, and every other request is recorded and answered by `answer`. */
function upstream(answer: (url: URL) => Response) {
  const requests: URL[] = [];
  return {
    requests,
    handler(url: URL) {
      if (url.pathname === '/v1/me') return Response.json({ id: 'caller' });
      requests.push(url);
      return answer(url);
    },
  };
}

const apiError = (status: number, error: Record<string, unknown>) => Response.json({ error: { doc_url: 'https://arcmira.com/docs/errors', request_id: 'req_fixture', ...error } }, { status });

const metadataOf = (reply: ToolReply) => JSON.parse(reply.result.content[0]!.text) as Record<string, unknown>;
const linesOf = (reply: ToolReply) => (reply.result.content[1]?.text ?? '').split('\n').filter(Boolean);

const SEARCH_BODY = {
  query: 'stablecoins',
  limit: 5,
  returned: 1,
  filters: {},
  window: { after: '2026-01-01T00:00:00.000Z', before: '2026-09-01T00:00:00.000Z' },
  chunks: [
    {
      id: 'chk_1',
      video_id: VIDEO,
      video_title: 'TBPN | Tuesday, August 4',
      channel_id: TBPN,
      channel_name: 'TBPN',
      channel_page: 'https://arcmira.com/yt/tbpn',
      source: 'arcmira_premium',
      source_label: 'Arcmira transcript',
      published_at: '2026-08-04T17:00:00.000Z',
      text: 'Jordi Hays: Stablecoins are the real story this quarter.\nJohn Coogan: Every fintech wants one now.',
      start_seconds: 4787,
      watch_url: `https://arcmira.com/watch?v=${VIDEO}&t=4787`,
      cite_line: 'TBPN | Tuesday, August 4, 1:19:47, TBPN, 2026-08-04',
      score: 0.82,
      speakers: ['Jordi Hays', 'John Coogan'],
      speakers_by: [
        { id: 'ent_99', name: 'Jordi Hays', type: 'person' },
        { id: 'ent_98', name: 'John Coogan', type: 'person' },
      ],
      about: [{ id: 'ent_14', name: 'Ramp', type: 'organization' }],
    },
  ],
  as_of: '2026-08-04T17:00:00.000Z',
  search_index: { state: 'live', missing_before: null },
  note: 'Speaker labels cover part of the index.',
};

describe('arcmira_youtube_search', () => {
  it('is listed read-only, idempotent and open-world, with a title, and waits behind tool search in Claude Code', async () => {
    const tool = (await listTools()).find((t) => t.name === 'arcmira_youtube_search');
    assert.deepEqual(tool?.annotations, { title: "Search what's said on YouTube", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
    assert.equal(tool?._meta, undefined);
    assert.match(youtubeSearchTool.description, /who sponsors a channel, or which creators recommend a product\./);
  });

  it('sends each argument as the /v1/search parameter it names, and returns each passage as lines with its second and link', async () => {
    const api = upstream(() => Response.json(SEARCH_BODY));
    const reply = await callTool(
      'arcmira_youtube_search',
      { query: 'stablecoins', channel: [TBPN], about: ['ent_14'], by: ['ent_99', 'ent_98'], kind: ['sponsored', 'mention'], after: '2026-01-01', before: '2026-09-01', source: 'creator_captions', limit: 7 },
      api.handler,
    );
    assert.equal(reply.result.isError, undefined, textOf(reply));
    assert.deepEqual(
      api.requests.map((url) => [url.pathname, Object.fromEntries(url.searchParams)]),
      [['/v1/search', { q: 'stablecoins', channel_ids: TBPN, about: 'ent_14', by: 'ent_99,ent_98', kind: 'sponsored,mention', after: '2026-01-01', before: '2026-09-01', source: 'creator_captions', limit: '7', src: 'mcp-tool' }]],
    );
    const body = JSON.parse(textOf(reply));
    assert.deepEqual(body.results, [
      {
        lines: ['Jordi Hays: Stablecoins are the real story this quarter.', 'John Coogan: Every fintech wants one now.'],
        video_title: 'TBPN | Tuesday, August 4',
        channel_name: 'TBPN',
        published_at: '2026-08-04T17:00:00.000Z',
        start_seconds: 4787,
        watch_url: `https://arcmira.com/watch?v=${VIDEO}&t=4787`,
        video_id: VIDEO,
        channel_id: TBPN,
        source: 'arcmira_premium',
        speakers: [
          { id: 'ent_99', name: 'Jordi Hays' },
          { id: 'ent_98', name: 'John Coogan' },
        ],
        about: [{ id: 'ent_14', name: 'Ramp' }],
      },
    ]);
    assert.equal(body.note, 'Speaker labels cover part of the index.');
    assert.deepEqual(body.window, SEARCH_BODY.window);
    assert.equal(body.search_index, undefined, 'a live index adds nothing');
    assert.equal(body.call_id, undefined, 'a result with passages names no call');
    assert.deepEqual(reply.result.structuredContent, body);
  });

  it('covers the last 90 days when neither after nor before is given, and keeps a catching-up note and an empty answer\'s call_id', async () => {
    const api = upstream(() => Response.json({ ...SEARCH_BODY, chunks: [], search_index: { state: 'catching_up', missing_before: '2026-03-01' } }));
    const body = JSON.parse(textOf(await callTool('arcmira_youtube_search', { query: 'stablecoins' }, api.handler)));
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    assert.deepEqual(Object.fromEntries(api.requests[0]!.searchParams), { q: 'stablecoins', after: ninetyDaysAgo, src: 'mcp-tool' });
    assert.deepEqual(body.results, []);
    assert.deepEqual(body.search_index, { state: 'catching_up', missing_before: '2026-03-01' });
    assert.match(body.call_id, /^mcpc_[0-9a-f]{32}$/);

    const bounded = upstream(() => Response.json(SEARCH_BODY));
    await callTool('arcmira_youtube_search', { query: 'stablecoins', before: '2026-09-01' }, bounded.handler);
    assert.equal(bounded.requests[0]!.searchParams.get('after'), null, 'a window the caller bounds is sent as given');
  });

  it('resolves names in channel, about and by, then searches with their ids and says what each name matched', async () => {
    const resolve: Record<string, unknown> = {
      'TBPN|channel': { best: { id: 'ent_5', name: 'TBPN', youtube_channel_id: TBPN }, suggested: null, ask: null },
      'Ramp|': { best: null, suggested: { id: 'ent_14', name: 'Ramp', evidence: '10x the appearances of the next match' }, ask: null },
      'Jensen Huang|': { best: { id: 'ent_7', name: 'Jensen Huang' }, suggested: null, ask: null },
    };
    const api = upstream((url) =>
      url.pathname === '/v1/entities/resolve' ? Response.json(resolve[`${url.searchParams.get('q')}|${url.searchParams.get('type') ?? ''}`]) : Response.json(SEARCH_BODY),
    );
    const reply = await callTool('arcmira_youtube_search', { query: 'agents', channel: ['TBPN'], about: ['Ramp', 'ent_20'], by: ['Jensen Huang'], after: '2026-01-01' }, api.handler);
    assert.equal(reply.result.isError, undefined, textOf(reply));
    assert.deepEqual(
      api.requests.map((url) => [url.pathname, Object.fromEntries(url.searchParams)]),
      [
        ['/v1/entities/resolve', { q: 'TBPN', type: 'channel', limit: '5', src: 'mcp-tool' }],
        ['/v1/entities/resolve', { q: 'Ramp', limit: '5', src: 'mcp-tool' }],
        ['/v1/entities/resolve', { q: 'Jensen Huang', limit: '5', src: 'mcp-tool' }],
        ['/v1/search', { q: 'agents', channel_ids: TBPN, about: 'ent_14,ent_20', by: 'ent_7', after: '2026-01-01', src: 'mcp-tool' }],
      ],
    );
    assert.deepEqual(JSON.parse(textOf(reply)).resolved, [
      { filter: 'channel', name: 'TBPN', matched: 'TBPN', id: TBPN },
      { filter: 'about', name: 'Ramp', matched: 'Ramp', id: 'ent_14', assumed: '10x the appearances of the next match' },
      { filter: 'by', name: 'Jensen Huang', matched: 'Jensen Huang', id: 'ent_7' },
    ]);
  });

  it('stops before searching when a name matches no single entity, and lists the options', async () => {
    const options = [
      { id: 'ent_31', name: 'Jordan', type: 'organization', label: 'Jordan, organization, 40 appearances' },
      { id: 'ent_32', name: 'Michael Jordan', type: 'person', label: 'Michael Jordan, person, 900 appearances' },
    ];
    const api = upstream((url) => (url.pathname === '/v1/entities/resolve' ? Response.json({ best: null, suggested: null, ask: { question: 'Which Jordan?', options } }) : Response.json(SEARCH_BODY)));
    const reply = await callTool('arcmira_youtube_search', { query: 'sneakers', about: ['Jordan'] }, api.handler);
    assert.equal(reply.result.isError, true);
    const body = reply.result.structuredContent as { error: Record<string, unknown>; options: unknown[] };
    assert.equal(body.error.code, 'name_not_resolved');
    assert.equal(body.error.param, 'about');
    assert.deepEqual(body.options, options.map(({ id, label }) => ({ id, label })));
    assert.deepEqual(api.requests.map((url) => url.pathname), ['/v1/entities/resolve'], 'no search runs on a guess');
  });

  it('refuses a date that is not a date before any request', async () => {
    const api = upstream(() => Response.json(SEARCH_BODY));
    const reply = await callTool('arcmira_youtube_search', { query: 'agents', after: 'last week' }, api.handler);
    assert.equal(reply.result.isError, true);
    assert.match(textOf(reply), /Input validation error/);
    assert.deepEqual(api.requests, []);
  });

  it('surfaces freshness_requires_paid with its gate, unlock and limit as the API sent them', async () => {
    const unlock = { tier: 'pro', url: 'https://arcmira.com/pricing?src=mcp-tool', offer: null };
    const api = upstream(() =>
      apiError(403, { type: 'permission_error', code: 'freshness_requires_paid', gate: 'freshness', message: 'This plan reads media published through 2026-10-08.', unlock, details: { limit: { delay_days: 30, served_through: '2026-10-08' } } }),
    );
    const reply = await callTool('arcmira_youtube_search', { query: 'stablecoins', after: '2026-11-01' }, api.handler);
    assert.equal(reply.result.isError, true);
    const body = reply.result.structuredContent as { error: Record<string, unknown>; call_id: string };
    assert.equal(body.error.code, 'freshness_requires_paid');
    assert.equal(body.error.gate, 'freshness');
    assert.deepEqual(body.error.unlock, unlock);
    assert.deepEqual(body.error.details, { limit: { delay_days: 30, served_through: '2026-10-08' } });
    assert.match(body.call_id, /^mcpc_/);
    assert.deepEqual(JSON.parse(textOf(reply)), body);
  });
});

/** A long transcript: three hours, a line every 1.4 to 3.4 seconds, so some lines share a second. */
/** The API's caption note, and the sentences it adds for a default-Premium account that owns no Premium transcript. */
const CAPTION_NOTE = "This transcript is the video's own caption track. `language` says which track you got.";
const DEFAULT_PREMIUM_NOTE =
  "These are captions because this account's default transcript quality is premium and the account has no Premium transcript of this video. Pass quality=premium to start one with credits from the account's plan, then its on-demand budget, or quality=captions to drop this note.";

function longTranscript(withSpeakers: boolean) {
  const lines: Array<{ start: number; end: number; text: string; speaker?: number }> = [];
  let start = 0.37;
  for (let i = 0; start < 3 * 3600; i += 1) {
    const end = start + 1.4 + (i % 5) * 0.5;
    lines.push({ start: Math.round(start * 100) / 100, end, text: `Line ${i} of the long interview, about markets and models.`, ...(withSpeakers ? { speaker: i % 3 === 0 ? 1 : 0 } : {}) });
    start = i % 4 === 0 ? start + 0.3 : end;
  }
  return {
    state: 'ready',
    video: { id: VIDEO, title: 'The long interview', channel_id: TBPN, channel_name: 'TBPN', published_at: '2026-08-04T17:00:00.000Z', duration_seconds: 3 * 3600, watch_url: `https://www.youtube.com/watch?v=${VIDEO}` },
    quality: withSpeakers ? 'premium' : 'captions',
    source: withSpeakers ? 'arcmira_premium' : 'third_party_quick',
    language: 'en',
    languages: [],
    lines,
    ...(withSpeakers ? { speakers: [{ id: 0, name: 'John Coogan', entity_id: 'ent_98', confidence: 'high' }, { id: 1, name: 'Speaker 2', entity_id: null, confidence: null }] } : {}),
    rows_billed: withSpeakers ? 0 : 12,
    as_of: '2026-08-05T09:00:00.000Z',
  };
}

describe('arcmira_youtube_transcript', () => {
  it('is listed read-only, idempotent and open-world, with a title', async () => {
    const tool = (await listTools()).find((t) => t.name === 'arcmira_youtube_transcript');
    assert.deepEqual(tool?.annotations, { title: 'Read a YouTube transcript', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
  });

  for (const withSpeakers of [false, true]) {
    it(`reads a three-hour ${withSpeakers ? 'transcript with speakers' : 'caption track'} to the end in windows, each in the budget, with no gap or repeated line`, async () => {
      const transcript = longTranscript(withSpeakers);
      const names = ['John Coogan', 'Speaker 2'];
      const expected = transcript.lines.map((line) => `[${Math.floor(line.start)}] ${line.speaker === undefined ? '' : `${names[line.speaker]}: `}${line.text}`);
      const api = upstream(() => Response.json(transcript));
      const read: string[] = [];
      const starts: Array<number | undefined> = [];
      let start: number | undefined;
      for (let call = 0; call < 200; call += 1) {
        starts.push(start);
        const reply = await callTool('arcmira_youtube_transcript', { video: `https://youtu.be/${VIDEO}`, ...(start === undefined ? {} : { start }) }, api.handler);
        assert.equal(reply.result.isError, undefined, textOf(reply));
        const size = reply.result.content.reduce((total, block) => total + block.text.length, 0);
        assert.ok(size <= OUTPUT_BUDGET, `window from ${start ?? 0} is ${size} characters`);
        const metadata = metadataOf(reply);
        assert.deepEqual(
          { title: (metadata.video as Record<string, unknown>).title, channel: (metadata.video as Record<string, unknown>).channel_name, duration: (metadata.video as Record<string, unknown>).duration_seconds },
          { title: 'The long interview', channel: 'TBPN', duration: 10_800 },
        );
        const lines = linesOf(reply);
        assert.equal(metadata.line_count, lines.length);
        read.push(...lines);
        if (metadata.next_start === null) break;
        assert.equal(typeof metadata.next_start, 'number');
        start = metadata.next_start as number;
      }
      assert.ok(starts.length > 5, `${starts.length} windows`);
      assert.equal(read.length, expected.length, 'every line once');
      assert.deepEqual(read, expected);
      for (const url of api.requests) {
        assert.equal(url.pathname, `/v1/transcripts/${VIDEO}`);
        assert.deepEqual(Object.fromEntries(url.searchParams), { src: 'mcp-tool' }, 'no quality, retry, start or end ever goes upstream');
      }
      assert.equal(api.requests.length, starts.length, 'one read per window, no polling');
    });
  }

  it('opens at a given second and passes the language through', async () => {
    const transcript = longTranscript(false);
    const api = upstream(() => Response.json(transcript));
    const reply = await callTool('arcmira_youtube_transcript', { video: `https://www.youtube.com/shorts/${VIDEO}`, start: 3600, language: 'de,en' }, api.handler);
    const first = linesOf(reply)[0]!;
    assert.match(first, /^\[(\d+)\] /);
    const second = Number(/^\[(\d+)\]/.exec(first)![1]);
    assert.ok(second >= 3600 && second <= 3604, `first line at ${second}`);
    assert.equal(metadataOf(reply).start, 3600);
    assert.deepEqual(Object.fromEntries(api.requests[0]!.searchParams), { language: 'de,en', src: 'mcp-tool' });
  });

  it('answers past the last line with no lines and next_start null', async () => {
    const api = upstream(() => Response.json(longTranscript(false)));
    const reply = await callTool('arcmira_youtube_transcript', { video: VIDEO, start: 99_999 }, api.handler);
    assert.equal(reply.result.isError, undefined);
    assert.equal(metadataOf(reply).next_start, null);
    assert.deepEqual(linesOf(reply), []);
  });

  it('never starts or waits on a Premium transcription: a pending answer ends the call and names arcmira_execute_read', async () => {
    const api = upstream(() => Response.json({ state: 'pending', video_id: VIDEO, job: { id: 'job_1', state: 'pending', eta_seconds: 300 } }, { status: 202, headers: { 'retry-after': '10' } }));
    const reply = await callTool('arcmira_youtube_transcript', { video: VIDEO }, api.handler);
    assert.equal(reply.result.isError, true);
    const body = reply.result.structuredContent as { error: { code: string }; state: string; note: string };
    assert.equal(body.error.code, 'transcript_unavailable');
    assert.equal(body.state, 'pending');
    assert.match(body.note, /arcmira_execute_read/);
    assert.equal(api.requests.length, 1, 'no second read');
    assert.equal(api.requests[0]!.searchParams.get('quality'), null);
  });

  it('a video with no caption track is not found, with the way to a Premium transcript and no charge', async () => {
    const api = upstream(() => apiError(404, { type: 'not_found', code: 'transcript_unavailable', message: 'This video has no captions in en.' }));
    const reply = await callTool('arcmira_youtube_transcript', { video: `https://www.youtube.com/watch?v=${VIDEO}&t=42` }, api.handler);
    assert.equal(reply.result.isError, true);
    const body = JSON.parse(textOf(reply));
    assert.equal(body.error.code, 'transcript_unavailable');
    assert.equal(body.error.message, 'This video has no captions in en.');
    assert.match(body.note, /arcmira_execute_read/);
    assert.match(body.call_id, /^mcpc_/);
    assert.deepEqual(api.requests.map((url) => url.pathname), [`/v1/transcripts/${VIDEO}`]);
  });

  it('replaces the API\'s quality=premium advice to a default-Premium account with the way this server starts one, and keeps other notes as sent', async () => {
    const api = upstream(() => Response.json({ ...longTranscript(false), note: `${CAPTION_NOTE} ${DEFAULT_PREMIUM_NOTE}` }));
    const reply = await callTool('arcmira_youtube_transcript', { video: VIDEO }, api.handler);
    const note = metadataOf(reply).note as string;
    assert.ok(note.startsWith(CAPTION_NOTE), note);
    assert.doesNotMatch(note, /quality=/);
    assert.match(note, /no Premium transcript of this video\. arcmira_execute_read starts one/);

    const plain = upstream(() => Response.json({ ...longTranscript(false), note: CAPTION_NOTE }));
    assert.equal(metadataOf(await callTool('arcmira_youtube_transcript', { video: VIDEO }, plain.handler)).note, CAPTION_NOTE);
  });

  it('refuses a value that names no YouTube video before any read', async () => {
    const api = upstream(() => Response.json(longTranscript(false)));
    const reply = await callTool('arcmira_youtube_transcript', { video: 'https://vimeo.com/channels/staffpicks' }, api.handler);
    assert.equal(reply.result.isError, true);
    assert.match(textOf(reply), /YouTube video id/);
    assert.deepEqual(api.requests, []);
  });
});

describe('credentials on the plain tools', () => {
  it('a call with no credential is the 401 that names the protected-resource document', async () => {
    const response = await worker.fetch(
      new Request('https://mcp.arcmira.com/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'arcmira_youtube_transcript', arguments: { video: VIDEO } } }),
      }),
      {},
      { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext,
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer resource_metadata="https://mcp.arcmira.com/.well-known/oauth-protected-resource"');
    assert.equal(((await response.json()) as { error: { data: { code: string } } }).error.data.code, 'invalid_api_key');
  });

  it('a credential the API stops accepting mid-session comes back as its invalid_api_key error', async () => {
    for (const [tool, args] of [
      ['arcmira_youtube_search', { query: 'stablecoins' }],
      ['arcmira_youtube_transcript', { video: VIDEO }],
    ] as const) {
      const api = upstream(() => apiError(401, { type: 'authentication_error', code: 'invalid_api_key', reason: 'revoked', message: 'The key sent has been revoked.' }));
      const reply = await callTool(tool, args, api.handler);
      assert.equal(reply.result.isError, true, tool);
      const body = reply.result.structuredContent as { error: { code: string; reason: string } };
      assert.deepEqual([body.error.code, body.error.reason], ['invalid_api_key', 'revoked'], tool);
    }
  });
});

describe('/mcp/apps', () => {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request(`https://mcp.arcmira.com${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify(body),
      }),
      {},
      { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext,
    );

  it('lists only the two plain read tools and feedback, while /mcp keeps all six', async () => {
    assert.deepEqual((await listTools('/mcp/apps')).map((t) => t.name), ['arcmira_youtube_search', 'arcmira_youtube_transcript', 'arcmira_feedback']);
    assert.equal((await listTools()).length, 6);
  });

  it('sends no server instructions, since the approved ones name tools it does not serve', async () => {
    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
    const read = async (path: string) => {
      const text = await (await post(path, initialize, { authorization: 'Bearer arc_sk_fixture' })).text();
      const data = text.split('\n').find((line) => line.startsWith('data:'));
      return (JSON.parse(data ? data.slice(5) : text) as { result: { instructions?: string } }).result;
    };
    await withFetch(() => Response.json({ id: 'caller' }), async () => {
      assert.equal((await read('/mcp/apps')).instructions, undefined);
      assert.ok((await read('/mcp')).instructions);
    });
  });

  it('points its 401 at its own protected-resource document, which names /mcp/apps as the resource', async () => {
    const apps = await post('/mcp/apps', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    assert.equal(apps.status, 401);
    assert.equal(apps.headers.get('www-authenticate'), 'Bearer resource_metadata="https://mcp.arcmira.com/.well-known/oauth-protected-resource/mcp/apps"');
    const root = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    assert.equal(root.headers.get('www-authenticate'), 'Bearer resource_metadata="https://mcp.arcmira.com/.well-known/oauth-protected-resource"', '/mcp is unchanged');

    const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
    const doc = async (path: string) => (await (await worker.fetch(new Request(`https://mcp.arcmira.com${path}`), {}, ctx)).json()) as { resource: string; authorization_servers: string[] };
    assert.equal((await doc('/.well-known/oauth-protected-resource/mcp/apps')).resource, 'https://mcp.arcmira.com/mcp/apps');
    assert.equal((await doc('/.well-known/oauth-protected-resource')).resource, 'https://mcp.arcmira.com/mcp');
    assert.equal((await doc('/.well-known/oauth-protected-resource/mcp')).resource, 'https://mcp.arcmira.com/mcp');
    assert.deepEqual((await doc('/.well-known/oauth-protected-resource/mcp/apps')).authorization_servers, (await doc('/.well-known/oauth-protected-resource')).authorization_servers);
  });

  it('runs the plain tools there, and a video with no captions gets a note that names no missing tool', async () => {
    const search = upstream(() => Response.json(SEARCH_BODY));
    const found = await callTool('arcmira_youtube_search', { query: 'stablecoins' }, search.handler, {}, '/mcp/apps');
    assert.equal(found.result.isError, undefined, textOf(found));
    assert.equal(JSON.parse(textOf(found)).results.length, 1);

    const none = upstream(() => apiError(404, { type: 'not_found', code: 'transcript_unavailable', message: 'This video has no captions in en.' }));
    const reply = await callTool('arcmira_youtube_transcript', { video: VIDEO }, none.handler, {}, '/mcp/apps');
    assert.equal(reply.result.isError, true);
    assert.doesNotMatch(textOf(reply), /arcmira_execute|arcmira_describe|credits/);
    const program = (await callTool('arcmira_execute_read', { code: 'return 1' }, none.handler, {}, '/mcp/apps')) as Partial<ToolReply> & { error?: { message: string } };
    assert.ok(program.error !== undefined || program.result?.isError === true, 'the program tool is not served on /mcp/apps');
    assert.match(JSON.stringify(program), /arcmira_execute_read/);
  });

  it("keeps a default-Premium account's caption note to the caption facts: no tier, quality argument, price, credits or other tool", async () => {
    const api = upstream(() => Response.json({ ...longTranscript(false), note: `${CAPTION_NOTE} ${DEFAULT_PREMIUM_NOTE}` }));
    const note = metadataOf(await callTool('arcmira_youtube_transcript', { video: VIDEO }, api.handler, {}, '/mcp/apps')).note as string;
    assert.equal(note, CAPTION_NOTE);
    assert.doesNotMatch(note, /premium|quality|credit|price|plan|upgrade|arcmira_/i);
    const only = upstream(() => Response.json({ ...longTranscript(false), note: DEFAULT_PREMIUM_NOTE }));
    assert.equal(metadataOf(await callTool('arcmira_youtube_transcript', { video: VIDEO }, only.handler, {}, '/mcp/apps')).note, undefined);
    const plain = upstream(() => Response.json({ ...longTranscript(false), note: CAPTION_NOTE }));
    assert.equal(metadataOf(await callTool('arcmira_youtube_transcript', { video: VIDEO }, plain.handler, {}, '/mcp/apps')).note, CAPTION_NOTE);
  });
});
