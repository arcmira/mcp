/**
 * The one text that teaches the arcmira client: what describe returns, what the server
 * instructions abbreviate, and what the plugin skill is generated from (scripts/build-skill.ts).
 * Method names match the arcmira CLI commands, so an agent that learned one surface knows the others.
 * Kept short on purpose: the 0.7.0 bake-off lost haiku answers to a reference three times this size.
 */

export const DOCS = {
  api: 'https://arcmira.com/docs/api-reference',
  mcp: 'https://arcmira.com/docs/mcp-server',
  errors: 'https://arcmira.com/docs/errors',
  llms: 'https://arcmira.com/llms.txt',
  openapi: 'https://api.arcmira.com/v1/openapi.json',
} as const;

export const LINKS = {
  spending: 'https://arcmira.com/dashboard/spending',
  pricing: 'https://arcmira.com/pricing',
  integrations: 'https://arcmira.com/dashboard/integrations',
} as const;

/**
 * The one rule for money (owner ruling 2026-10-02). On-demand spend extends the plan and the
 * account's on-demand budget is the approval, so no surface ever asks the user for a cents amount.
 */
export const BUDGET_RULE = `On-demand spend extends the plan: the account's on-demand budget is the approval, so never ask the user for a cents amount. When a budget or plan blocks a purchase (spend_limit_exceeded, quota_exceeded, a plan gate), tell the user to raise the on-demand budget at ${LINKS.spending} or upgrade the plan at ${LINKS.pricing} (not on Ultra or Enterprise), and link unlock.url when the refusal carries one.`;

/** Rule 5: monitors are the user's, so the agent reads them before it suggests or creates one. */
export const MONITOR_RULE = `MONITORS. Never assume a monitor exists ("Competitors" may not). To follow entities the research found: list the user's monitors with arcmira.monitors.list() and suggest any whose name or trackers fit. If none fits, ask how they want updates, one question at a time, each with a default: email (default) or Slack, then as it happens, an hourly digest or a daily digest (default daily). For Slack, read arcmira.integrations.slack(): with a workspace, set notify_slack: true, its id as slack_integration_id and its default_channel_id as slack_channel_id; with none, link ${LINKS.integrations} to connect one and use email for now, saying so. For a topic, resolve its spelling variants ("data centers", "datacenters", "data centre") and follow every one that is its own topic id. Then in arcmira_execute_write: arcmira.monitors.create when there is no fit, and arcmira.monitors.addEntities with every id in one call. A name that resolves to nothing can still be followed by its exact name with arcmira.monitors.addName(monitorId, [{ name, type }]); a show by its UC id. Tell the user about every result with attached: false: entity_not_found, entity_type_not_trackable, tracker_limit_reached, or tracked_in_another_monitor (name the monitor at current_monitor_id and ask before moving it with arcmira.monitors.attachTrackers). Pause with arcmira.monitors.update(id, { paused: true }); there is no delete.`;

/** Rule 6b: the closing line of every skill. */
export const FEEDBACK_LINE = 'If anything was wrong, slow, or missing for the user, send one arcmira_feedback.';

/** The result nudge (rule 6a), with the call it is about. */
export function feedbackNudge(callId: string): string {
  return `If this was wrong, slow, or missing for the user, send one arcmira_feedback with call_id ${callId}.`;
}

export const ACCESS_GUIDANCE = 'When a plan or usage limit blocks a capability, briefly name the limit and any required tier reported by the API. Link to https://arcmira.com/pricing as "Plan access details" for information; do not upgrade a plan. Requested Premium work uses included credits, then on-demand within the account\'s budget, without another confirmation. Preserve error codes and reported quota or reset facts. If the user requested Premium, keep quality: "premium". Do not retry with captions, suggest third-party transcripts, or present them as equivalent. Only change the requested quality if the user asks.';

const PREMIUM = `PREMIUM. A Premium read returns the lines. When the video is not transcribed yet, the same read buys it at its quote (included credits, then on-demand within the account's budget) and the client reads again for about 20 seconds; a Premium request is the go-ahead, so do not ask. Still state pending: tell the user about how long (eta_seconds), then run the same read in a later program; it never buys twice. State failed or refunded: report job.error or last_attempt.error and never substitute captions; buy again with retry: true only when the user asks. ${BUDGET_RULE} The price covers the whole video (75 rows per 15-minute quarter, four credits per row); start and end never lower it, and arcmira.quote(video) reads it for free. A plan without Premium throws paid_plan_required with unlock: report it, and never present captions as Premium.`;

export const COVERAGE_GUIDANCE = 'Search as_of is the newest publication date among the returned passages, not the date the whole index was updated. For channel freshness, call arcmira.status({ channelId }) and report channel.search_indexed_through for transcript search. A result date or an empty query does not establish missing recent episodes.';

export const ID_RULE = `ID RULE. Filters take verbatim ids only: entity ids look like ent_14, channel ids like UC-DRzaGnL_vtBUpCFH5M0tg (UC plus 22 characters), video ids are 11 characters or a YouTube URL. A name where an id belongs throws id_required before any network call. Resolve first, then query:
  const r = await arcmira.resolve("Sam", { context: "the My First Million co-host" });
  const e = r.best ?? r.suggested;          // for a show: resolve with { type: "channel" } and use e.youtube_channel_id
  if (!e) return { ask: r.ask };            // r.ask.options: [{ id, name, type, label }]
RESOLVE ANSWERS ONE OF THREE. best: the name means that row; use it and name it. suggested: no row is certain but one stands out (suggested.reason, suggested.evidence); use it and tell the user you assumed it, quoting the evidence ("Sam Altman, assuming the most mentioned Sam: 4,399 appearances, 11x the next"). ask: several rows fit and none stands out; return ask.options for the user to pick and stop, or check every option id against the data in one program (occurrences or momentum with all the ids) and answer per row, naming each. Resolve the exact name the user said ("ICE", "Mercury"), not a paraphrase, and always pass context with the user's own words about the name when they gave any ("Sam, the My First Million co-host" is resolve("Sam", { context: "the My First Million co-host" })). Context is only words from the user's message, never your own guess: a bare "Theo" is resolve("Theo") with no context, never "Theo Von" or context "the comedian", and its ask goes back to the user. Omit type for a brand (the catalog types some companies as product). A name that resolves to nothing (no best, suggested or ask) is not in the Arcmira index: say so and ask for another spelling or a link; never answer for a different entity without saying so. Always say in the answer which entity you used.`;

export interface MethodDoc {
  name: string;
  signature: string;
  returns: string;
  notes: string[];
  /** write: only arcmira_execute_write runs it; arcmira_execute_read throws write_tool_required. */
  access?: 'write';
}

export const METHODS: readonly MethodDoc[] = [
  {
    name: 'resolve',
    signature: 'arcmira.resolve(q, { type?, context?, limit? })',
    returns: '{ query, context, confidence, best, suggested (a candidate plus reason, evidence, assumed: true), ask{question, options[{id, name, type, label}]}, candidates[{id, name, type, appearance_count, youtube_channel_id, page, description?, match}], note }',
    notes: ['q is a name, @handle, YouTube URL or UC id. context: the user\'s own words about the name, never a guess of yours. type: person | organization | product | topic | channel; pass it only for a person or a show. limit 1..15. At most one of best, suggested and ask is set; none set means no match. match: exact | word | substring | acronym | spelling.'],
  },
  {
    name: 'search',
    signature: 'arcmira.search({ query, channelIds?, about?, speakerIds?, kind?, after?, before?, source?, limit? })',
    returns: '{ chunks[{text, video_id, video_title, published_at, start_seconds, watch_url, cite_line, channel_id, channel_name, about[], speakers_by[]}], window{after, before}, as_of, note }',
    notes: [
      COVERAGE_GUIDANCE,
      'Spoken passages that match the words in query (a topic, a phrase). channelIds: up to 8 UC ids. about: up to 8 ent_ ids of a brand or person the passage is about. speakerIds: up to 8 person ids; returns passages where that person says the query words, and each line of chunk.text starts with "Name: ". Speaker labels cover a minority of shows: when a speakerIds search is empty, read note before saying the person never said it, and try about with the same id for what others said about them. kind: sponsored | organic | mention, or an array of them (sponsored is ad reads, organic is unpaid recommendations). Never put a topic word in about; it goes in query. If a search with about, speakerIds or kind returns no chunks, rerun it with query and channelIds only before saying nothing was found. limit 1..20 (default 5). source: arcmira_premium | creator_captions | third_party_quick.',
    ],
  },
  {
    name: 'mentions',
    signature: 'arcmira.mentions({ entityId, channelId?, after?, before?, limit?, cursor? })',
    returns: '{ entity{id, name, page}, mentions[{media{video_id, title, published_at, channel_id, source_channel{name}}, start_seconds, is_appearance, description}], window{after, before}, has_more, next_cursor }',
    notes: ['When and where a name came up: one row per catalog mention, newest first, several rows per episode, limit 1..100. Never count rows to answer how many episodes: occurrences gives count per window. Rows carry no wording; for a quote use search. Read the episode title before asserting a lone row: a title far from the entity (a jungle episode for a bank) is a homonym the catalog mislabelled.'],
  },
  {
    name: 'momentum',
    signature: 'arcmira.momentum(entityId)',
    returns: '{ entity, verdict (accelerating | flat | fading | none), as_of, volume{mentions_7d, mentions_30d, mentions_prior_30d, mentions_90d, total}, top_shows[{channel_id, channel_name, mentions}] }',
    notes: ['The last 30 days against the prior 30, as of as_of, across the shows Arcmira indexes.'],
  },
  {
    name: 'sponsors',
    signature: 'arcmira.sponsors(channelId, { minAdReads?, status?, limit? })',
    returns: '{ channel{name, page}, sponsors[{entity{id, name, page}, ad_reads, videos, first_seen, last_seen, sponsor_status{status}}], meta{total} }',
    notes: ['Recurring sponsors of one show, ranked by ad_reads. status: active | lapsed filters on sponsor_status.status.'],
  },
  {
    name: 'recommendations',
    signature: 'arcmira.recommendations(entityId, { kind?, channelId?, after?, before?, limit?, cursor? })',
    returns: '{ entity, recommendations[{class: sponsored | organic | mention, verbatim_quote, promo_code, media{video_id, title, published_at, channel_id, source_channel{name}}, start_seconds}], window{after, before}, has_more, next_cursor }',
    notes: ['Who recommends one entity on air. kind: sponsored | organic | all (default all), limit 1..50. Account access applies; a gate reports the required tier in unlock.tier.'],
  },
  {
    name: 'episodes',
    signature: 'arcmira.episodes(channelId, { limit?, after?, before? })',
    returns: '{ episodes[{video_id, title, published_at, duration_seconds, view_count, watch_url}], window{after, before}, indexed_through, index_age_days }',
    notes: ['Newest indexed episodes of one show, limit 1..25; episodes[0] is the latest. Never count episodes to size a show: status({ channelId }).channel.searchable_videos is the count.'],
  },
  {
    name: 'transcript',
    signature: 'arcmira.transcript(videoIdOrUrl, { quality?, language?, timestamps?, start?, end?, retry? })',
    returns: '{ state: ready | pending | failed | refunded; ready: video{id, title, channel_name, published_at, watch_url}, lines[{start, end, text, speaker?}], speakers[{id, name, entity_id}], quality, source, language, as_of; pending: eta_seconds, job{id, state, status, charge, eta_seconds}, note; failed | refunded: job{error}? or last_attempt{status, error}, note }',
    notes: ['quality: captions (default) | premium (diarized: each line carries speaker, an id into speakers[], where name is the person or a label like Speaker 1; paid plans). start/end select returned lines only. Every read is metered. Read state before lines.', PREMIUM],
  },
  {
    name: 'occurrences',
    signature: 'arcmira.occurrences({ channelIds?, entityIds?, videoIds?, types?, mode?, after?, before?, limit? })',
    returns: '{ rows[{entity_id, name, type, channel_id, channel_name, count (episodes), occurrences (times said)}], shared[{entity_id, name, type, by_channel[{channel_id, channel_name, count}]}], window{after, before}, as_of }',
    notes: [
      'Ranked catalog counts per entity per channel: what a show talks about, how many episodes mentioned an entity in a window, what one episode mentions (videoIds). Needs channelIds (up to 8), entityIds (up to 20) or videoIds (up to 20). types: person | organization | product | topic | channel. With two or more channelIds read shared, not rows, for what both shows mention.',
    ],
  },
  {
    name: 'quote',
    signature: 'arcmira.quote(videoIdOrUrl)',
    returns: '{ video_id, duration_seconds, owned, eligible, quote{quarters, rows}, charge{unit, amount, from: included | on_demand | mixed}, max_on_demand_cents }',
    notes: ['The free whole-video Premium quote. It never buys.'],
  },
  {
    name: 'status',
    signature: 'arcmira.status({ channelId? })',
    returns: '{ channel{youtube_channel_id, searchable_videos, indexed_through, search_indexed_through} } for a show; with no argument the key: { tier, scopes, usage{credits{available, on_demand}, current_spend_cents} }',
    notes: ['searchable_videos counts searchable videos for this show. search_indexed_through is the newest publication date in its transcript search index; indexed_through describes overall indexed coverage. Neither date guarantees every earlier episode is present.'],
  },
  {
    name: 'monitors.list',
    signature: 'arcmira.monitors.list()',
    returns: '{ monitors[{id, name, paused, notify_frequency, notify_emails, notify_slack, tracker_count, slack_integration{team_name, channel_name}}] }',
    notes: [MONITOR_RULE],
  },
  {
    name: 'monitors.trackers',
    signature: 'arcmira.monitors.trackers(monitorId)',
    returns: '{ trackers[{id, entity_name, entity_type, display_name, paused}] }',
    notes: ['What one monitor already follows, so a suggestion never adds a duplicate.'],
  },
  {
    name: 'monitors.create',
    signature: 'arcmira.monitors.create({ name, notify_frequency, notify_emails?, notify_slack?, slack_integration_id?, slack_channel_id?, digest_time? })',
    returns: '{ monitor{id, name, notify_frequency, notify_emails, notify_slack, paused} }',
    notes: ['Fields take the names monitors.list returns. notify_frequency: realtime (as it happens) | hourly | daily (digests), from the user\'s answer. Email goes to the account email; notify_emails adds recipients, who confirm before delivery. Slack: notify_slack: true with slack_integration_id and slack_channel_id from arcmira.integrations.slack().'],
    access: 'write',
  },
  {
    name: 'monitors.update',
    signature: 'arcmira.monitors.update(monitorId, { name?, notify_frequency?, notify_emails?, notify_slack?, paused?, ... })',
    returns: '{ monitor }',
    notes: ['Changes delivery or pauses: { paused: true } stops delivery and keeps the monitor.'],
    access: 'write',
  },
  {
    name: 'monitors.addEntities',
    signature: 'arcmira.monitors.addEntities(monitorId, entityIds, { personMatchMode? })',
    returns: '{ monitor_id, results[{entity_id, canonical_entity_id?, tracker_id, created, attached, reason?, current_monitor_id?}] }',
    notes: ['Up to 90 ent_ ids in one call. Reuses the account\'s tracker for an entity, else creates one by id, and attaches each to the monitor; a merged id answers its canonical_entity_id. An id that cannot attach comes back attached: false while the rest attach, with reason entity_not_found | entity_type_not_trackable | tracker_limit_reached | tracked_in_another_monitor (current_monitor_id names that monitor; the tracker is not moved). personMatchMode for people: mentions (default) | appearances | both.'],
    access: 'write',
  },
  {
    name: 'monitors.addName',
    signature: 'arcmira.monitors.addName(monitorId, [{ name, type, personMatchMode? }])',
    returns: '{ monitor_id, results[{name, type, tracker_id, created, attached, reason?, current_monitor_id?}] }',
    notes: ['Follows up to 90 exact names in one call, matched case-insensitively in newly analyzed media, so it works before a name is in the index. Use it only for names resolve finds nothing for; an id from resolve goes to addEntities. type: person | organization (org) | product | topic | channel; a channel is followed by its UC id, never its name. Results read like addEntities: attached: false with reason tracker_limit_reached or tracked_in_another_monitor (ask before moving it with attachTrackers).'],
    access: 'write',
  },
  {
    name: 'monitors.attachTrackers',
    signature: 'arcmira.monitors.attachTrackers(monitorId, trackerIds)',
    returns: '{ monitor_id, attached_count, message }',
    notes: ['Moves existing trackers (trk_ ids, the tracker_id of an addEntities result) into this monitor. Only after the user agreed to move a tracker another monitor holds.'],
    access: 'write',
  },
  {
    name: 'integrations.slack',
    signature: 'arcmira.integrations.slack()',
    returns: '{ integrations[{id, team_name, default_channel_id, channels[{id, name}]}] }',
    notes: [`The Slack workspaces connected to the account. Pass id as slack_integration_id and default_channel_id as slack_channel_id. Empty: the user connects one at ${LINKS.integrations}.`],
  },
];

export const EXAMPLES: ReadonlyArray<{ title: string; code: string }> = [
  {
    title: 'One search, compact result',
    code: `const hits = await arcmira.search({ query: "stablecoins", channelIds: ["UC-DRzaGnL_vtBUpCFH5M0tg"], after: arcmira.daysAgo(90), limit: 3 });
return hits.chunks.map(c => ({ said: c.text, video: c.video_title, date: c.published_at, url: c.watch_url }));`,
  },
  {
    title: 'Resolve, then filter; say when the entity was assumed',
    code: `const r = await arcmira.resolve("Linear");
const e = r.best ?? r.suggested;
if (!e) return { ask: r.ask };   // let the user pick
const m = await arcmira.momentum(e.id);
return { entity: e.name, id: e.id, assumed: Boolean(r.suggested), why: r.suggested?.evidence ?? null, verdict: m.verdict, last30: m.volume.mentions_30d, prior30: m.volume.mentions_prior_30d, as_of: m.as_of };`,
  },
  {
    title: 'A show by name: its id, size, and what its latest episode mentions',
    code: `const show = await arcmira.resolve("All-In Podcast", { type: "channel" });
const e = show.best ?? show.suggested;
if (!e) return { ask: show.ask };
const ch = e.youtube_channel_id;
const [s, ep] = await Promise.all([arcmira.status({ channelId: ch }), arcmira.episodes(ch, { limit: 1 })]);
const what = await arcmira.occurrences({ videoIds: [ep.episodes[0].video_id], types: ["organization"], limit: 5 });
return { show: e.name, channel_id: ch, assumed: Boolean(show.suggested), why: show.suggested?.evidence ?? null, videos_indexed: s.channel.searchable_videos, indexed_through: s.channel.indexed_through, latest: ep.episodes[0].title, mentions: what.rows.map(r => [r.name, r.entity_id, r.occurrences]) };`,
  },
  {
    title: 'What two shows both talk about (shared, not rows)',
    code: `const o = await arcmira.occurrences({ channelIds: ["UC-DRzaGnL_vtBUpCFH5M0tg", "UCESLZhusAkFfsNsApnjF_Cg"], types: ["organization", "product"], limit: 40 });
return o.shared.slice(0, 5).map(s => ({ name: s.name, id: s.entity_id, episodes_by_show: s.by_channel.map(c => [c.channel_name, c.count]) }));`,
  },
  {
    title: 'What one person said about a topic, in their own lines',
    code: `const p = await arcmira.resolve("John Coogan", { type: "person" });
const e = p.best ?? p.suggested;
if (!e) return { ask: p.ask };
const hits = await arcmira.search({ query: "ramp", speakerIds: [e.id], after: arcmira.daysAgo(30), limit: 5 });
const said = hits.chunks.map(c => ({ lines: c.text.split("\\n").filter(l => l.startsWith(e.name + ": ")), url: c.watch_url, date: c.published_at }));
return { person: e.name, id: e.id, assumed: Boolean(p.suggested), why: p.suggested?.evidence ?? null, ...(said.length ? { said } : { none: hits.note }) };`,
  },
  {
    title: 'Sponsors two shows share',
    code: `const [a, b] = await Promise.all([arcmira.sponsors("UC-DRzaGnL_vtBUpCFH5M0tg"), arcmira.sponsors("UCESLZhusAkFfsNsApnjF_Cg")]);
const inB = new Map(b.sponsors.map(s => [s.entity.id, s.ad_reads]));
return a.sponsors.filter(s => inB.has(s.entity.id)).map(s => ({ name: s.entity.name, id: s.entity.id, ad_reads: [s.ad_reads, inB.get(s.entity.id)] }));`,
  },
  {
    title: 'A Premium transcript: who speaks in the first minute',
    code: `const t = await arcmira.transcript("cdLeJU_1UH8", { quality: "premium", start: 0, end: 60 });
if (t.state !== "ready") return { state: t.state, eta_seconds: t.eta_seconds, note: t.note };   // pending: tell the user, run this again later
const name = new Map(t.speakers.map(s => [s.id, s.name]));
return t.lines.map(l => \`[\${l.start}] \${name.get(l.speaker)}: \${l.text}\`);`,
  },
  {
    title: 'A month window (after is counted, before is the first day left out); return the window the API echoes',
    code: `const p = await arcmira.resolve("Cursor");
const e = p.best ?? p.suggested;
if (!e) return { ask: p.ask };
const o = await arcmira.occurrences({ channelIds: ["UC-DRzaGnL_vtBUpCFH5M0tg"], entityIds: [e.id], after: "2026-08-01", before: "2026-09-01" });
const row = o.rows[0];
return { entity: e.name, id: e.id, assumed: Boolean(p.suggested), why: p.suggested?.evidence ?? null, window: o.window, episodes: row?.count ?? 0, times: row?.occurrences ?? 0, as_of: o.as_of };`,
  },
  {
    title: 'Rank brands by 30-day mentions',
    code: `const out = [];
for (const n of ["Anthropic", "OpenAI", "Cursor"]) {
  const r = await arcmira.resolve(n);   // no type: a company may be typed product
  const e = r.best ?? r.suggested;
  if (!e) { out.push({ name: n, ask: r.ask }); continue; }
  const m = await arcmira.momentum(e.id);
  out.push({ name: e.name, id: e.id, assumed: Boolean(r.suggested), why: r.suggested?.evidence ?? null, last30: m.volume.mentions_30d });
}
return out.sort((a, b) => (b.last30 ?? -1) - (a.last30 ?? -1));`,
  },
];

export const QUIRKS = [
  'Dates: arcmira.today() and arcmira.daysAgo(n) give ISO dates from the server clock; never guess today. Windows are half-open in UTC: after is the first day counted, before is the first day left out (August is after 2026-08-01, before 2026-09-01). Every dated result echoes window{after, before}; state it in the answer. Coverage is partial; check channel coverage before making freshness claims.',
  'Momentum, mentions and counts measure the shows Arcmira indexes, not the internet; say so when it matters. An empty result means this query returned no matches. Keep outside evidence separate from Arcmira results.',
  'Before asserting a mention, read its description or the passage text and say which sense of the name it is (Mercury the bank, not the planet or the element). Drop rows about another sense.',
  ACCESS_GUIDANCE,
  COVERAGE_GUIDANCE,
  'Results carry names beside ids and arcmira.com page links; link names to those pages and never invent an arcmira.com URL.',
];

export const MAX_CALLS = 40;

export const ERRORS = `Errors throw ArcmiraError with .code and, for gates, .unlock { tier, url }: id_required (a name where an id belongs; call arcmira.resolve first), invalid_video, too_many (over an id cap), entity_not_found, filter_requires_paid, recommendations_not_enabled, paid_plan_required (Premium needs a paid plan), quota_exceeded and spend_limit_exceeded (the budget rule), insufficient_scope (the sign-in lacks monitors:write or trackers:write: reconnect and allow it), write_tool_required (a monitors write in arcmira_execute_read), rate_limited (.retry_after_seconds), call_budget (over ${MAX_CALLS} API calls in one program). See ${DOCS.errors}.`;

const ROUTING =
  'WHICH METHOD. A quote or what was said about a topic: search. Whether and when a name came up: mentions. How hot something is: momentum. What a show talks about, what two shows share, what one episode mentions, how many episodes mentioned X in a window: occurrences. Who sponsors a show: sponsors. Who recommends a brand: recommendations. The latest episode: episodes(channelId, { limit: 1 }). How many videos a show has indexed and its as-of date: status({ channelId }). One video\'s words: transcript. The key, plan, credits and on-demand budget: status(). Following entities over time: monitors (the MONITORS note on monitors.list).';

const WRITE_MARK = '   [arcmira_execute_write only]';

function methodText(m: MethodDoc): string {
  return [`${m.signature}   -> ${m.returns}${m.access === 'write' ? WRITE_MARK : ''}`, ...m.notes.map((n) => `   ${n}`)].join('\n');
}

/** The whole reference, or every signature plus the notes and examples that name one topic (the id rule and routing table stay). */
export function referenceText(topic?: string): string {
  const wanted = topic?.trim().toLowerCase();
  const hit = (text: string): boolean => !wanted || text.toLowerCase().includes(wanted);
  const methodHits = METHODS.filter((m) => hit(`${m.name} ${m.signature}`));
  const methods = METHODS.map((m) => (methodHits.length === 0 || methodHits.includes(m) ? methodText(m) : `${m.signature}   -> ${m.returns}${m.access === 'write' ? WRITE_MARK : ''}`));
  const exampleHits = EXAMPLES.filter((e) => hit(`${e.title} ${e.code}`));
  const examples = exampleHits.length > 0 ? exampleHits : EXAMPLES;
  return [
    'arcmira client (JavaScript). Every method is async and returns parsed JSON. Your program is the body of an async function with arcmira and ArcmiraError in scope: use await, console.log for progress, and return one compact value with only the fields the answer needs. arcmira_execute_read runs every method except those marked arcmira_execute_write only; arcmira_execute_write runs them all.',
    '',
    ID_RULE,
    '',
    ROUTING,
    '',
    'METHODS (names match the arcmira CLI commands)',
    methods.join('\n'),
    'arcmira.today() -> "YYYY-MM-DD" on the server clock. arcmira.daysAgo(n) -> the ISO date n days ago.',
    '',
    'WORKED EXAMPLES',
    examples.map((e, i) => `// ${i + 1}. ${e.title}\n${e.code}`).join('\n\n'),
    '',
    'KNOW THIS',
    QUIRKS.map((q) => `- ${q}`).join('\n'),
    '',
    ERRORS,
    '',
    BUDGET_RULE,
    '',
    `FEEDBACK. ${FEEDBACK_LINE} Pick a category (wrong_entity, bad_data, missing, slow, confusing, other) and say what happened in a sentence or two; pass call_id when a result named one, and request_id from an error.`,
    '',
    `DOCS. API reference ${DOCS.api}, MCP guide ${DOCS.mcp}, error codes ${DOCS.errors}, OpenAPI ${DOCS.openapi}, agent index ${DOCS.llms}.`,
  ].join('\n');
}



export const SHORT_GUIDE = [
  'Arcmira is the search engine for the spoken web: indexed YouTube and podcast transcripts with a catalog of who is mentioned where, who sponsors whom, and who recommends what on air.',
  'Searches indexed YouTube and podcast transcripts for the passages and metadata requested by the user.',
  'arcmira_describe returns the arcmira client reference (methods, worked example programs, quirks, doc links): call it once before your first program. arcmira_execute_read runs JavaScript that reads, Premium transcripts included, and returns bounded outcome-first JSON. arcmira_execute_write runs the same client plus the monitor writes (create, update, addEntities, addName). arcmira_feedback tells Arcmira what was wrong, slow, missing or confusing.',
  BUDGET_RULE,
  'Write one program per question: resolve every name it carries (arcmira.resolve, with the user\'s own words about the name as context), use best, or suggested and tell the user you assumed it, or return ask.options for the user to pick (a name that resolves to nothing is not in the index), run every query the question needs, and return only the fields the answer needs. Filters take ids only (ent_..., UC..., 11-character video ids); a name where an id belongs throws id_required.',
  'Use arcmira.today() and arcmira.daysAgo(n) for date windows; when the user names no window, use the last 30 days, since a week of the index is often thin. Momentum, mentions and counts measure the shows Arcmira indexes, not the internet. Keep outside evidence separate from Arcmira results.',
  ACCESS_GUIDANCE,
  COVERAGE_GUIDANCE,
  'When research finds entities worth following, offer to save them to a monitor: list the user\'s monitors first and never assume one exists (describe topic monitors).',
  'A result that is empty, an error, truncated or an ask names its call_id: when it was wrong, slow, or missing for the user, send one arcmira_feedback.',
  'Connect with no key and the host signs you in through OAuth, or send Authorization: Bearer <key>. With no account, POST https://api.arcmira.com/v1/signups?src=mcp-tool with {"email"} and then /v1/signups/verify with the code.',
  `Good first ids: TBPN is channel UC-DRzaGnL_vtBUpCFH5M0tg, All-In Podcast is UCESLZhusAkFfsNsApnjF_Cg, Ramp is ent_14. Docs: ${DOCS.mcp} and ${DOCS.llms}.`,
].join(' ');
