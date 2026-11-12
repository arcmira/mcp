import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fakeLoader } from './fake-loader.ts';
import { callTool, callTools, listTools, textOf } from './handler.ts';
import { READ_ONLY_MESSAGES, READ_ONLY_REQUEST, readOnlyRefusal } from './read-only-refusal.ts';
import { TOOL_CALLS_PATH } from '../src/telemetry.ts';

const MARK = 'x-arcmira-read-only';
/** The route of the record the Worker posts after each tool call. */
const RECORD = `POST ${TOOL_CALLS_PATH}`;
const OWNED = 'cdLeJU_1UH8';
const NOT_OWNED = 'dQw4w9WgXcQ';
const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';
const APPROVED =
  'This read would start a Premium transcript or translation, and arcmira_execute_read only reads, so nothing was charged. Run it in arcmira_execute_write. It uses credits from your plan, then your on-demand budget.';

interface Sent {
  route: string;
  /** The read-only header as sent, or null when the request had none. */
  mark: string | null;
}

/**
 * The API as its change of 2026-11-12 describes it, where any value but 0 marks a request. A marked Premium read of a transcript the account does not own,
 * with or without retry, and a marked Premium read in a language it has not paid for, answer 403 read_only_request.
 * The same reads unmarked are served, and so is everything else, each call's record included.
 */
function api(sent: Sent[]) {
  return (url: URL, init?: RequestInit): Response => {
    const mark = new Headers(init?.headers).get(MARK);
    const marked = mark !== null && mark !== '0';
    sent.push({ route: `${init?.method ?? 'GET'} ${url.pathname}${url.search.replace(/[?&]src=mcp-tool/, '')}`, mark });
    const video = url.pathname.match(/^\/v1\/transcripts\/([\w-]{11})$/)?.[1];
    if (video && url.searchParams.get('quality') === 'premium') {
      const owned = video === OWNED && !url.searchParams.get('language');
      if (marked && !owned)
        return Response.json(readOnlyRefusal(READ_ONLY_MESSAGES.premium), { status: 403, headers: { 'ratelimit-limit': '20', 'ratelimit-remaining': '18', 'ratelimit-reset': '5' } });
      return Response.json({
        state: 'ready',
        quality: 'premium',
        video: { id: video },
        lines: [{ start: 0, end: 2, text: 'Hello.', speaker: 0 }],
        speakers: [{ id: 0, name: 'Speaker 1', entity_id: null }],
        ...(owned ? {} : { charge: { unit: 'credits', amount: 300, from: 'included' } }),
      });
    }
    return Response.json({
      best: { id: 'ent_14', name: 'TBPN', youtube_channel_id: TBPN },
      chunks: [],
      state: 'ready',
      video: { id: video ?? NOT_OWNED },
      lines: [],
      feedback_id: 1,
      monitor: { id: 'mon_1' },
      monitors: [],
    });
  };
}

// The Worker checks an account key once per isolate. Listing the tools first keeps that check out of every recording below.
before(() => listTools());

/** One call for every tool either endpoint lists, each making the upstream requests that tool makes. */
const SAMPLE_CALLS: Readonly<Record<string, Record<string, unknown>>> = {
  arcmira_describe: {},
  arcmira_execute_read: { code: 'await arcmira.status({}); return (await fetch("https://api.arcmira.com/v1/me")).status;' },
  arcmira_execute_write: { code: 'await arcmira.monitors.update("mon_1", { paused: true }); return (await fetch("https://api.arcmira.com/v1/monitors")).status;' },
  arcmira_youtube_search: { query: 'corporate cards', channel: ['TBPN'] },
  arcmira_youtube_transcript: { video: NOT_OWNED, language: 'ja' },
  arcmira_feedback: { category: 'slow', note: 'The search took a minute.' },
};

describe('the read-only mark follows the read-only annotation', () => {
  for (const path of ['/mcp', '/mcp/apps']) {
    it(`on ${path}, every request a call of a tool annotated read-only sends carries x-arcmira-read-only: 1, its record included, and no other tool's call sends the header`, async () => {
      const tools = await listTools(path);
      assert.ok(tools.length > 0);
      for (const tool of tools) {
        const args = SAMPLE_CALLS[tool.name];
        assert.ok(args, `${tool.name} has no sample call, so its mark is untested`);
        const sent: Sent[] = [];
        const reply = await callTool(tool.name, args, api(sent), { LOADER: fakeLoader() }, path);
        assert.equal(reply.result.isError, undefined, `${tool.name}: ${textOf(reply)}`);
        const readOnly = tool.annotations.readOnlyHint === true;
        assert.equal(sent.at(-1)?.route, RECORD, `${tool.name}: the call's record is its last request`);
        assert.equal(sent.filter((request) => request.route === RECORD).length, 1, `${tool.name} posts one record`);
        if (tool.name === 'arcmira_describe') assert.deepEqual(sent.map((request) => request.route), [RECORD], 'describe reads nothing from the API');
        else assert.ok(sent.length > 1, `${tool.name} made no API request besides its record`);
        for (const request of sent) assert.equal(request.mark, readOnly ? '1' : null, `${path} ${tool.name} (readOnlyHint ${readOnly}) sent ${request.route} with ${MARK}: ${request.mark}`);
      }
    });
  }

  for (const path of ['/mcp', '/mcp/apps']) {
    it(`on ${path}, a read tool call and a feedback call in one HTTP request each send their own mark, call and tool, records included`, async () => {
      const sent: Array<{ route: string; mark: string | null; call: string | null; tool: string | null }> = [];
      const records: Array<{ mark: string | null; call: string; tool: string }> = [];
      let feedbackSent!: () => void;
      const feedback = new Promise<void>((resolve) => (feedbackSent = resolve));
      const upstream = async (url: URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (url.pathname === TOOL_CALLS_PATH) {
          const { call_id, tool } = JSON.parse(String(init?.body)) as { call_id: string; tool: string };
          records.push({ mark: headers.get(MARK), call: call_id, tool });
          return new Response(null, { status: 202 });
        }
        sent.push({ route: `${init?.method ?? 'GET'} ${url.pathname}`, mark: headers.get(MARK), call: headers.get('x-arcmira-mcp-call'), tool: headers.get('x-arcmira-mcp-tool') });
        if (url.pathname === '/v1/feedback') feedbackSent();
        // The read call's channel lookup answers only after the feedback call has started and sent its request.
        if (url.pathname === '/v1/entities/resolve') await Promise.race([feedback, new Promise((resolve) => setTimeout(resolve, 2_000))]);
        return api([])(url, init);
      };
      const replies = await callTools(
        [
          { name: 'arcmira_youtube_search', arguments: SAMPLE_CALLS.arcmira_youtube_search! },
          { name: 'arcmira_feedback', arguments: SAMPLE_CALLS.arcmira_feedback! },
        ],
        upstream,
        {},
        path,
      );
      for (const reply of replies) assert.equal(reply.result.isError, undefined, textOf(reply));
      assert.deepEqual(
        sent.map((request) => request.route),
        ['GET /v1/entities/resolve', 'POST /v1/feedback', 'GET /v1/search'],
        "the feedback call's request goes out between the read call's two requests",
      );
      const [resolve, posted, search] = sent;
      for (const request of [resolve!, search!]) assert.deepEqual([request.mark, request.tool, request.call], ['1', 'arcmira_youtube_search', resolve!.call], `${path} read call sent ${request.route}`);
      assert.deepEqual([posted!.mark, posted!.tool], [null, 'arcmira_feedback'], `${path} feedback call sent ${posted!.route}`);
      assert.notEqual(posted!.call, resolve!.call);
      assert.deepEqual(
        [...records].sort((a, b) => a.tool.localeCompare(b.tool)),
        [
          { mark: null, call: posted!.call, tool: 'arcmira_feedback' },
          { mark: '1', call: resolve!.call, tool: 'arcmira_youtube_search' },
        ],
        `${path}: each call's record carries that call's mark`,
      );
    });
  }

  it('lists arcmira_execute_read read-only and arcmira_execute_write titled for monitors and Premium transcripts', async () => {
    const tools = new Map((await listTools()).map((tool) => [tool.name, tool]));
    assert.equal(tools.get('arcmira_execute_read')?.annotations.readOnlyHint, true);
    assert.equal(tools.get('arcmira_execute_write')?.annotations.readOnlyHint, false);
    assert.equal(tools.get('arcmira_execute_write')?.annotations.title, 'Monitors and Premium transcripts');
    assert.equal(tools.size, 6);
  });
});

/** Every request an arcmira_execute_read program can send, by client method or raw fetch(), with what it reads back. */
const READ_PROGRAM = `
const raw = async (path) => { const r = await fetch("https://api.arcmira.com" + path); return r.status; };
await arcmira.resolve("Ramp", { type: "organization", context: "the corporate card", limit: 8 });
await arcmira.search({ query: "Ramp", channelIds: ["${TBPN}"], about: ["ent_14"], entityIds: ["ent_14"], speakerIds: ["ent_99"], kind: ["sponsored"], after: "2026-01-01", before: "2026-09-01", source: "creator_captions", limit: 5 });
await arcmira.mentions({ entityId: "ent_14", channelId: "${TBPN}", mode: "appearances", limit: 10, cursor: "c" });
await arcmira.momentum("ent_14", { days: 30 });
await arcmira.sponsors("${TBPN}", { minAdReads: 3, status: "active", limit: 10 });
await arcmira.recommendations("ent_14", { kind: "organic", channelId: "${TBPN}", limit: 10, cursor: "c" });
await arcmira.episodes("${TBPN}", { limit: 10 });
await arcmira.transcript("${NOT_OWNED}", { quality: "captions", language: "en", timestamps: false, start: 0, end: 60 });
await arcmira.transcript("${OWNED}", { quality: "premium" });
await arcmira.occurrences({ channelIds: ["${TBPN}"], entityIds: ["ent_14"], videoIds: ["${NOT_OWNED}"], types: ["topic"], mode: "mentions", limit: 20 });
await arcmira.price("${NOT_OWNED}");
await arcmira.quote("${NOT_OWNED}");
await arcmira.status({ channelId: "${TBPN}" });
await arcmira.status({});
await arcmira.integrations.slack();
await arcmira.monitors.list();
await arcmira.monitors.trackers("mon_1");
await arcmira.monitors.alerts("mon_1", { limit: 5 });
const refused = [];
for (const options of [{ quality: "premium" }, { quality: "premium", retry: true }, { quality: "premium", language: "ja" }]) {
  try { await arcmira.transcript("${NOT_OWNED}", options); refused.push("served"); } catch (e) { refused.push(e.code); }
}
try { await arcmira.transcript("${OWNED}", { quality: "premium", language: "ja" }); refused.push("served"); } catch (e) { refused.push(e.code); }
return {
  refused,
  raw: [
    await raw("/v1/transcripts/${NOT_OWNED}?quality=premium"),
    await raw("/v1/transcripts/${NOT_OWNED}?quality=premium&retry=true"),
    await raw("/v1/transcripts/${OWNED}?quality=premium&language=ja"),
    await raw("/v1/transcriptions/5a1c0b9e-2f8d-4c47-9e2b-1d3f6a7b8c90"),
    await raw("/v1/transcriptions?video_id=${NOT_OWNED}"),
    await raw("/v1/transcripts/${NOT_OWNED}?refresh=true"),
  ],
};`;

describe('an arcmira_execute_read program under the mark', () => {
  it('meets the refusal the API document lists for a marked request, read_only_request as a permission_error with no gate', () => {
    assert.deepEqual(READ_ONLY_REQUEST && { code: READ_ONLY_REQUEST.code, type: READ_ONLY_REQUEST.type, gate: READ_ONLY_REQUEST.gate }, { code: 'read_only_request', type: 'permission_error', gate: undefined });
  });

  it('sends every request marked, by client method or raw fetch, its record included, and the reads the API refuses come back as write_tool_required', async () => {
    const sent: Sent[] = [];
    const reply = await callTool('arcmira_execute_read', { code: READ_PROGRAM }, api(sent), { LOADER: fakeLoader() });
    assert.equal(reply.result.isError, undefined, textOf(reply));
    const value = JSON.parse(textOf(reply)).value;
    assert.deepEqual(value.refused, ['write_tool_required', 'write_tool_required', 'write_tool_required', 'write_tool_required']);
    assert.deepEqual(value.raw, [403, 403, 403, 200, 200, 200]);
    assert.deepEqual(
      sent.map((request) => request.route),
      [
        'GET /v1/entities/resolve?q=Ramp&type=organization&context=the+corporate+card&limit=8',
        `GET /v1/search?q=Ramp&channel_ids=${TBPN}&about=ent_14&entity_ids=ent_14&by=ent_99&kind=sponsored&after=2026-01-01&before=2026-09-01&source=creator_captions&limit=5`,
        `GET /v1/mentions?entity_id=ent_14&channel_id=${TBPN}&is_appearance=true&limit=10&cursor=c`,
        'GET /v1/entities/ent_14/momentum?days=30',
        `GET /v1/channels/${TBPN}/sponsors?min_ad_reads=3&status=active&limit=10`,
        `GET /v1/recommendations?entity_id=ent_14&class=organic&channel_id=${TBPN}&limit=10&cursor=c`,
        `GET /v1/channels/${TBPN}/videos?limit=10`,
        `GET /v1/transcripts/${NOT_OWNED}?quality=captions&language=en&timestamps=false&start=0&end=60`,
        `GET /v1/transcripts/${OWNED}?quality=premium`,
        `GET /v1/mentions/counts?channel_ids=${TBPN}&entity_ids=ent_14&video_ids=${NOT_OWNED}&entity_types=topic&mode=mentions&limit=20`,
        `GET /v1/transcripts/${NOT_OWNED}/quote`,
        `GET /v1/transcripts/${NOT_OWNED}/quote`,
        `GET /v1/channels/${TBPN}/coverage`,
        'GET /v1/me',
        'GET /v1/integrations/slack',
        'GET /v1/monitors',
        'GET /v1/monitors/mon_1/trackers',
        'GET /v1/monitors/mon_1/alerts?limit=5',
        `GET /v1/transcripts/${NOT_OWNED}?quality=premium`,
        `GET /v1/transcripts/${NOT_OWNED}?quality=premium&retry=true`,
        `GET /v1/transcripts/${NOT_OWNED}?quality=premium&language=ja`,
        `GET /v1/transcripts/${OWNED}?quality=premium&language=ja`,
        `GET /v1/transcripts/${NOT_OWNED}?quality=premium`,
        `GET /v1/transcripts/${NOT_OWNED}?quality=premium&retry=true`,
        `GET /v1/transcripts/${OWNED}?quality=premium&language=ja`,
        'GET /v1/transcriptions/5a1c0b9e-2f8d-4c47-9e2b-1d3f6a7b8c90',
        `GET /v1/transcriptions?video_id=${NOT_OWNED}`,
        `GET /v1/transcripts/${NOT_OWNED}?refresh=true`,
        RECORD,
      ],
    );
    assert.deepEqual(
      sent.filter((request) => request.mark !== '1'),
      [],
    );
  });

  it('reads the approved words from a client method and from a raw fetch, with the API request id and throttle kept', async () => {
    const program = `
try { await arcmira.transcript("${NOT_OWNED}", { quality: "premium" }); } catch (e) { var thrown = { code: e.code, message: e.message, status: e.status, request_id: e.request_id }; }
const r = await fetch("https://api.arcmira.com/v1/transcripts/${NOT_OWNED}?quality=premium&language=ja");
return { thrown, raw: { status: r.status, body: await r.json(), limit: r.headers.get("ratelimit-limit") } };`;
    const reply = await callTool('arcmira_execute_read', { code: program }, api([]), { LOADER: fakeLoader() });
    const { thrown, raw } = JSON.parse(textOf(reply)).value;
    assert.deepEqual(thrown, { code: 'write_tool_required', message: APPROVED, status: 403, request_id: 'req_marked' });
    assert.equal(raw.status, 403);
    assert.equal(raw.limit, '20');
    assert.deepEqual(raw.body.error, {
      type: 'permission_error',
      code: 'write_tool_required',
      message: APPROVED,
      doc_url: 'https://arcmira.com/docs/errors#read_only_request',
      request_id: 'req_marked',
    });
  });

  it('reads any other refusal of a marked request exactly as the API sent it, code and message, from a client method and from a raw fetch', async () => {
    const reworded = 'This request is marked read-only and would have started a Premium transcript, so nothing was charged.';
    const refusals: Record<string, string> = {
      [`/v1/channels/${TBPN}/sponsors`]: READ_ONLY_MESSAGES.sponsors,
      '/v1/mentions': READ_ONLY_MESSAGES.receipts,
      [`/v1/transcripts/${OWNED}`]: READ_ONLY_MESSAGES.owned(OWNED),
      [`/v1/transcripts/${NOT_OWNED}`]: reworded,
    };
    const upstream = (url: URL) => (url.pathname in refusals ? Response.json(readOnlyRefusal(refusals[url.pathname]!), { status: 403 }) : Response.json({}));
    const program = `
const out = [];
for (const read of [
  () => arcmira.sponsors("${TBPN}"),
  () => arcmira.mentions({ entityId: "ent_14" }),
  () => arcmira.transcript("${OWNED}", { quality: "premium" }),
  () => arcmira.transcript("${NOT_OWNED}", { quality: "premium" }),
]) {
  try { await read(); out.push("served"); } catch (e) { out.push([e.code, e.message]); }
}
for (const path of ["/v1/channels/${TBPN}/sponsors", "/v1/mentions?entity_id=ent_14", "/v1/transcripts/${OWNED}?quality=premium", "/v1/transcripts/${NOT_OWNED}?quality=premium"]) {
  const r = await fetch("https://api.arcmira.com" + path);
  const { error } = await r.json();
  out.push([r.status, error.code, error.message]);
}
return out;`;
    const reply = await callTool('arcmira_execute_read', { code: program }, upstream, { LOADER: fakeLoader() });
    const messages = [READ_ONLY_MESSAGES.sponsors, READ_ONLY_MESSAGES.receipts, READ_ONLY_MESSAGES.owned(OWNED), reworded];
    assert.deepEqual(JSON.parse(textOf(reply)).value, [
      ...messages.map((message) => ['read_only_request', message]),
      ...messages.map((message) => [403, 'read_only_request', message]),
    ]);
  });

  it('cannot send a write: POST /v1/transcriptions and every monitor write stop before any request, and only the marked record goes out', async () => {
    const sent: Sent[] = [];
    const program = `
const r = await fetch("https://api.arcmira.com/v1/transcriptions", { method: "POST", body: JSON.stringify({ video_id: "${NOT_OWNED}" }) });
const codes = [r.status, (await r.json()).error.code];
for (const write of [
  () => arcmira.monitors.create({ name: "Rivals", notify_frequency: "daily" }),
  () => arcmira.monitors.update("mon_1", { paused: true }),
  () => arcmira.monitors.addEntities("mon_1", ["ent_14"]),
  () => arcmira.monitors.addName("mon_1", [{ name: "Acme", type: "org" }]),
  () => arcmira.monitors.attachTrackers("mon_1", ["trk_1"]),
]) { try { await write(); codes.push("sent"); } catch (e) { codes.push(e.code); } }
return codes;`;
    const reply = await callTool('arcmira_execute_read', { code: program }, api(sent), { LOADER: fakeLoader() });
    assert.deepEqual(JSON.parse(textOf(reply)).value, [403, 'outbound_refused', 'write_tool_required', 'write_tool_required', 'write_tool_required', 'write_tool_required', 'write_tool_required']);
    assert.deepEqual(sent, [{ route: RECORD, mark: '1' }], 'only the marked record goes out');
  });
});

describe('the same Premium reads in arcmira_execute_write', () => {
  it('go out unmarked and start the transcript or translation, and so does the call\'s record', async () => {
    const sent: Sent[] = [];
    const program = `
const out = [];
for (const options of [{ quality: "premium" }, { quality: "premium", retry: true }, { quality: "premium", language: "ja" }]) {
  const t = await arcmira.transcript("${NOT_OWNED}", options);
  out.push([t.state, t.charge?.amount ?? null]);
}
return out;`;
    const reply = await callTool('arcmira_execute_write', { code: program }, api(sent), { LOADER: fakeLoader() });
    assert.equal(reply.result.isError, undefined, textOf(reply));
    assert.deepEqual(JSON.parse(textOf(reply)).value, [['ready', 300], ['ready', 300], ['ready', 300]]);
    assert.deepEqual(
      sent.map((request) => [request.route.split('?')[0], request.mark]),
      [[`GET /v1/transcripts/${NOT_OWNED}`, null], [`GET /v1/transcripts/${NOT_OWNED}`, null], [`GET /v1/transcripts/${NOT_OWNED}`, null], [RECORD, null]],
    );
  });
});
