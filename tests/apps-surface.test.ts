import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, type ToolReply } from './handler.ts';

/**
 * /mcp/apps is the store surface, and store agreements forbid an upsell. Every refusal and note it can return goes
 * through here with the API's worst wording, and none may name a plan or carry a link other than a YouTube watch link.
 * /mcp keeps the API's words and unlocks.
 */

const VIDEO = 'dQw4w9WgXcQ';
const PLAN = /\b(?:Pro\+?|Premium|Free|paid|upgrade|trial)\b/i;
const OTHER_LINK = /https?:\/\/(?!(?:www\.)?youtube\.com\/watch\?)\S+/i;
const PRICING = 'https://arcmira.com/pricing?src=mcp-tool';
const pro = { tier: 'pro', url: PRICING, offer: null };

/** The API's refusals as v1 words them today, gates and unlocks included. */
const REFUSALS: Record<string, { status: number; error: Record<string, unknown> }> = {
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
  api: { status: 403, error: { type: 'permission_error', code: 'api_not_enabled', gate: 'plan', unlock: pro, message: 'API access requires Pro. Open unlock.url to start a 7-day Pro trial.' } },
  pagination: { status: 403, error: { type: 'permission_error', code: 'pagination_gated', gate: 'pagination', unlock: pro, message: 'Results past the first 10 require Pro. Open unlock.url to start a 7-day Pro trial, or omit cursor for the free window.' } },
  premium_quality: { status: 403, error: { type: 'permission_error', code: 'premium_transcript_requested', gate: 'exposure_law', unlock: pro, message: 'Premium transcripts require Pro. Open unlock.url to start a 7-day Pro trial.' } },
  no_captions: { status: 404, error: { type: 'not_found', code: 'transcript_unavailable', reason: 'no_captions', message: 'This video has no caption track we can read. Premium can transcribe it from the audio on a paid plan.' } },
  no_video: { status: 404, error: { type: 'not_found', code: 'transcript_unavailable', reason: 'removed', message: 'YouTube has no video with this id. It may have been removed or the link may be mistyped.' } },
  no_key: { status: 401, error: { type: 'authentication_error', code: 'invalid_api_key', reason: 'revoked', unlock: { tier: 'free', url: 'https://arcmira.com/sign-up?src=mcp-tool', offer: null, action: { kind: 'signup', method: 'POST', url: 'https://api.arcmira.com/v1/signup' } }, message: "The key sent has been revoked. If you don't have an Arcmira account yet, POST unlock.action.url with an email to create one." } },
  rate: { status: 429, error: { type: 'rate_limit_error', code: 'rate_limited', retry_after_seconds: 5, message: 'Too many requests. Retry after 5 seconds.' } },
  busy: { status: 503, error: { type: 'server_error', code: 'service_unavailable', retry_after_seconds: 5, message: 'The database is briefly overloaded. Retry after Retry-After seconds.' } },
};

const refusal = ({ status, error }: { status: number; error: Record<string, unknown> }) =>
  Response.json({ error: { doc_url: `https://arcmira.com/docs/errors#${error.code}`, request_id: 'req_fixture', ...error } }, { status });

/** Every apps route that forwards an API answer: search, a search filter's name lookup, a transcript, feedback. */
const ROUTES: Array<{ name: string; tool: string; args: Record<string, unknown>; path: string }> = [
  { name: 'search', tool: 'arcmira_youtube_search', args: { query: 'stablecoins' }, path: '/v1/search' },
  { name: 'search filter lookup', tool: 'arcmira_youtube_search', args: { query: 'stablecoins', channel: ['TBPN'] }, path: '/v1/entities/resolve' },
  { name: 'transcript', tool: 'arcmira_youtube_transcript', args: { video: VIDEO }, path: `/v1/transcripts/${VIDEO}` },
  { name: 'feedback', tool: 'arcmira_feedback', args: { category: 'wrong_result', note: 'test' }, path: '/v1/feedback' },
];

const replyFor = (tool: string, args: Record<string, unknown>, answer: (url: URL) => Response, path = '/mcp/apps') =>
  callTool(tool, args, (url) => (url.pathname === '/v1/me' ? Response.json({ id: 'caller' }) : answer(url)), {}, path) as Promise<ToolReply>;

/** Every key and string a reply's text blocks carry. */
function strings(reply: ToolReply): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') for (const [key, inner] of Object.entries(value)) (out.push(key), walk(inner));
  };
  for (const block of reply.result.content) {
    try {
      walk(JSON.parse(block.text));
    } catch {
      out.push(block.text);
    }
  }
  return out;
}

function assertPlanFree(texts: string[], where: string) {
  for (const text of texts) {
    assert.doesNotMatch(text, PLAN, `${where}: ${text}`);
    assert.doesNotMatch(text, OTHER_LINK, `${where}: ${text}`);
    assert.notEqual(text, 'unlock', `${where} carries an unlock`);
  }
}

const errorOf = (reply: ToolReply) => (reply.result.structuredContent as { error: { message: string } }).error;
const bodyOf = (reply: ToolReply) => JSON.parse(reply.result.content[0]!.text) as Record<string, unknown>;

describe('/mcp/apps names no plan, price or offer', () => {
  it('in any refusal the API can send, on every route', async () => {
    for (const route of ROUTES) {
      for (const [name, sent] of Object.entries(REFUSALS)) {
        const reply = await replyFor(route.tool, route.args, (url) => (url.pathname === route.path ? refusal(sent) : Response.json({})));
        assert.equal(reply.result.isError, true, `${route.name} ${name}`);
        assertPlanFree(strings(reply), `${route.name} ${name}`);
      }
    }
  });

  it('says the approved sentence for each gate', async () => {
    const message = async (name: string, route = ROUTES[0]!) =>
      errorOf(await replyFor(route.tool, route.args, (url) => (url.pathname === route.path ? refusal(REFUSALS[name]!) : Response.json({})))).message;
    assert.equal(await message('filter_before'), "The before filter isn't available here. Search again without it.");
    assert.equal(await message('filter_source'), "The source filter isn't available here. Search again without it.");
    assert.equal(await message('freshness'), 'Results here cover videos published up to 2026-10-11. Set after to 2026-10-11 or earlier.');
    assert.equal(await message('quota'), 'This account is out of Arcmira credits for now.');
    assert.equal(await message('member_limit'), 'This account is out of Arcmira credits for now.');
    assert.equal(await message('rate'), 'Too many requests. Retry after 5 seconds.', 'a refusal with no offer keeps its words');
    assert.equal(await message('no_key'), 'The key sent has been revoked.');
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

  it("in a search answer's note when the account's results stop before today", async () => {
    const search = ROUTES[0]!;
    const hit = 'Quote text as a spoken beat of a few sentences and cite watch_url with published_at.';
    const cut = 'Results on this plan stop at 2026-10-11; media published after it requires Pro. Open unlock.url to start a 7-day Pro trial.';
    const gate = { freshness: { delay_days: 30, served_through: '2026-10-11' }, unlock: pro };
    const chunk = { video_id: VIDEO, video_title: 'A video', channel_name: 'A show', published_at: '2026-09-01T00:00:00Z', start_seconds: 10, watch_url: `https://arcmira.com/watch?v=${VIDEO}&t=10`, text: 'a line' };
    const answer = (body: Record<string, unknown>) => replyFor(search.tool, search.args, () => Response.json(body));

    const matched = bodyOf(await answer({ chunks: [chunk], window: { after: '2026-08-12T00:00:00Z', before: null }, note: `${cut} ${hit}`, ...gate }));
    assert.equal(matched.note, `These results cover videos published from 2026-08-12 to 2026-10-11. ${hit}`);
    assert.deepEqual([matched.freshness, matched.unlock, matched.access], [undefined, undefined, undefined]);

    const none = bodyOf(await answer({ chunks: [], window: { after: '2026-08-12T00:00:00Z', before: null }, note: 'No match before 2026-10-11. Results on this plan stop at 2026-10-11; media published after it requires Pro. Open unlock.url to start a 7-day Pro trial, or move after earlier.', ...gate }));
    assert.equal(none.note, 'Nothing matched in videos published from 2026-08-12 to 2026-10-11.');

    const open = bodyOf(await answer({ chunks: [chunk], window: { after: null, before: null }, note: cut, ...gate }));
    assert.equal(open.note, 'These results cover videos published up to 2026-10-11.');

    for (const body of [matched, none, open]) assertPlanFree([String(body.note)], 'search note');
  });

  it('while /mcp keeps the API words and the unlock', async () => {
    const search = ROUTES[0]!;
    const reply = await replyFor(search.tool, search.args, () => refusal(REFUSALS.filter_before!), '/mcp');
    const error = (reply.result.structuredContent as { error: { message: string; unlock: unknown } }).error;
    assert.match(error.message, /requires Pro/);
    assert.deepEqual(error.unlock, pro);
  });
});
