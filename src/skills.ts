/**
 * Task skills: one per job people bring to Arcmira today (research/demand.md in the program store
 * ranks them). scripts/build-skill.ts writes each to plugins/arcmira/skills/<name>/SKILL.md, the
 * test suite checks every arcmira.<method> a program calls against METHODS in reference.ts, and
 * scripts/check-examples.ts runs every program against production, so a renamed method or field
 * fails before a user sees it. The method table lives in the arcmira skill and in describe; these
 * skills carry only the procedure, the program and the bar for a good answer.
 *
 * Users give names, never ids. Every program starts from a name, stops with the resolve `ask` when
 * several entities fit, says when it assumed one, and takes the pick back through ID on the second run.
 */

import { LINKS } from './reference.ts';

export interface TaskSkill {
  name: string;
  /** Always-on text in every host's skill listing: keep it under 160 characters. */
  description: string;
  title: string;
  summary: string;
  asks: string[];
  /** Task-specific resolution notes; PICK_STEPS (the same for every skill) comes first. */
  ids: string[];
  /** The procedure, when the task is more than one program. */
  steps?: string[];
  /** write: the block runs in arcmira_execute_write; every other block runs in arcmira_execute_read. */
  programs: ReadonlyArray<{ title: string; code: string; tool?: 'write' }>;
  good: string[];
  traps: string[];
}

/** The offer every skill closes with when its research found entities (rule 5). */
export const SAVE_OFFER =
  'When the answer named companies, people, shows or topics worth following, offer once to save them to a monitor so updates arrive on their own. On a yes, follow the `company-watch` skill: it lists the user\'s monitors first and asks how they want updates.';

/** How every task skill turns a name into the one entity the user meant. */
export const PICK_STEPS = [
  'Resolve the exact name the user said, and pass their own words about it as `context` when they gave any ("Sam, the My First Million co-host" is `resolve("Sam", { context: "the My First Million co-host" })`). Context is only words from the user\'s message, never your guess: a bare "Theo" is `resolve("Theo")`, and its ask goes back to the user.',
  '`best`: the name means that row. Use it and name it.',
  '`suggested`: no row is certain but one stands out. Use it and tell the user you assumed it, quoting `suggested.evidence` ("Sam Altman, assuming the most mentioned Sam: 4,399 appearances, 11x the next").',
  '`ask`: several rows fit and none stands out. Return `ask.options` for the user to pick and stop, or check every option id against the data in one program (occurrences or momentum with all the ids) and answer per row, naming each.',
  'None of the three: the name is not in the Arcmira index. Say so and ask for another spelling or a link; never answer for a different entity without saying so.',
  'Say which entity the answer is about (name, type, id) in the answer. Never switch entities silently.',
  'Before asserting a mention, read its description or passage and say which sense of the name it is (Mercury the bank, not the element). Drop rows about another sense.',
];

/** The guard every program opens with: ask options when several rows fit, else the one id and whether it was assumed. ID reruns it with the pick. */
function pick(name: string, type?: 'person' | 'channel'): string {
  const opts = type ? `{ type: "${type}", context: CONTEXT }` : '{ context: CONTEXT }';
  const channel = type === 'channel';
  const options = channel
    ? 'r.ask && { question: r.ask.question, options: r.ask.options.map(o => ({ ...o, channel_id: r.candidates.find(c => c.id === o.id)?.youtube_channel_id ?? null })) }'
    : 'r.ask';
  return `const NAME = "${name}", CONTEXT = undefined, ID = null;   // CONTEXT: the user's own words about the name, never a guess. After an ask, set ID to the picked option's ${channel ? 'channel_id' : 'id'} and run again
const r = ID ? null : await arcmira.resolve(NAME, ${opts});
const e = r && (r.best ?? r.suggested);
if (r && !e) return { ask: ${options} };
const id = ID ?? e.${channel ? 'youtube_channel_id' : 'id'};
const assumed = Boolean(r?.suggested), why = r?.suggested?.evidence ?? null;`;
}

export const TASK_SKILLS: readonly TaskSkill[] = [
  {
    name: 'sponsor-research',
    description: 'Sponsor and ad-read research on podcasts and YouTube: who sponsors a show, or which shows a brand sponsors, how often, since when. Uses arcmira.',
    title: 'Sponsor research',
    summary:
      'Two directions. A show to its sponsors: `arcmira.sponsors(channelId)` ranks recurring sponsors by ad reads with first and last seen dates. A brand to the shows it sponsors: `arcmira.recommendations(entityId, { kind: "sponsored" })` lists each ad read, which the program groups by show.',
    asks: ['who sponsors a show, how many ad reads, since when, still active', 'which shows a brand sponsors or advertises on, and how often', 'sponsors two shows share (sponsors of each, then intersect by entity.id)'],
    ids: [
      'A show resolves with `{ type: "channel" }`; its id is `youtube_channel_id` (a UC id).',
      'A brand resolves with no type (a company can be typed product). A sponsor is a company: a person or a topic with the same name ("Freddie Mercury") is not the brand.',
      'When two company rows compete, the one with ad reads is the sponsor: run the brand program for each and keep the one with reads.',
    ],
    programs: [
      {
        title: "A show's sponsors",
        code: `${pick('TBPN', 'channel')}
const s = await arcmira.sponsors(id);   // limit is a Pro+ filter; slice instead
return {
  show: s.channel.name, channel_id: id, page: s.channel.page, assumed, why, sponsors_total: s.meta.total,
  sponsors: s.sponsors.slice(0, 10).map(x => ({ name: x.entity.name, id: x.entity.id, page: x.entity.page, ad_reads: x.ad_reads, episodes: x.videos, first_seen: x.first_seen, last_seen: x.last_seen, status: x.sponsor_status?.status ?? null })),
};`,
      },
      {
        title: 'The shows a brand sponsors, last 90 days',
        code: `${pick('Mercury')}
const after = arcmira.daysAgo(90);
const reads = [];
let cursor, entity, window;
do {
  const page = await arcmira.recommendations(id, { kind: "sponsored", after, limit: 50, cursor });
  entity = page.entity;
  window = page.window;
  reads.push(...page.recommendations);
  cursor = page.has_more ? page.next_cursor : undefined;
} while (cursor && reads.length < 500);
const shows = new Map();
for (const x of reads) {
  const name = x.media.source_channel?.name ?? x.media.channel_id;
  const row = shows.get(name) ?? { show: name, channel_id: x.media.channel_id, ad_reads: 0, episodes: new Set(), latest: "" };
  row.ad_reads += 1;
  row.episodes.add(x.media.video_id);
  if (x.media.published_at > row.latest) row.latest = x.media.published_at;
  shows.set(name, row);
}
return {
  brand: { id, name: entity?.name ?? e?.name ?? null, type: entity?.type ?? e?.type ?? null, assumed, why }, window, ad_reads_total: reads.length,
  shows: [...shows.values()].sort((a, b) => b.ad_reads - a.ad_reads).slice(0, 10).map(s => ({ ...s, episodes: s.episodes.size })),
  sample_read: reads[0] ? { said: reads[0].verbatim_quote, show: reads[0].media.source_channel?.name ?? null, date: reads[0].media.published_at, promo_code: reads[0].promo_code } : null,
};`,
      },
    ],
    good: [
      'Names the brand or show it used, with its type and id, and any look-alike it set aside.',
      'Ranks sponsors (or shows) by ad reads and gives the counts, first and last seen dates, and active or lapsed.',
      'States the window and the as-of date, and that counts cover the shows Arcmira indexes.',
      'Quotes one ad read verbatim with its promo code when there is one, and links each name to the `page` the result carries.',
    ],
    traps: [
      '`recommendations` can return `recommendations_not_enabled`. Explain the account-access limit and required tier reported by the API; a channel sponsor list does not answer which shows recommend a brand.',
      'An ad read is sponsored; an unpaid on-air endorsement is `kind: "organic"`. Do not mix them in one count.',
      'Page with `cursor` until `has_more` is false before you count reads; one page is at most 50 rows.',
    ],
  },
  {
    name: 'company-watch',
    description: 'Watches a company or topic on podcasts and YouTube: what was said lately (shows, counts, momentum, quotes), then an Arcmira monitor to keep following it.',
    title: 'Company watch',
    summary:
      'Answers "what was said about X lately" in one program, over the last 30 days unless the user names a window: episode counts per show from `occurrences`, the trend from `momentum`, the catalog notes from `mentions`, and quotes from `search` about the entity. Then it turns "keep me posted on X" into a monitor that delivers. Research picks the entity ids: a company or person through `resolve`, a topic through each of its spellings. The user\'s own monitors decide where they go: suggest one that fits, or create one after asking how they want updates. Only the save runs in `arcmira_execute_write`; everything before it reads.',
    asks: [
      'what is being said about a company, product or brand lately, this month or this week, and is talk rising or fading',
      'did any show mention us, a competitor or an investor lately',
      'keep me posted on a company, a competitor, a person or a topic',
      'save what this research found to a monitor, or tell me when X comes up on a show',
      'watch a topic like "data center discourse" across shows',
    ],
    ids: [
      'Resolve a company with no type (the catalog types some companies as product) and a person with `{ type: "person" }`. A company name is often a common word ("Linear", "Ramp", "ICE"): name each pick, for example "Linear, the software company (product, ent_279443)", so the user can catch a wrong one before it is answered or saved.',
      'A topic has spellings. Resolve each variant with `{ type: "topic" }` ("data centers", "datacenters", "data centre", "data center") and keep every distinct id: one tracker per spelling catches what one would miss.',
      'Never assume a monitor exists ("Competitors" may not). Read `arcmira.monitors.list()` and the trackers of each candidate before suggesting one, and never add an entity a monitor already follows.',
    ],
    steps: [
      'What was said lately: run the first program and answer. Then offer to keep following the entity with a monitor; on a yes, go on.',
      'Find what to follow and the monitors that could hold it: the second program, in `arcmira_execute_read`. Reuse ids the research already found instead of resolving again.',
      'A monitor fits when its name or its trackers match the subject. Suggest it by name ("Add Linear to your Dev tools monitor?") and wait for a yes.',
      'None fits: ask how the user wants updates, one question at a time, each with a default they can accept with "yes". First where: email to the account address (default) or Slack. Then when: as it happens, an hourly digest, or a daily digest (default daily). Then the name (default: the subject, like "Data center discourse").',
      `Slack: the first program lists the connected workspaces (\`slack\`). With one, deliver there: \`notify_slack: true\`, its id as \`slack_integration_id\` and its \`default_channel_id\` as \`slack_channel_id\`; with several, ask which. With none, link ${LINKS.integrations} to connect one, and save with email for now, saying so; switch it later with \`arcmira.monitors.update\`.`,
      'Save with the third program, in `arcmira_execute_write`: create the monitor only when none fits (or set Slack on the one that fits), then `addEntities` with every id in one call. A name resolve found nothing for can still be followed by its exact name with `addName` (a show by its UC id), which catches it once a show says it.',
      'Tell the user plainly about every id that did not attach. `entity_not_found`: Arcmira has no such entity; offer another spelling. `entity_type_not_trackable`: that kind of entity cannot be followed. `tracker_limit_reached`: the plan\'s tracker limit is full; pausing or removing trackers in the dashboard, or a higher plan, makes room. `tracked_in_another_monitor`: say which monitor already follows it (`current_monitor_name`) and ask before moving it; on a yes, `arcmira.monitors.attachTrackers(monitorId, [tracker_id])` in `arcmira_execute_write` moves it. When a result carries `canonical_entity_id`, the id was merged into that one; name the canonical entity.',
      'Close with what arrives, where and when, and that `arcmira.monitors.update(id, { paused: true })` pauses it; nothing is deleted.',
    ],
    programs: [
      {
        title: 'The last 30 days about one company (arcmira_execute_read)',
        code: `${pick('Linear')}
const after = arcmira.daysAgo(30);   // the user's window when they name one ("this week": 7)
const [m, occ, notes] = await Promise.all([
  arcmira.momentum(id),
  arcmira.occurrences({ entityIds: [id], after, limit: 10 }),
  arcmira.mentions({ entityId: id, after, limit: 8 }),
]);
let quotes = await arcmira.search({ query: m.entity.name, about: [id], after, limit: 5 });
const quotesTagged = quotes.chunks.length > 0;   // false: the fallback matched the words, which can be a namesake; say so
if (!quotesTagged) quotes = await arcmira.search({ query: m.entity.name, after, limit: 5 });
return {
  entity: { id, name: m.entity.name, type: m.entity.type, page: m.entity.page, assumed, why },
  window: occ.window,
  momentum: { verdict: m.verdict, last_7d: m.volume.mentions_7d, last_30d: m.volume.mentions_30d, prior_30d: m.volume.mentions_prior_30d, as_of: m.as_of },
  shows: occ.rows.map(x => ({ show: x.channel_name, channel_id: x.channel_id, episodes: x.count, times_said: x.occurrences })),
  context: notes.mentions.map(x => ({ show: x.media.source_channel?.name ?? null, episode: x.media.title, date: x.media.published_at, note: x.description })),
  quotes_tagged_to_entity: quotesTagged,
  quotes: quotes.chunks.map(c => ({ said: c.text.slice(0, 300), show: c.channel_name, episode: c.video_title, date: c.published_at, url: c.watch_url })),
};`,
      },
      {
        title: 'Find what to follow, and the monitors that could hold it (arcmira_execute_read)',
        code: `const NAMES = ["Linear", "Height"], TOPICS = ["data centers", "datacenters", "data centre"];   // the user's subjects; TOPICS: every spelling of one topic
const follow = [], unresolved = [];
for (const n of NAMES) {
  const r = await arcmira.resolve(n);
  const e = r.best ?? r.suggested;
  if (e) follow.push({ name: e.name, id: e.id, type: e.type, assumed: Boolean(r.suggested), why: r.suggested?.evidence ?? null });
  else unresolved.push({ name: n, ask: r.ask ?? null });
}
for (const t of TOPICS) {
  const r = await arcmira.resolve(t, { type: "topic" });
  const e = r.best ?? r.suggested;
  if (e && !follow.some(f => f.id === e.id)) follow.push({ name: e.name, id: e.id, type: e.type, spelling: t });
}
const [{ monitors }, { integrations }] = await Promise.all([arcmira.monitors.list(), arcmira.integrations.slack()]);
const existing = await Promise.all(monitors.slice(0, 10).map(async m => ({
  id: m.id, name: m.name, paused: m.paused, frequency: m.notify_frequency, slack: Boolean(m.notify_slack),
  follows: (await arcmira.monitors.trackers(m.id)).trackers.map(t => t.display_name ?? t.entity_name),
})));
const slack = integrations.map(i => ({ slack_integration_id: i.id, workspace: i.team_name, slack_channel_id: i.default_channel_id, channel: i.channels.find(c => c.id === i.default_channel_id)?.name ?? null }));
return { follow, unresolved, monitors: existing, more_monitors: Math.max(0, monitors.length - 10), slack };`,
      },
      {
        title: 'Save to a monitor (arcmira_execute_write)',
        tool: 'write',
        code: `const MONITOR_ID = null;   // a fitting monitor's id from the first program, or null to create one
const IDS = ["ent_279443"];   // every id the user agreed to follow
const NAMES = [];   // names resolve found nothing for that the user still wants followed: [{ name: "Acme Robotics", type: "organization" }]
const DELIVERY = { name: "Linear", notify_frequency: "daily" };   // the user's answers, for a new monitor
const SLACK = null;   // the user chose Slack: { slack_integration_id, slack_channel_id } from the first program's slack
const slack = SLACK ? { notify_slack: true, slack_integration_id: SLACK.slack_integration_id, ...(SLACK.slack_channel_id ? { slack_channel_id: SLACK.slack_channel_id } : {}) } : {};
const monitor = MONITOR_ID
  ? (SLACK ? (await arcmira.monitors.update(MONITOR_ID, slack)).monitor : { id: MONITOR_ID })
  : (await arcmira.monitors.create({ ...DELIVERY, ...slack })).monitor;
const { results } = IDS.length ? await arcmira.monitors.addEntities(monitor.id, IDS) : { results: [] };
const byName = [];
for (const n of NAMES) byName.push(await arcmira.monitors.addName(monitor.id, n));
const others = results.some(r => r.reason === "tracked_in_another_monitor") ? (await arcmira.monitors.list()).monitors : [];
return {
  monitor: { id: monitor.id, name: monitor.name ?? null, created: !MONITOR_ID, slack: Boolean(SLACK) },
  attached: results.filter(r => r.attached).map(r => ({ entity_id: r.canonical_entity_id ?? r.entity_id, merged_from: r.canonical_entity_id ? r.entity_id : null, new_tracker: r.created })),
  not_attached: results.filter(r => !r.attached).map(r => ({ entity_id: r.entity_id, reason: r.reason, tracker_id: r.tracker_id ?? null, current_monitor_id: r.current_monitor_id ?? null, current_monitor_name: others.find(m => m.id === r.current_monitor_id)?.name ?? null })),
  by_name: byName,
};`,
      },
    ],
    good: [
      'For what was said: opens with the entity (name, type, id), gives the verdict with the 7-day and 30-day counts and `as_of`, the shows with episode counts for the stated window, and two or three quotes in the speakers\' words, each with show, date and `watch_url`.',
      'Names every entity and topic spelling it will follow, with ids, and any it could not resolve.',
      'Suggests an existing monitor only after reading the user\'s monitors, and says which entities it already follows.',
      'Asks the delivery questions one at a time with a default each; for Slack, uses the connected workspace, or links the connection page and says the monitor uses email until then.',
      'Names every id that did not attach and why, and asks before moving a tracker another monitor holds.',
      'After saving, says what arrives, where and how often, and how to pause it.',
    ],
    traps: [
      'Counts measure the shows Arcmira indexes, not the internet. An empty window means no indexed show said it; cite `as_of` before saying nothing happened. Count episodes with `occurrences`, never by counting `mentions` rows.',
      'Read episode titles and notes before asserting a lone mention: a title far from the company is a homonym the catalog mislabelled.',
      'Never create or change a monitor before the user agreed to where it goes and how it delivers.',
      'A monitor id comes from `monitors.list()`, never from a name the user said.',
      '`tracked_in_another_monitor` leaves the tracker where it is. Never move it without a yes.',
      '`insufficient_scope` means the sign-in lacks monitors:write or trackers:write: tell the user to reconnect Arcmira and allow monitor changes.',
      'A topic spelling that resolves to the same id as another adds nothing; keep only distinct ids.',
    ],
  },
  {
    name: 'find-quotes',
    description: 'Finds exact spoken quotes and clip-ready moments on podcasts and YouTube: verbatim words, speaker, date, a timestamped link, clip start and end. Uses arcmira.',
    title: 'Find quotes and clip moments',
    summary:
      '`search` finds the passage; `transcript` with `start` and `end` returns the exact lines around it with second offsets, which give the verbatim quote and the clip boundaries. Caption reads bill returned lines. A Premium purchase always prices the whole video; start/end only select the returned window.',
    asks: ['find a quote, with the source and a timestamp', 'the moment a show talked about a topic, to clip or cite', 'what a specific person said about a topic, in their words'],
    ids: [
      'A speaker resolves with `{ type: "person" }`; pass the id as `speakerIds` (who said it). A person or brand the passage is about goes in `about`. A show goes in `channelIds` as its UC id.',
      'People are often named by first name ("Chamath"). Pass what the user said about them as `context`; resolve suggests the person when one stands out and asks when several fit.',
      'The topic words go in `query`, never in `about`. If a filtered search returns no chunks, rerun it with fewer filters before saying nothing was found.',
    ],
    programs: [
      {
        title: 'What one person said about a topic, with clip boundaries',
        code: `${pick('Chamath', 'person')}
const hits = await arcmira.search({ query: "Anthropic IPO", speakerIds: [id], limit: 5 });
const moments = [];
for (const c of hits.chunks.slice(0, 2)) {
  const moment = { episode: c.video_title, show: c.channel_name, date: c.published_at, url: c.watch_url, speakers: c.speakers_by.map(s => s.name) };
  try {
    const t = await arcmira.transcript(c.video_id, { start: Math.max(0, c.start_seconds - 10), end: c.start_seconds + 50 });
    moment.clip = { start: t.lines[0]?.start ?? c.start_seconds, end: t.lines.at(-1)?.end ?? c.start_seconds + 60 };
    moment.lines = t.lines.map(l => \`[\${Math.round(l.start)}s] \${l.text}\`);
  } catch (err) {
    moment.clip = { start: c.start_seconds, end: c.start_seconds + 60 };
    moment.passage = c.text;
    moment.transcript = err.code;
  }
  moments.push(moment);
}
return { speaker: { id, name: e?.name ?? null, assumed, why }, as_of: hits.as_of, ...(moments.length ? { moments } : { none: hits.note ?? null }) };`,
      },
    ],
    good: [
      'Names the speaker or show it searched, with the id, and quotes the words exactly as the transcript lines give them, trimmed to whole sentences, never paraphrased inside quotation marks.',
      'Gives the show, the episode title, the date, and the speaker when the chunk or a premium transcript names one.',
      'Links the `watch_url`, which starts at the moment, and gives a clip start and end in seconds from the transcript lines.',
      'Says so when nothing matched, with `as_of`, instead of offering a quote from memory.',
    ],
    traps: [
      '`search` ranks by the words in `query`; put the distinctive words of the phrase there, not a paraphrase.',
      'A chunk found with `speakerIds` also holds other people\'s lines. Quote only lines that start with the speaker\'s name ("Chamath Palihapitiya: ..."), never the whole passage.',
      'Caption lines are machine text: fix nothing inside the quotation marks. A premium transcript (`quality: "premium"`, paid plans) adds speaker ids into `speakers[]`.',
      'Keep transcript windows short (`start`, `end`): a whole episode bills every line.',
      'Some videos have no readable caption track yet (`transcript_unavailable`, `transcript_fetching`); quote the search chunk `text` for those and say the words come from the search passage.',
    ],
  },
  {
    name: 'person-research',
    description: 'Researches a person across podcasts and YouTube for interview or meeting prep: where they appeared, their own words, who discusses them. Uses arcmira.',
    title: 'Person research',
    summary:
      'Three lenses on one person id. `momentum` gives attention and the shows that mention them most. `mentions` rows with `is_appearance` are episodes they were on. `search` with `speakerIds` returns their own words; `about` returns what others said about them.',
    asks: ['prep for an interview, a podcast booking or a meeting with someone', 'what has a person said recently, and where', 'who talks about a person, and is attention rising'],
    ids: [
      'Resolve with `{ type: "person" }`. A first name alone ("Sam") matches many people: pass what the user said about them (runs OpenAI, hosts a show) as `context`, and when resolve still answers `ask`, show its options.',
    ],
    programs: [
      {
        title: 'Prep on one person',
        code: `${pick('Jensen Huang', 'person')}
const [m, rows, own] = await Promise.all([
  arcmira.momentum(id),
  arcmira.mentions({ entityId: id, after: arcmira.daysAgo(90), limit: 40 }),
  arcmira.search({ query: "AI", speakerIds: [id], after: arcmira.daysAgo(180), limit: 5 }),
]);
const about = await arcmira.search({ query: m.entity.name, about: [id], after: arcmira.daysAgo(30), limit: 3 });
const appeared = new Map();
for (const x of rows.mentions) if (x.is_appearance) appeared.set(x.media.video_id, { show: x.media.source_channel?.name ?? null, episode: x.media.title, date: x.media.published_at });
let fromAppearance = null;   // no speaker-tagged chunks: read their newest appearance instead
const ep = own.chunks.length === 0 ? rows.mentions.find(x => x.is_appearance) : undefined;
if (ep) {
  try {
    const t = await arcmira.transcript(ep.media.video_id, { start: Math.max(0, ep.start_seconds - 5), end: ep.start_seconds + 90 });
    const s = Math.floor(t.lines[0]?.start ?? ep.start_seconds);
    fromAppearance = { episode: t.video.title, show: t.video.channel_name, date: t.video.published_at, url: \`\${t.video.watch_url}\${t.video.watch_url.includes("?") ? "&" : "?"}t=\${s}\`, lines: t.lines.map(l => \`[\${Math.round(l.start)}s] \${l.text}\`), speaker_labelled: t.lines.some(l => l.speaker) };
  } catch (err) {
    fromAppearance = { episode: ep.media.title, error: err.code };
  }
}
return {
  person: { id, name: m.entity.name, page: m.entity.page, assumed, why },
  attention: { verdict: m.verdict, last_30d: m.volume.mentions_30d, prior_30d: m.volume.mentions_prior_30d, as_of: m.as_of, top_shows: m.top_shows.map(s => [s.channel_name, s.mentions]) },
  appeared_on: [...appeared.values()].slice(0, 8),
  appeared_on_partial: rows.has_more,   // true: only the newest 40 mention rows were read
  in_their_words: own.chunks.map(c => ({ said: c.text.slice(0, 300), episode: c.video_title, show: c.channel_name, date: c.published_at, url: c.watch_url })),
  from_their_appearance: fromAppearance,
  said_about_them: about.chunks.map(c => ({ said: c.text.slice(0, 200), show: c.channel_name, date: c.published_at, url: c.watch_url })),
};`,
      },
    ],
    good: [
      'Names the person it researched (name and id), and any other person with the same name it set aside.',
      'Separates what the person said (speaker-filtered) from what others said about them, each with show, date and link.',
      'Gives the attention verdict, the 30-day count against the prior 30 days, and the top shows, with `as_of`.',
      'Lists recent episodes they appeared on, and ends with a few questions or themes that follow from the quotes when the user is prepping.',
    ],
    traps: [
      'A search with `about` returns other people talking; only `speakerIds` returns the person\'s own words. Speaker tags cover part of the index (Sam Altman has none), so when the speaker search is empty, read a window of an episode they appeared on and say the lines come from their appearance, since caption lines do not name the speaker.',
      'A chunk found with `speakerIds` also holds other people\'s lines. Quote only lines that start with the person\'s name.',
      'Put the user\'s topic in `query` for the speaker search (it needs a word or phrase of two or more characters).',
      'Mentions and momentum count the shows Arcmira indexes, not all media.',
    ],
  },
  {
    name: 'compare-shows',
    description: 'Compares two podcasts or YouTube shows side by side: size, latest episode, what each talks about, what both cover, and shared sponsors. Uses arcmira.',
    title: 'Compare two shows',
    summary:
      '`status` sizes each show, `episodes` gives the latest, `occurrences` with both channel ids ranks what each covers and returns `shared` for what both mention, and `sponsors` of each, joined on entity id, gives shared sponsors.',
    asks: ['compare two shows, or a show against a competitor', 'what two podcasts both talk about, or who they both advertise', 'a digest of what one or two shows covered this week or month'],
    ids: [
      'Resolve each show with `{ type: "channel" }` and use `youtube_channel_id`. Users shorten show names ("All In", "MTS"); resolve suggests a show by its initials or closest spelling, so say when a show was assumed. When nothing comes back, retry the full or hyphenated name before saying the show is not in the index.',
      'Pass both UC ids in one `occurrences` call and read `shared`.',
    ],
    programs: [
      {
        title: 'Two shows, last 30 days',
        code: `const SHOWS = ["TBPN", "All-In Podcast"], IDS = [null, null];   // after an ask, put the picked option's channel_id in IDS and run again
const ids = [], names = [], assumed = [];
for (const [i, n] of SHOWS.entries()) {
  if (IDS[i]) { ids.push(IDS[i]); names.push(n); assumed.push(null); continue; }
  const r = await arcmira.resolve(n, { type: "channel" });
  const e = r.best ?? r.suggested;
  if (!e) return { unresolved: n, ask: r.ask && { question: r.ask.question, options: r.ask.options.map(o => ({ ...o, channel_id: r.candidates.find(c => c.id === o.id)?.youtube_channel_id ?? null })) } };
  ids.push(e.youtube_channel_id);
  names.push(e.name);
  assumed.push(r.suggested ? r.suggested.evidence : null);
}
const after = arcmira.daysAgo(30);
const [s0, s1, e0, e1, occ, sp0, sp1] = await Promise.all([
  arcmira.status({ channelId: ids[0] }), arcmira.status({ channelId: ids[1] }),
  arcmira.episodes(ids[0], { limit: 1 }), arcmira.episodes(ids[1], { limit: 1 }),
  arcmira.occurrences({ channelIds: ids, types: ["organization", "product"], after, limit: 40 }),
  arcmira.sponsors(ids[0]), arcmira.sponsors(ids[1]),
]);
const inOther = new Map(sp1.sponsors.map(x => [x.entity.id, x.ad_reads]));
return {
  window: occ.window,
  shows: ids.map((id, i) => ({ name: names[i], channel_id: id, assumed: Boolean(assumed[i]), why: assumed[i], videos_indexed: [s0, s1][i].channel.searchable_videos, indexed_through: [s0, s1][i].channel.indexed_through, latest: [e0, e1][i].episodes[0]?.title ?? null,
    top: occ.rows.filter(x => x.channel_id === id).slice(0, 5).map(x => [x.name, x.count]) })),
  both_discussed: occ.shared.slice(0, 5).map(x => ({ name: x.name, id: x.entity_id, episodes_by_show: x.by_channel.map(c => [c.channel_name, c.count]) })),
  shared_sponsors: sp0.sponsors.filter(x => inOther.has(x.entity.id)).map(x => ({ name: x.entity.name, id: x.entity.id, ad_reads: [x.ad_reads, inOther.get(x.entity.id)] })),
};`,
      },
    ],
    good: [
      'Names both shows as resolved, with their channel ids.',
      'A side-by-side: videos indexed and `indexed_through` for each, the latest episode, and each show\'s top subjects with episode counts.',
      'What both covered, from `shared`, with episodes per show, and the shared sponsors with ad reads per show, for a stated window.',
    ],
    traps: [
      'With two or more `channelIds`, `occurrences` puts the overlap in `shared`; `rows` alone never shows it.',
      'Never count `episodes` to size a show; `status({ channelId }).channel.searchable_videos` is the count.',
      'An empty `shared` in a short window is an answer (no overlap in the window), not an error; widen the window only if the user asked for a longer one.',
    ],
  },
];
