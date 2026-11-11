import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, listTools, type ToolReply } from './handler.ts';
import worker from '../src/index.ts';
import { challenge } from '../src/auth.ts';

/**
 * /mcp/apps is the store surface, and store agreements forbid an upsell. Every refusal and note it can return goes
 * through here with the API's worst wording, and none may name a plan or carry a link other than a YouTube watch link.
 * /mcp keeps the API's words and unlocks.
 */

const VIDEO = 'dQw4w9WgXcQ';
/** A plan name, also inside a snake_case name like filter_requires_paid or arcmira_premium. */
const PLAN = /(?<![a-z])(?:pro\+?|premium|free|paid|upgrad\w*|trials?)(?![a-z])/i;
/** A link that is not a YouTube watch link, with or without its scheme. */
const OTHER_LINK = /https?:\/\/(?!(?:www\.)?youtube\.com\/watch\?)\S+|(?<![\w.])(?!(?:www\.)?youtube\.com\/watch\?)(?:[a-z0-9-]+\.)+(?:com|net|org|io|ai|dev|app)(?![a-z0-9-])/i;
/**
 * The one plan word apps may carry: the transcript kind arcmira_premium, as a value of the search tool's source filter
 * (its enum and the description that names its values) or of a result's source field, and nowhere else.
 */
const SOURCE_KIND = 'arcmira_premium';
/** The fields that carry a gate or an offer. */
const GATE_FIELDS = ['gate', 'details', 'unlock', 'freshness', 'access', 'doc_url'];
const PRICING = 'https://arcmira.com/pricing?src=mcp-tool';
/** A search result links its passage on Arcmira's watch page; the link is the result itself, not an offer. */
const RESULT_LINK = `https://arcmira.com/watch?v=${VIDEO}&t=10`;
const pro = { tier: 'pro', url: PRICING, offer: null };
/** Sentences a later API wording could add, each naming an offer without a plan name. */
const FUTURE_WORDING =
  'Upgrading lifts this limit. Sponsor reads cost $20 a month. Subscribe to see more. A higher tier reads them. Buy more credits at arcmira.com/dashboard/billing. Top up your credits to read this. It is 19 EUR per month. This needs the Plus or Team seat. Sign up at arcmira dot com. Use code SAVE20 for a discount. A coupon lifts this limit. Promo codes work here. Get 20% off today.';

/** The API's refusals as v1 words them today, gates and unlocks included. */
type Refusal = { status: number; error: Record<string, unknown>; body?: Record<string, unknown> };
const REFUSALS: Record<string, Refusal> = {
  filter_before: { status: 403, error: { type: 'permission_error', code: 'filter_requires_paid', gate: 'plan', param: 'before', unlock: pro, message: 'The before filter requires Pro. Open unlock.url to start a 7-day Pro trial, or omit before.' } },
  filter_source: { status: 403, error: { type: 'permission_error', code: 'filter_requires_paid', gate: 'plan', param: 'source', unlock: pro, message: 'The source filter requires Pro. Open unlock.url to start a 7-day Pro trial, or omit source.' } },
  freshness: {
    status: 403,
    error: {
      type: 'permission_error', code: 'freshness_requires_paid', gate: 'freshness', param: 'after', unlock: pro, details: { limit: { kind: 'freshness', delay_days: 30, served_through: '2026-10-11' } },
      message: 'Results on this plan stop at 2026-10-11; media published after it requires Pro. Open unlock.url to start a 7-day Pro trial, or set after to 2026-10-11 or earlier.',
    },
  },
  quota: { status: 402, error: { type: 'quota_exceeded', code: 'quota_exceeded', gate: 'rows', unlock: pro, details: { limit: { kind: 'plan_credits', used: 1000, limit: 1000 } }, message: 'This account has used its 1,000 plan credits this month. Open unlock.url to start a 7-day Pro trial.' } },
  member_limit: { status: 402, error: { type: 'quota_exceeded', code: 'member_limit', gate: 'rows', message: "The included credits are used and this person's $20 monthly on-demand limit is reached; both reset on 2026-12-01. An admin raises the limit on the Team page at https://arcmira.com/dashboard/members." } },
  feature: { status: 403, error: { type: 'permission_error', code: 'feature_not_available', gate: 'plan', unlock: { ...pro, tier: 'pro_plus' }, message: 'Sponsor reads require Pro+. Open unlock.url to start Pro+.' } },
  future_wording: { status: 403, error: { type: 'permission_error', code: 'feature_not_available', gate: 'plan', message: `${FUTURE_WORDING} Sponsor reads are not available for this key.` } },
  api: { status: 403, error: { type: 'permission_error', code: 'api_not_enabled', gate: 'plan', unlock: pro, message: 'API access requires Pro. Open unlock.url to start a 7-day Pro trial.' } },
  pagination: { status: 403, error: { type: 'permission_error', code: 'pagination_gated', gate: 'pagination', unlock: pro, message: 'Results past the first 10 require Pro. Open unlock.url to start a 7-day Pro trial, or omit cursor for the free window.' } },
  premium_quality: { status: 403, error: { type: 'permission_error', code: 'premium_transcript_requested', gate: 'exposure_law', unlock: pro, message: 'Premium transcripts require Pro. Open unlock.url to start a 7-day Pro trial.' } },
  no_captions: { status: 404, error: { type: 'not_found', code: 'transcript_unavailable', reason: 'no_captions', message: 'This video has no caption track we can read. Premium can transcribe it from the audio on a paid plan.' } },
  no_video: { status: 404, error: { type: 'not_found', code: 'transcript_unavailable', reason: 'removed', message: 'YouTube has no video with this id. It may have been removed or the link may be mistyped.' } },
  no_key: { status: 401, error: { type: 'authentication_error', code: 'invalid_api_key', reason: 'revoked', unlock: { tier: 'free', url: 'https://arcmira.com/sign-up?src=mcp-tool', offer: null, action: { kind: 'signup', method: 'POST', url: 'https://api.arcmira.com/v1/signup' } }, message: "The key sent has been revoked. If you don't have an Arcmira account yet, POST unlock.action.url with an email to create one." } },
  rate: { status: 429, error: { type: 'rate_limit_error', code: 'rate_limited', retry_after_seconds: 5, message: 'Too many requests. Retry after 5 seconds.' } },
  busy: { status: 503, error: { type: 'server_error', code: 'service_unavailable', retry_after_seconds: 5, message: 'The database is briefly overloaded. Retry after Retry-After seconds.' } },
  offer_fields: {
    status: 400,
    error: { type: 'invalid_request_error', code: 'invalid_request', reason: 'upgrade_required', message: 'This request is not valid here.' },
    body: {
      options: [{ id: 'ent_1', label: 'The Free Press', url: PRICING, note: 'Start a Pro trial at https://arcmira.com/pricing' }],
      state: 'upgrade_pending',
      languages: [{ code: 'en', name: 'English (Original)', generated: true }, { code: 'pt', name: 'Premium audio', generated: false, unlock: pro }, 'en'],
      upgrade_url: PRICING,
    },
  },
};
/** The offer_fields details as /mcp/apps keeps them: each field in its one shape, the entity name as written. */
const OFFER_FIELDS_KEPT = { options: [{ id: 'ent_1', label: 'The Free Press' }], languages: [{ code: 'en', name: 'English (Original)', generated: true }, { code: 'pt', generated: false }] };

const refusal = ({ status, error, body }: Refusal) =>
  Response.json({ ...body, error: { doc_url: `https://arcmira.com/docs/errors#${error.code}`, request_id: 'req_fixture', ...error } }, { status });

/** Every apps route that forwards an API answer: search, a search filter's name lookup, a transcript, feedback. */
const ROUTES: Array<{ name: string; tool: string; args: Record<string, unknown>; path: string }> = [
  { name: 'search', tool: 'arcmira_youtube_search', args: { query: 'stablecoins' }, path: '/v1/search' },
  { name: 'search filter lookup', tool: 'arcmira_youtube_search', args: { query: 'stablecoins', channel: ['Example Show'] }, path: '/v1/entities/resolve' },
  { name: 'transcript', tool: 'arcmira_youtube_transcript', args: { video: VIDEO }, path: `/v1/transcripts/${VIDEO}` },
  { name: 'feedback', tool: 'arcmira_feedback', args: { category: 'other', note: 'test' }, path: '/v1/feedback' },
];

/** One apps tool call; `asked` collects every upstream path the call reached. */
const replyFor = (tool: string, args: Record<string, unknown>, answer: (url: URL) => Response, path = '/mcp/apps', asked: string[] = []) =>
  callTool(tool, args, (url) => (url.pathname === '/v1/me' ? Response.json({ id: 'caller' }) : (asked.push(url.pathname), answer(url))), {}, path) as Promise<ToolReply>;

type Text = { path: string[]; text: string };

/** Every key and string in `value`, with the keys that lead to it. */
function texts(value: unknown, path: string[] = []): Text[] {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((inner) => texts(inner, [...path, '#']));
  if (value !== null && typeof value === 'object')
    return Object.entries(value).flatMap(([key, inner]) => [{ path, text: key }, ...texts(inner, [...path, key])]);
  return [];
}

/** Every key and string a reply's text blocks carry. */
function strings(reply: ToolReply): Text[] {
  return reply.result.content.flatMap((block) => {
    try {
      return texts(JSON.parse(block.text));
    } catch {
      return [{ path: [], text: block.text }];
    }
  });
}

/**
 * The names in a refusal's or search's `resolved` and `options`: an entity's name, or the name the person searched
 * for. They are data like a result title, so a name such as "The Free Press" stays as written.
 */
const ENTITY_NAME = /^(?:options\.#\.label|resolved\.#\.(?:name|matched))$/;

/** `text` with what apps may name taken out: the transcript kind where it is a source, and entity names. */
function exempt({ path, text }: Text): string {
  const at = path.join('.');
  if (ENTITY_NAME.test(at)) return '';
  if (text === SOURCE_KIND && (/(?:^|\.)source$/.test(at) || at.endsWith('properties.source.enum.#'))) return '';
  if (at.endsWith('properties.source.description')) return text.replaceAll(new RegExp(`(?<![a-z_])${SOURCE_KIND}(?![a-z_])`, 'g'), '');
  return text;
}

function assertPlanFree(found: Text[], where: string) {
  for (const { path, text } of found) {
    assert.doesNotMatch(exempt({ path, text }), PLAN, `${where} at ${path.join('.')}: ${text}`);
    assert.doesNotMatch(exempt({ path, text }), OTHER_LINK, `${where}: ${text}`);
    assert.doesNotMatch(text, /\s{2}/, `${where} has a double space: ${text}`);
    assert.ok(!GATE_FIELDS.includes(text), `${where} carries ${text}`);
  }
}

const errorOf = (reply: ToolReply) => (reply.result.structuredContent as { error: { code: string; message: string } }).error;
const bodyOf = (reply: ToolReply) => JSON.parse(reply.result.content[0]!.text) as Record<string, unknown>;

describe('/mcp/apps names no plan, price or offer', () => {
  it('in any refusal the API can send, on every route', async () => {
    for (const route of ROUTES) {
      for (const [name, sent] of Object.entries(REFUSALS)) {
        const asked: string[] = [];
        const reply = await replyFor(route.tool, route.args, (url) => (url.pathname === route.path ? refusal(sent) : Response.json({})), '/mcp/apps', asked);
        assert.ok(asked.includes(route.path), `${route.name} ${name} never reached ${route.path}`);
        assert.equal(reply.result.isError, true, `${route.name} ${name}`);
        assertPlanFree(strings(reply), `${route.name} ${name}`);
      }
    }
  });

  it('says the approved sentence and a neutral code for each gate', async () => {
    const error = async (name: string, route = ROUTES[0]!) =>
      errorOf(await replyFor(route.tool, route.args, (url) => (url.pathname === route.path ? refusal(REFUSALS[name]!) : Response.json({}))));
    assert.deepEqual(await error('filter_before'), { type: 'permission_error', param: 'before', request_id: 'req_fixture', code: 'filter_unavailable', message: "The before filter isn't available here. Search again without it." });
    assert.equal((await error('filter_source')).message, "The source filter isn't available here. Search again without it.");
    assert.deepEqual(await error('freshness'), { type: 'permission_error', param: 'after', request_id: 'req_fixture', code: 'outside_date_range', message: 'Results here cover videos published up to 2026-10-11. Set after to 2026-10-11 or earlier.' });
    assert.equal((await error('quota')).message, 'This account is out of Arcmira credits for now.');
    assert.equal((await error('member_limit')).message, 'This account is out of Arcmira credits for now.');
    assert.equal((await error('premium_quality')).code, 'not_available');
    assert.equal((await error('future_wording')).message, 'Sponsor reads are not available for this key.', 'only the plain sentence of a new wording passes');
    assert.equal((await error('rate')).message, 'Too many requests. Retry after 5 seconds.', 'a refusal with no offer keeps its words');
    assert.equal((await error('no_key')).message, 'The key sent has been revoked.');
  });

  it("answers a transcript with the caption sentence, or with YouTube's own not-found sentence and no caption note", async () => {
    const transcript = ROUTES[2]!;
    const read = (name: string) => replyFor(transcript.tool, transcript.args, () => refusal(REFUSALS[name]!));
    const noCaptions = await read('no_captions');
    assert.equal(errorOf(noCaptions).message, 'This video has no caption track Arcmira can read, so there are no lines to return.');
    const noVideo = await read('no_video');
    assert.equal(errorOf(noVideo).message, 'YouTube has no video with this id. It may have been removed or the link may be mistyped.');
    assert.equal(bodyOf(noVideo).note, undefined, 'a video that does not exist has no caption track to explain');
    const upstreamChanged = await replyFor(transcript.tool, transcript.args, () =>
      refusal({ status: 404, error: { type: 'not_found', code: 'transcript_unavailable', reason: 'removed', message: 'YouTube has no such video. Premium cannot help.' } }));
    assert.equal(errorOf(upstreamChanged).message, 'This video has no caption track Arcmira can read, so there are no lines to return.', 'only the exact sentence passes');
  });

  it('says a transcript Arcmira is still preparing is not ready, never captionless', async () => {
    const transcript = ROUTES[2]!;
    for (const [status, body, message] of [
      [202, { state: 'pending', quality: 'premium', video_id: VIDEO, job: { status: 'running', next_poll_seconds: 30 } }, 'Arcmira is still preparing this transcript. Read it again in a minute.'],
      [202, { state: 'Pending', quality: 'premium', video_id: VIDEO }, "Arcmira can't return this here."],
      [200, { state: 'failed', quality: 'premium', video_id: VIDEO, note: 'The last Premium transcript for this video failed. Read again with retry=true.' }, "Arcmira can't return this here."],
      [200, { state: 'preparation_required', quality: 'premium', video_id: VIDEO, quote: { rows: 4 } }, "Arcmira can't return this here."],
      [404, { state: 'pending', error: { type: 'not_found', code: 'transcript_unavailable', message: 'Premium is still transcribing this video.' } }, 'Arcmira is still preparing this transcript. Read it again in a minute.'],
    ] as const) {
      const reply = await replyFor(transcript.tool, transcript.args, () => Response.json(body, { status }));
      assert.equal(errorOf(reply).message, message, body.state);
      assert.equal(bodyOf(reply).note, undefined, body.state);
      assertPlanFree(strings(reply), `transcript ${body.state}`);
    }
  });

  it("in a search answer's note when the account's results stop before today", async () => {
    const search = ROUTES[0]!;
    const hit = 'Quote text as a spoken beat of a few sentences and cite watch_url with published_at.';
    const cut = 'Results on this plan stop at 2026-10-11; media published after it requires Pro. Open unlock.url to start a 7-day Pro trial.';
    const gate = { freshness: { delay_days: 30, served_through: '2026-10-11' }, unlock: pro };
    const chunk = { video_id: VIDEO, video_title: 'A video', channel_name: 'A show', published_at: '2026-09-01T00:00:00Z', start_seconds: 10, watch_url: RESULT_LINK, text: 'a line' };
    const answer = (body: Record<string, unknown>) => replyFor(search.tool, search.args, () => Response.json(body));

    const matched = bodyOf(await answer({ chunks: [chunk], window: { after: '2026-08-12T00:00:00Z', before: null }, note: `${cut} ${hit}`, ...gate }));
    assert.equal(matched.note, `These results cover videos published from 2026-08-12 to 2026-10-11. ${hit}`);
    assert.deepEqual([matched.freshness, matched.unlock, matched.access], [undefined, undefined, undefined]);

    const none = bodyOf(await answer({ chunks: [], window: { after: '2026-08-12T00:00:00Z', before: null }, note: `No match before 2026-10-11. ${cut} ${hit} Or move after earlier.`, ...gate }));
    assert.equal(none.note, `Nothing matched in videos published from 2026-08-12 to 2026-10-11. ${hit} Or move after earlier.`);
    const noneThenHit = bodyOf(await answer({ chunks: [], window: { after: '2026-08-12T00:00:00Z', before: null }, note: `No match before 2026-10-11. ${hit}`, ...gate }));
    assert.equal(noneThenHit.note, `Nothing matched in videos published from 2026-08-12 to 2026-10-11. ${hit}`, 'one space between sentences');

    const open = bodyOf(await answer({ chunks: [chunk], window: { after: null, before: null }, note: cut, ...gate }));
    assert.equal(open.note, 'These results cover videos published up to 2026-10-11.');

    const openNone = bodyOf(await answer({ chunks: [], window: { after: null, before: null }, note: `No match before 2026-10-11. ${cut}`, ...gate }));
    assert.equal(openNone.note, 'No match before 2026-10-11.', 'no unapproved dates sentence when no after date is known');

    for (const body of [matched, none, open]) assertPlanFree([{ path: ['note'], text: String(body.note) }], 'search note');
  });

  it('keeps only the fields the tools know in an answer', async () => {
    const search = ROUTES[0]!;
    const chunk = { video_id: VIDEO, video_title: 'A video', channel_name: 'A show', start_seconds: 10, watch_url: RESULT_LINK, source: SOURCE_KIND, text: 'a line' };
    const searched = await replyFor(search.tool, { query: 'stablecoins', about: ['Example Co'] }, (url) =>
      url.pathname === '/v1/entities/resolve'
        ? Response.json({ best: null, suggested: { id: 'ent_1', name: 'Example Co', evidence: `Most appearances. ${FUTURE_WORDING}` }, ask: null })
        : Response.json({
            chunks: [chunk],
            window: { after: '2026-08-12T00:00:00Z', before: null, note: FUTURE_WORDING },
            search_index: { state: 'catching_up', missing_before: '2026-03-01', note: FUTURE_WORDING, upgrade_url: PRICING },
            note: FUTURE_WORDING,
          }));
    assertPlanFree(strings(searched).filter(({ text }) => text !== RESULT_LINK), 'search answer');
    const body = bodyOf(searched);
    assert.deepEqual(body.window, { after: '2026-08-12T00:00:00Z' });
    assert.deepEqual(body.search_index, { state: 'catching_up', missing_before: '2026-03-01' });
    assert.deepEqual(body.resolved, [{ filter: 'about', name: 'Example Co', matched: 'Example Co', id: 'ent_1', assumed: 'Most appearances.' }]);
    assert.equal(body.note, undefined);

    const feedback = ROUTES[3]!;
    const recorded = await replyFor(feedback.tool, feedback.args, () => Response.json({ feedback_id: 42, note: FUTURE_WORDING, unlock: pro }, { status: 201 }));
    assert.deepEqual(recorded.result.structuredContent, { feedback_id: 42, recorded: true });
  });

  it("keeps a refusal's details in their one shape on every route", async () => {
    for (const route of ROUTES) {
      const reply = await replyFor(route.tool, route.args, (url) => (url.pathname === route.path ? refusal(REFUSALS.offer_fields!) : Response.json({})));
      const { error, call_id, ...details } = bodyOf(reply);
      assert.ok(error, route.name);
      assert.ok(call_id === undefined || typeof call_id === 'string', route.name);
      assert.deepEqual(details, OFFER_FIELDS_KEPT, route.name);
    }
  });

  it('keeps entity names in resolved and options as written, and nothing beside them', async () => {
    const search = ROUTES[0]!;
    const ask = await replyFor(search.tool, { query: 'stablecoins', about: ['Free Press'] }, () =>
      Response.json({ best: null, suggested: null, ask: { options: [{ id: 'ent_1', label: 'The Free Press' }, { id: 'ent_2', label: 'Pro Football Focus', hint: 'Start a Pro trial' }] } }));
    assert.deepEqual(bodyOf(ask).options, [{ id: 'ent_1', label: 'The Free Press' }, { id: 'ent_2', label: 'Pro Football Focus' }]);
    assertPlanFree(strings(ask), 'name lookup options');

    const named = (sent: Response) =>
      replyFor(search.tool, { query: 'stablecoins', about: ['The Free Press'] }, (url) =>
        url.pathname === '/v1/entities/resolve' ? Response.json({ best: { id: 'ent_1', name: 'The Free Press' }, suggested: null, ask: null }) : sent);
    const resolved = [{ filter: 'about', name: 'The Free Press', matched: 'The Free Press', id: 'ent_1' }];
    const refused = await named(refusal(REFUSALS.filter_before!));
    assert.deepEqual(bodyOf(refused).resolved, resolved);
    assertPlanFree(strings(refused), 'refusal resolved');
    const answered = await named(Response.json({ chunks: [] }));
    assert.deepEqual(bodyOf(answered).resolved, resolved);
    assertPlanFree(strings(answered), 'answer resolved');

    // The exemption covers those names alone: a sentence with a plan word beside them still fails the check.
    for (const path of [['options', '#', 'hint'], ['resolved', '#', 'assumed'], ['note'], ['error', 'message']])
      assert.throws(() => assertPlanFree([{ path, text: 'The Free Press needs a Pro trial.' }], 'beside a name'), assert.AssertionError, path.join('.'));
  });

  it('links a result only to the second it was said', async () => {
    const search = ROUTES[0]!;
    const transcript = ROUTES[2]!;
    const pricing = 'https://arcmira.com/pricing?src=mcp-tool';
    const hit = { video_id: VIDEO, video_title: 'A video', start_seconds: 10, watch_url: pricing, text: 'a line' };
    for (const [path, has] of [['/mcp/apps', false], ['/mcp', true]] as const) {
      const searched = bodyOf(await replyFor(search.tool, search.args, () => Response.json({ chunks: [hit] }), path)) as { results: Array<Record<string, unknown>> };
      assert.equal('watch_url' in searched.results[0]!, has, `search on ${path}`);
      const read = bodyOf(await replyFor(transcript.tool, transcript.args, () => Response.json({ state: 'ready', video: { id: VIDEO, watch_url: pricing }, lines: [{ start: 0, text: 'a line' }] }), path)) as { video: Record<string, unknown> };
      assert.equal('watch_url' in read.video, has, `transcript on ${path}`);
    }
    const kept = bodyOf(await replyFor(search.tool, search.args, () => Response.json({ chunks: [{ ...hit, watch_url: RESULT_LINK }] }))) as { results: Array<Record<string, unknown>> };
    assert.equal(kept.results[0]!.watch_url, RESULT_LINK);

    const linked = async (watch_url: string, path = '/mcp/apps') =>
      ((bodyOf(await replyFor(search.tool, search.args, () => Response.json({ chunks: [{ ...hit, watch_url }] }), path)) as { results: Array<Record<string, unknown>> }).results[0]!.watch_url);
    for (const link of [
      `https://arcmira.com/watch?v=${VIDEO}&t=10&src=mcp-tool&ah=api_key&ac=mcpc_5525d340538049f69d927c10dc47d7d0`,
      `https://www.youtube.com/watch?v=${VIDEO}&t=10s`,
      `https://www.youtube.com/watch?v=${VIDEO}`,
    ])
      assert.equal(await linked(link), link, 'a watch link with no offer stays');
    for (const offer of ['coupon=SAVE20', 'utm_campaign=pro_trial', 'next=https%3A%2F%2Farcmira.com%2Fpricing', 'ref=arcmira.com/pricing', 'promo=1', 'note=20%25%20off', 'v=free_trial']) {
      const link = `https://arcmira.com/watch?v=${VIDEO}&t=10&${offer}`;
      assert.equal(await linked(link), undefined, offer);
      assert.equal(await linked(link, '/mcp'), link, `/mcp keeps ${offer}`);
    }
  });

  it('asks for a credential with no offer, and /mcp keeps its sign-up action', async () => {
    const send = (path: string) =>
      worker.fetch(new Request(`https://mcp.arcmira.com${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }), {}, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
    const apps = await send('/mcp/apps');
    assert.equal(apps.status, 401);
    const body = (await apps.json()) as { error: { message: string; data: Record<string, unknown> } };
    assertPlanFree(texts(body), 'apps challenge');
    assert.equal(body.error.message, 'No credential was sent. Sign in through the host, or send Authorization: Bearer with an account key.');
    const { request_id: requestId, ...data } = body.error.data;
    assert.match(String(requestId), /^mcp_/);
    assert.deepEqual(data, { type: 'authentication_error', reason: 'no_credential', code: 'invalid_api_key', message: body.error.message });

    // The key check caches a live key, so a refused key is checked at the challenge itself.
    for (const [reason, message] of [['revoked', 'The key sent has been revoked.'], ['invalid', 'The key sent is not a live account key.']] as const) {
      const refused = (await challenge('https://mcp.arcmira.com', reason, '/mcp/apps').json()) as { error: { message: string } };
      assertPlanFree(texts(refused), `apps ${reason} challenge`);
      assert.equal(refused.error.message, message);
    }

    const program = (await (await send('/mcp')).json()) as { error: { data: { unlock?: unknown } } };
    assert.ok(program.error.data.unlock, '/mcp keeps the sign-up action');
  });

  it("names no price in the apps tools' descriptions", async () => {
    const describe = async (path: string) => ((await listTools(path)) as unknown as Array<{ name: string; description: string }>).find((tool) => tool.name === 'arcmira_feedback')!.description;
    assert.doesNotMatch(await describe('/mcp/apps'), /cost/i);
    assert.match(await describe('/mcp'), /Costs nothing\./);
  });

  it('names the transcript kind arcmira_premium only as a source value', async () => {
    const tools = await listTools('/mcp/apps');
    const listed = texts(tools).filter(({ path }) => path.at(-1) !== '$schema');
    assert.ok(listed.some(({ text }) => text === SOURCE_KIND), 'the source filter offers the kind');
    // The tool list names youtube.com as where a video comes from, so only its plan words are checked.
    for (const found of listed) assert.doesNotMatch(exempt(found), PLAN, `apps tool list at ${found.path.join('.')}: ${found.text}`);

    const transcript = ROUTES[2]!;
    const read = await replyFor(transcript.tool, transcript.args, () =>
      Response.json({ state: 'ready', video: { id: VIDEO, title: 'A video', watch_url: `https://www.youtube.com/watch?v=${VIDEO}` }, source: SOURCE_KIND, lines: [{ start: 0, text: 'a line' }], note: 'Premium transcripts name who spoke. Speakers are labelled.' }));
    const found = strings(read);
    assert.ok(found.some(({ path, text }) => path.join('.') === 'source' && text === SOURCE_KIND));
    assertPlanFree(found, 'transcript answer');

    assert.throws(() => assertPlanFree([{ path: ['note'], text: SOURCE_KIND }], 'a note'), 'the kind is exempt only in source');
    assert.throws(() => assertPlanFree([{ path: ['source'], text: 'Premium' }], 'a source'), 'a plan word in source still fails');
    assert.throws(() => assertPlanFree([{ path: ['tools', '#', 'inputSchema', 'properties', 'source', 'description'], text: `${SOURCE_KIND} is Premium.` }], 'a description'), 'a sentence naming Premium still fails');
  });

  it('answers a retired /mcp tool name as an unknown tool', async () => {
    const reply = await callTool('prepare_transcript', { video: VIDEO }, () => Response.json({ id: 'caller' }), {}, '/mcp/apps');
    const text = JSON.stringify(reply);
    assert.doesNotMatch(text, PLAN);
    assert.doesNotMatch(text, /arcmira_execute_read|was retired/);
  });

  it('while /mcp keeps the API words, the unlock and the order of its fields', async () => {
    const search = ROUTES[0]!;
    const reply = await replyFor(search.tool, search.args, () => refusal(REFUSALS.filter_before!), '/mcp');
    const error = (reply.result.structuredContent as { error: { code: string; message: string; unlock: unknown } }).error;
    assert.equal(error.code, 'filter_requires_paid');
    assert.match(error.message, /requires Pro/);
    assert.deepEqual(error.unlock, pro);

    const answer = bodyOf(
      await replyFor(search.tool, search.args, () =>
        Response.json({
          access: { tier: 'free' },
          unlock: pro,
          freshness: { delay_days: 30, served_through: '2026-10-11' },
          search_index: { state: 'catching_up' },
          note: 'Results on this plan stop at 2026-10-11.',
          as_of: '2026-11-10T00:00:00Z',
          window: { after: null, before: null },
          chunks: [],
        }), '/mcp'),
    );
    assert.deepEqual(Object.keys(answer), ['results', 'window', 'as_of', 'note', 'search_index', 'freshness', 'unlock', 'access', 'call_id']);
    assert.equal(answer.note, 'Results on this plan stop at 2026-10-11.');

    const retired = await callTool('prepare_transcript', { video: VIDEO }, () => Response.json({ id: 'caller' }), {}, '/mcp');
    assert.match(JSON.stringify(retired), /was retired/);
  });
});
