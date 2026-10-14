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
  integrations: 'https://arcmira.com/dashboard/integrations',
} as const;

/**
 * The one usage rule: the account's on-demand budget is
 * the limit and the API enforces it. Stated as facts, never as instructions on what to ask or say
 * (Anthropic directory review, 2026-10-11); SCRIPTED_SPEND fails the build on the old wording.
 */
export const BUDGET_RULE = `USAGE. Metered reads use credits from the account's plan, then the on-demand budget set in the dashboard. Arcmira enforces that budget, and no tool takes a spending amount. A search uses 4 credits per passage it returns past the first 5. A Premium read that starts a transcription reports charge { unit, amount, from: included | on_demand | mixed }; arcmira.quote(video) returns that price beforehand (a price, not a spoken quote) and uses no credits. A read the plan or budget blocks throws ArcmiraError with code paid_plan_required, quota_exceeded, spend_limit_exceeded, member_limit, fair_use_cap or on_demand_paused, a message naming the limit, its figures in limit when reported, and unlock { tier, url } when a plan or setting change lifts it. An account admin changes member_limit, fair_use_cap and on_demand_paused.`;

/** Wording that tells an agent what to ask or say about spend. The manifest check, the skill build and the tests refuse it on every surface. */
export const SCRIPTED_SPEND = /never ask|do not ask|without another confirmation|is the approval|is the go-ahead|tell the user (to (raise|upgrade|ask)|that an admin|an admin)|cents amount/i;

/** The one alert price, stated wherever monitors come up. */
const ALERT_PRICE = "each alert uses 25 credits from the account's plan, then its on-demand budget";

/** The one monitor procedure. describe, the arcmira skill and company-watch carry it; the write tool points at it. */
export const MONITOR_RULE = `MONITORS. A monitor sends alerts for the entities it follows, by email to the account address or by Slack, realtime, hourly or daily. arcmira.monitors.list() lists the user's monitors and monitors.trackers(id) what one follows. Changes run only in arcmira_execute_write; nothing is deleted, and update(id, { paused: true }) pauses. Confirm the monitor and its delivery with the user before a write. create needs name and notify_frequency. Slack needs notify_slack: true and a workspace from arcmira.integrations.slack(): its id as slack_integration_id and default_channel_id as slack_channel_id; with none, the user connects one at ${LINKS.integrations}. addEntities takes up to 90 ids in one call. addName follows an exact name that resolve does not find (a show by its UC id). Topic spellings ("data centers", "datacenters") can be separate ids; follow each. A name may already be followed: list() and trackers(id) show what is, so check them before creating a monitor. A result with attached: false names its reason: entity_not_found, entity_type_not_trackable, tracker_limit_reached, or tracked_in_another_monitor (current_monitor_id names it; attachTrackers moves it once the user agrees). Creating a monitor uses no credits; ${ALERT_PRICE}.`;

/** Rule 5, the offer: one fact line in the server instructions and at the end of every skill. */
export const MONITOR_OFFER = `Monitors can follow what a research turn found, and ${ALERT_PRICE}.`;

/** The closing line of every skill. */
export const FEEDBACK_LINE = 'If anything was wrong, slow, or missing for the user, send one arcmira_feedback.';

const PREMIUM = `PREMIUM. A Premium read returns the lines. When the video is not transcribed yet, the same read starts transcribing it, and the client reads again for about 20 seconds. State pending: eta_seconds says about how long and job.charge what it uses; the same read in a later program returns the lines and never uses credits twice. State failed or refunded: job.error or last_attempt.error says why. retry: true transcribes again and uses credits again, so send it only when the user asks for another attempt. Premium never falls back to captions; a captions read is a separate request. A Premium transcript uses credits for the whole video (300 credits per started 15 minutes); start and end never lower it. A plan without Premium throws paid_plan_required with unlock.`;

export const COVERAGE_GUIDANCE = 'Search as_of is the newest publication date among the returned passages, not the date the whole index was updated. For channel freshness, call arcmira.status({ channelId }) and report channel.search_indexed_through for transcript search. A result date or an empty query does not establish missing recent episodes.';

export const ID_RULE_HEAD = 'ID RULE. Filters take verbatim ids only: entity ids look like ent_14, channel ids like UC-DRzaGnL_vtBUpCFH5M0tg (UC plus 22 characters), video ids are 11 characters or a YouTube URL. A name where an id belongs throws id_required before any network call. Resolve first, then query:';

export const ID_RULE_CODE = `const r = await arcmira.resolve("Sam", { context: "the My First Million co-host" });
const e = r.best ?? r.suggested;          // a show: resolve with { type: "channel" }, use e.youtube_channel_id
if (!e) return { ask: r.ask };            // r.ask.options: [{ id, name, type, label }]`;

export const ID_RULE_ANSWERS = 'RESOLVE ANSWERS ONE OF THREE. best: the name means that row; use it and name it. suggested: no row is certain but one stands out (suggested.reason, suggested.evidence); use it and tell the user you assumed it, quoting the evidence ("Sam Altman, assuming the most mentioned Sam: 4,399 appearances, 11x the next"). ask: several rows fit and none stands out; return ask.options for the user to pick and stop, or check every option id against the data in one program (occurrences or momentum with all the ids) and answer per row, naming each. Resolve the exact name the user said ("ICE", "Mercury"), not a paraphrase, and always pass context with the user\'s own words about the name when they gave any ("Sam, the My First Million co-host" is resolve("Sam", { context: "the My First Million co-host" })). Context is only words from the user\'s message, never your own guess: a bare "Theo" is resolve("Theo") with no context, never "Theo Von" or context "the comedian", and its ask goes back to the user. Omit type for a brand (the catalog types some companies as product). A name that resolves to nothing (no best, suggested or ask) is not in the Arcmira index: say so and ask for another spelling or a link; never answer for a different entity without saying so. Always say in the answer which entity you used.';

export const ID_RULE = [ID_RULE_HEAD, ID_RULE_CODE.replace(/^/gm, '  '), ID_RULE_ANSWERS].join('\n');

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
    notes: ['q is a name, @handle, YouTube URL or UC id. type: person | organization | product | topic | channel; pass it only for a person or a show. limit 1..15. match: exact | word | substring | acronym | spelling.'],
  },
  {
    name: 'search',
    signature: 'arcmira.search({ query, channelIds?, about?, speakerIds?, kind?, after?, before?, source?, limit? })',
    returns: '{ chunks[{text, video_id, video_title, published_at, start_seconds, watch_url, cite_line, channel_id, channel_name, about[], speakers_by[]}], window{after, before}, as_of, note }',
    notes: [
      'Spoken passages that match the words in query (a topic, a phrase). channelIds: up to 8 UC ids. about: up to 8 ent_ ids of a brand or person the passage is about. speakerIds: up to 8 person ids; returns passages where that person says the query words, and each line of chunk.text starts with "Name: ". Speaker labels cover part of the index: when a speakerIds search is empty, read note before saying the person never said it, and try about with the same id for what others said about them. kind: sponsored | organic | mention, or an array of them (sponsored is ad reads, organic is unpaid recommendations). Never put a topic word in about; it goes in query. If a search with about, speakerIds or kind returns no chunks, rerun it with query and channelIds only before saying nothing was found. limit 1..20 (default 5). source: arcmira_premium | creator_captions | third_party_quick.',
    ],
  },
  {
    name: 'mentions',
    signature: 'arcmira.mentions({ entityId, channelId?, after?, before?, limit?, cursor? })',
    returns: '{ entity{id, name, page}, mentions[{media{video_id, title, published_at, channel_id, source_channel{name}}, start_seconds, is_appearance, description}], window{after, before}, has_more, next_cursor }',
    notes: ['When and where a name came up: one row per catalog mention, newest first, several rows per episode, limit 1..100. Never count rows to answer how many episodes: occurrences gives count per window. Rows carry no wording; for a spoken quote use search. Read the episode title before asserting a lone row: a title far from the entity (a jungle episode for a bank) is a homonym the catalog mislabelled.'],
  },
  {
    name: 'momentum',
    signature: 'arcmira.momentum(entityId, { days? })',
    returns: '{ entity, verdict (accelerating | flat | fading | none), as_of, window{after, before, days}, volume{mentions_window, mentions_prior_window, delta_window_absolute, delta_window_pct, mentions_7d, mentions_30d, mentions_prior_30d, total}, top_shows[{channel_id, channel_name, mentions}] }',
    notes: ['The last days (7 to 365, default 30) against the prior days of the same length, as of as_of, across the shows Arcmira indexes; verdict and top_shows cover that window. Pass the days the rest of the program uses, so every count shares one window. Each call uses 10 credits at any window.'],
  },
  {
    name: 'sponsors',
    signature: 'arcmira.sponsors(channelId, { minAdReads?, status?, limit? })',
    returns: '{ channel{name, page}, sponsors[{entity{id, name, page}, ad_reads, videos, first_seen, last_seen, sponsor_status{status}}], meta{total} }',
    notes: ['Recurring sponsors of one show, ranked by ad_reads. minAdReads (default 3), status (active | lapsed | ended | uncertain, filters on sponsor_status.status) and limit (1..200) are Pro+ filters; other plans throw filter_requires_paid.'],
  },
  {
    name: 'recommendations',
    signature: 'arcmira.recommendations(entityId, { kind?, channelId?, after?, before?, limit?, cursor? })',
    returns: '{ entity, recommendations[{class: sponsored | organic | mention, verbatim_quote, promo_code, media{video_id, title, published_at, channel_id, source_channel{name}}, start_seconds}], window{after, before}, has_more, next_cursor }',
    notes: ['Who recommends one entity on air. kind: sponsored | organic | all (default all), limit 1..100 (default 10). Account access applies; a gate reports the required tier in unlock.tier.'],
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
    returns: '{ state: ready | pending | failed | refunded; ready: video{id, title, channel_name, published_at, watch_url}, lines[{start, end, text, speaker?}], speakers[{id, name, entity_id}], quality, source, language, as_of, charge? (when this read started the transcription); pending: eta_seconds, job{id, state, status, charge, eta_seconds}, note; failed | refunded: job{error}? or last_attempt{status, error}, note }',
    notes: ['quality: captions (default) | premium (diarized: each line carries speaker, an id into speakers[], where name is the person or a label like Speaker 1; paid plans). start/end select the returned lines. A captions read uses 4 credits per started 15 minutes of the start/end window, or of the whole video without one. Read state before lines.', PREMIUM],
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
    notes: ['A price check, not a spoken quote: the credits a Premium read of the whole video would use, and how much of it would come from the on-demand budget. It uses no credits and starts nothing.'],
  },
  {
    name: 'status',
    signature: 'arcmira.status({ channelId? })',
    returns: '{ channel{youtube_channel_id, searchable_videos, indexed_through, search_indexed_through} } for a show; with no argument the key: { account{id, name, kind: personal | team, plan}, role: owner | admin | member, email_masked, tier, scopes, usage{credits{available, on_demand}, current_spend_cents} }',
    notes: ['With no argument: account is whose plan and credits the key spends (a team key spends the team account), role is the user\'s role there, and email_masked is the user, not the account.', 'searchable_videos counts searchable videos for this show. search_indexed_through is the newest publication date in its transcript search index; indexed_through describes overall indexed coverage. Neither date guarantees every earlier episode is present.'],
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
    notes: ['Fields take the names monitors.list returns. notify_frequency: realtime (as it happens) | hourly | daily (digests). Email goes to the account email; notify_emails adds recipients, who confirm before delivery. Slack: notify_slack: true with slack_integration_id and slack_channel_id from arcmira.integrations.slack().'],
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
    notes: ['Follows up to 90 exact names in one call, matched case-insensitively in newly analyzed media, so it works before a name is in the index. Use it only for names resolve finds nothing for; an id from resolve goes to addEntities. type: person | organization (org) | product | topic | channel; a channel is followed by its UC id, never its name. Results read like addEntities: attached: false with reason tracker_limit_reached or tracked_in_another_monitor.'],
    access: 'write',
  },
  {
    name: 'monitors.attachTrackers',
    signature: 'arcmira.monitors.attachTrackers(monitorId, trackerIds)',
    returns: '{ monitor_id, attached_count, message }',
    notes: ['Moves existing trackers (trk_ ids, the tracker_id of an addEntities result) into this monitor, out of any monitor that held them.'],
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
const hits = await arcmira.search({ query: "ramp", speakerIds: [e.id], after: arcmira.daysAgo(90), limit: 5 });
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
  'Dates. arcmira.today() and arcmira.daysAgo(n) give ISO dates from the server clock. With no window from the user, use the last 90 days, and narrow it when a name returns more than the answer needs. On a plan with a delay, arcmira.status() reports freshness { delay_days, served_through }, and a read the delay cut says where its results stop. Windows are half-open in UTC: after is the first day counted, before the first day left out (August is after 2026-08-01, before 2026-09-01). Dated results echo window{after, before}.',
  'Momentum, mentions and counts measure the shows Arcmira indexes, not the internet; say so when it matters. An empty result means this query returned no matches. Keep outside evidence separate from Arcmira results.',
  'Before asserting a mention, read its description or the passage text and say which sense of the name it is (Mercury the bank, not the planet or the element). Drop rows about another sense.',
  COVERAGE_GUIDANCE,
  'Results carry names beside ids and arcmira.com page links; link names to those pages and never invent an arcmira.com URL.',
];

export const MAX_CALLS = 40;

export const ERRORS = `ERRORS. Methods throw ArcmiraError with .code, .message and, for gates, .unlock { tier, url }: id_required (resolve first), invalid_video, too_many (over an id cap), entity_not_found, filter_requires_paid (.param needs a paid plan), freshness_requires_paid (the window is newer than the plan serves), pagination_gated (a cursor past the free window), recommendations_not_enabled, paid_plan_required, transcript_unavailable, transcript_fetching (.retry_after), insufficient_scope (the sign-in lacks monitors:write or trackers:write; reconnecting with them lifts this), write_tool_required, terms_acceptance_required (the account has not accepted the current Terms of Service; .message has the link), rate_limited (.retry_after_seconds), call_budget (over ${MAX_CALLS} API calls in one program). Usage codes are under USAGE. See ${DOCS.errors}.`;

const ROUTING =
  'WHICH METHOD. A spoken quote or what was said about a topic: search. Whether and when a name came up: mentions. How hot something is: momentum. What a show talks about, what two shows share, what one episode mentions, how many episodes mentioned X in a window: occurrences. Who sponsors a show: sponsors. Who recommends a brand: recommendations. The latest episode: episodes(channelId, { limit: 1 }). How many videos a show has indexed and its as-of date: status({ channelId }). One video\'s words: transcript. The credits a Premium read of a video would use: quote. The account the key spends, the user\'s role there, plan, credits and on-demand budget: status(). Following entities over time: monitors (the MONITORS note on monitors.list).';

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
    'FEEDBACK. arcmira_feedback records what was wrong, slow or missing. Pass call_id when a result named one.',
    '',
    `DOCS. API reference ${DOCS.api}, MCP guide ${DOCS.mcp}, error codes ${DOCS.errors}, OpenAPI ${DOCS.openapi}, agent index ${DOCS.llms}.`,
  ].join('\n');
}


/** Claude Code keeps the first 2,048 characters of server instructions; this leaves headroom. manifest:check and the tests hold SHORT_GUIDE to it. */
export const MAX_INSTRUCTIONS = 2_000;

/** The server instructions: the rules that change answers first, since a host may cut the tail. */
export const SHORT_GUIDE = [
  'Arcmira searches indexed YouTube and podcast transcripts, with a catalog of who is mentioned where, who sponsors whom, and who recommends what on air.',
  'arcmira_describe returns the arcmira JavaScript client reference; call it once before your first program. arcmira_execute_read runs a program against that client. arcmira_execute_write runs the same client plus monitor changes. arcmira_feedback records what was wrong, slow or missing; a result that warrants it names its call_id.',
  'Write one program per question. Filters take ids only (ent_..., UC..., 11-character video ids), so resolve every name first with arcmira.resolve, passing the user\'s own words about the name as context. resolve answers best, suggested (one row stands out; say you assumed it) or ask (several fit; return ask.options for the user to pick). No answer means the name is not in the index.',
  'Date windows default to the last 90 days unless the user names one; reads on a delayed plan say where results stop. Counts cover the shows Arcmira indexes, not the whole web.',
  BUDGET_RULE,
  MONITOR_OFFER,
].join(' ');
