/**
 * Task skills: one per job people bring to Arcmira today. scripts/build-skill.ts writes each to plugins/arcmira/skills/<name>/SKILL.md, the
 * test suite checks every arcmira.<method> a program calls against METHODS in reference.ts, and
 * scripts/check-examples.ts runs every program against production, so a renamed method or field
 * fails before a user sees it. The method table lives in the arcmira skill and in describe; these
 * skills carry only the procedure, the program and the bar for a good answer.
 *
 * Users give names, never ids. Every program starts from a name, stops with the resolve `ask` when
 * several entities fit, says when it assumed one, and takes the pick back through ID on the second run.
 */

import { MONITOR_RULE } from './reference.ts';

/** write: the block runs in arcmira_execute_write; every other block runs in arcmira_execute_read. */
export interface Program {
  title: string;
  code: string;
  tool?: 'write';
}

/** Part of a task written to the skill's references/<file>, so its SKILL.md stays under the size a host reads whole. */
export interface SkillReference {
  file: string;
  title: string;
  /** A shared rule from reference.ts the reference carries whole, before its programs. */
  rule?: string;
  programs: readonly Program[];
}

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
  programs: readonly Program[];
  reference?: SkillReference;
  good: string[];
  traps: string[];
}

/** Every program a task skill ships, in its SKILL.md and its reference. */
export const programsOf = (t: TaskSkill): readonly Program[] => [...t.programs, ...(t.reference?.programs ?? [])];

/** How every task skill turns a name into the one entity the user meant; the pick block in each program does the rest. */
export const PICK_STEPS = [
  'Resolve the exact name the user said, with their own words about it as `context` (a bare "Theo" has none).',
  '`best` and `suggested` give the id. A `suggested` pick is an assumption: the answer names it, with `suggested.evidence` as the reason.',
  '`ask`: several entities fit, and `ask.options` goes back to the user. No answer at all: the name is not in the index.',
];

/** Said before any download step, word for word. The clip program returns it beside every download command. */
export const CLIP_RIGHTS = 'You need the rights to download, cut or reuse this video. Arcmira finds the moment and gives you the link and the seconds. It grants no rights to the video.';

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
    description: 'Use Arcmira for sponsor research on YouTube, podcasts included: who sponsors a show, which shows a brand sponsors, ad-read counts, first and last seen dates.',
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
  const page = await arcmira.recommendations(id, { kind: "sponsored", after, limit: 100, cursor });
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
      'Ranks sponsors (or shows) by ad reads and gives the counts, first and last seen dates, and the sponsor status.',
      'States the window and the as-of date, and that counts cover the shows Arcmira indexes.',
      'Quotes one ad read verbatim with its promo code when there is one, and links each name to the `page` the result carries.',
    ],
    traps: [
      '`recommendations` can return `recommendations_not_enabled`. Explain the account-access limit and required tier reported by the API; a channel sponsor list does not answer which shows recommend a brand.',
      'An ad read is sponsored; an unpaid on-air endorsement is `kind: "organic"`. Do not mix them in one count.',
      'Page with `cursor` until `has_more` is false before you count reads; one page is at most 100 rows.',
    ],
  },
  {
    name: 'company-watch',
    description: 'Use Arcmira to watch what YouTube says about a company, podcasts included: recent mentions, counts, momentum and quotes, then alerts.',
    title: 'Company watch',
    summary:
      'Answers "what was said about X lately" in one program, over the last 90 days unless the user names a window: episode counts per show from `occurrences`, the trend from `momentum`, the catalog notes from `mentions`, and quotes from `search` about the entity. Then it turns "keep me posted on X" into a monitor that delivers. Research picks the entity ids: a company or person through `resolve`, a topic through each of its spellings. The user\'s own monitors decide where they go: one that fits, or a new one the user confirms. Only the save runs in `arcmira_execute_write`; everything before it reads.',
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
    ],
    steps: [
      'What was said lately: run the program below and answer.',
      'To follow the subject: the read program in references/monitor.md resolves every name and topic spelling (reuse ids the research already found) and reads the user\'s monitors, what each follows, and the connected Slack workspaces.',
      'To save: the write program there, in `arcmira_execute_write`, uses the monitor that fits or creates one, follows every id with `addEntities` and every unresolved name with `addName`, and returns each id that did not attach with its reason and `current_monitor_name`. A `canonical_entity_id` means the id was merged into that entity.',
    ],
    programs: [
      {
        title: 'The last 90 days about one company (arcmira_execute_read)',
        code: `${pick('Linear')}
const after = arcmira.daysAgo(90);   // the user's window when they name one ("this week": 7)
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
    ],
    reference: {
      file: 'monitor.md',
      title: 'Follow and save to a monitor',
      rule: MONITOR_RULE,
      programs: [
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
for (const n of NAMES) {
  try { byName.push(...(await arcmira.monitors.addName(monitor.id, [n])).results); }
  catch (err) { byName.push({ name: n.name, code: err.code, message: err.message }); }
}
const others = results.some(r => r.reason === "tracked_in_another_monitor") ? (await arcmira.monitors.list()).monitors : [];
return {
  monitor: { id: monitor.id, name: monitor.name ?? null, created: !MONITOR_ID, slack: Boolean(SLACK) },
  attached: results.filter(r => r.attached).map(r => ({ entity_id: r.canonical_entity_id ?? r.entity_id, merged_from: r.canonical_entity_id ? r.entity_id : null, new_tracker: r.created })),
  not_attached: results.filter(r => !r.attached).map(r => ({ entity_id: r.entity_id, reason: r.reason, tracker_id: r.tracker_id ?? null, current_monitor_id: r.current_monitor_id ?? null, current_monitor_name: others.find(m => m.id === r.current_monitor_id)?.name ?? null })),
  by_name: byName,
};`,
        },
      ],
    },
    good: [
      'For what was said: opens with the entity (name, type, id), gives the verdict with the 7-day and 30-day counts and `as_of`, the shows with episode counts for the stated window, and two or three quotes in the speakers\' words, each with show, date and `watch_url`.',
      'Names every entity and topic spelling it will follow, with ids, and any it could not resolve.',
      'Suggests an existing monitor only after reading the user\'s monitors, and says which entities it already follows.',
      'Confirms the monitor and its delivery before saving; for Slack, uses a connected workspace, or links the connection page and says the monitor uses email until then.',
      'Names every id that did not attach and why, and asks before moving a tracker another monitor holds.',
      'After saving, says what arrives, where and how often, and how to pause it.',
    ],
    traps: [
      'Counts measure the shows Arcmira indexes, not the internet. An empty window means no indexed show said it; cite `as_of` before saying nothing happened. Count episodes with `occurrences`, never by counting `mentions` rows.',
      'Read episode titles and notes before asserting a lone mention: a title far from the company is a homonym the catalog mislabelled.',
      'A monitor id comes from `monitors.list()`, never from a name the user said.',
      '`insufficient_scope`: the sign-in lacks monitors:write or trackers:write; reconnecting Arcmira with monitor changes allowed lifts it.',
      'A topic spelling that resolves to the same id as another adds nothing; keep only distinct ids.',
    ],
  },
  {
    name: 'find-quotes',
    description: 'Use Arcmira to find exact quotes on YouTube, podcasts included: the line, often who said it, the date, and a timestamped link with clip start and end.',
    title: 'Find quotes and clip moments',
    summary:
      '`search` finds the passage; `transcript` with `start` and `end` returns the exact lines around it with second offsets, which give the verbatim quote and the clip boundaries.',
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
      'A chunk found with `speakerIds` can include other people\'s lines. Lines start with "Name: " when the speaker is known. Quote only the speaker\'s lines ("Chamath Palihapitiya: ..."), never the whole passage. When no line names a speaker, the passage still matched that person; say the attribution covers the passage, not each line.',
      'Caption lines are machine text: fix nothing inside the quotation marks. A premium transcript (`quality: "premium"`, paid plans) adds speaker ids into `speakers[]`.',
      'A caption read uses 4 credits per started 15 minutes of its `start`/`end` window, and of the whole episode without one. A Premium read the account does not own yet runs in `arcmira_execute_write` and uses credits for the whole video whatever the window.',
      'Some videos have no readable caption track yet (`transcript_unavailable`, `transcript_fetching`); quote the search chunk `text` for those and say the words come from the search passage.',
    ],
  },
  {
    name: 'person-research',
    description: 'Use Arcmira to research a person from what they said on YouTube: appearances, their own words with timestamps, who discusses them. For interview prep.',
    title: 'Person research',
    summary:
      'Three lenses on one person id. `momentum` gives attention and the shows that mention them most. `mentions` with `mode: "appearances"` lists the episodes they were on. `search` with `speakerIds` returns their own words; `about` returns what others said about them.',
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
  arcmira.mentions({ entityId: id, mode: "appearances", after: arcmira.daysAgo(90), limit: 40 }),
  arcmira.search({ query: "AI", speakerIds: [id], after: arcmira.daysAgo(180), limit: 5 }),
]);
const about = await arcmira.search({ query: m.entity.name, about: [id], after: arcmira.daysAgo(90), limit: 3 });
const appeared = new Map();
for (const x of rows.mentions) appeared.set(x.media.video_id, { show: x.media.source_channel?.name ?? null, episode: x.media.title, date: x.media.published_at });
let fromAppearance = null;   // no speaker-tagged chunks: read their newest appearance instead
const ep = own.chunks.length === 0 ? rows.mentions[0] : undefined;
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
  appeared_on_partial: rows.has_more || appeared.size > 8,
  appeared_on_cursor: rows.has_more ? rows.next_cursor : null,
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
      'A search with `about` returns other people talking; only `speakerIds` returns the person\'s own words. Speaker tags cover part of the index, so when the speaker search is empty, read a window of an episode they appeared on and say the lines come from their appearance, since caption lines do not name the speaker.',
      'A chunk found with `speakerIds` can include other people\'s lines. Lines start with "Name: " when the speaker is known. Quote only the person\'s lines. When no line names a speaker, say the attribution covers the passage, not each line.',
      'Put the user\'s topic in `query` for the speaker search (it needs a word or phrase of two or more characters).',
      'Mentions and momentum count the shows Arcmira indexes, not all media.',
    ],
  },
  {
    name: 'compare-shows',
    description: 'Use Arcmira to compare two YouTube channels or podcasts on YouTube: size, latest episode, topics, overlap and shared sponsors. For rival research.',
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
        title: 'Two shows, last 90 days',
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
const after = arcmira.daysAgo(90);
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
  {
    name: 'youtube-transcript-search',
    description: 'Use Arcmira to read or summarize a YouTube video from its link, or to search YouTube transcripts across channels: the exact quote and the second.',
    title: 'YouTube transcript search',
    summary:
      'Two jobs. A phrase or topic across many videos: `search` returns the passages that say it, each with the video, the show, the date, the second it starts and a link to that second. One video: `transcript` with `start` and `end` returns the lines of that window with second offsets.',
    asks: ['search YouTube transcripts for a topic or phrase across channels', 'which video said a phrase, and at what second', 'the transcript of one YouTube video, or a window of it, with timestamps'],
    ids: [
      'A topic or phrase goes in `query` as typed and needs no resolve. Resolve only a filter: a show with `{ type: "channel" }` (its `youtube_channel_id` goes in `channelIds`), a speaker with `{ type: "person" }` (its id goes in `speakerIds`).',
      'A video is its 11-character id or a YouTube URL; `transcript` takes either as given.',
    ],
    programs: [
      {
        title: 'A phrase across YouTube videos, last 90 days',
        code: `const QUERY = "AI agents";   // the user's words, as typed
const hits = await arcmira.search({ query: QUERY, after: arcmira.daysAgo(90), limit: 5 });
return {
  query: QUERY, window: hits.window, as_of: hits.as_of, index: hits.search_index?.state ?? null,
  passages: hits.chunks.map(c => ({ said: c.text.slice(0, 300), video: c.video_title, video_id: c.video_id, show: c.channel_name, date: c.published_at, second: c.start_seconds, url: c.watch_url, speakers: c.speakers })),
  ...(hits.chunks.length ? {} : { none: hits.note ?? null }),
};`,
      },
      {
        title: "One video's transcript, a window with timestamps",
        code: `const VIDEO = "https://www.youtube.com/watch?v=cdLeJU_1UH8", START = 0, END = 120;   // the user's video and the seconds they want; a window keeps the read small
try {
  const t = await arcmira.transcript(VIDEO, { start: START, end: END });
  return {
    video: { id: t.video.id, title: t.video.title, show: t.video.channel_name, date: t.video.published_at, url: t.video.watch_url },
    source: t.source, as_of: t.as_of,
    lines: t.lines.map(l => \`[\${Math.round(l.start)}s] \${l.text}\`),
  };
} catch (err) {
  return { video: VIDEO, error: err.code ?? "error", message: err.message, retry_after: err.retry_after ?? null };
}`,
      },
    ],
    good: [
      'Quotes the passage words exactly, never paraphrased inside quotation marks, with the show, the video title, the date and a link that opens at the second.',
      'Names a speaker only when the passage or a Premium transcript names one.',
      'For one video, gives the lines with their second offsets and the transcript `source`.',
      'Says so when nothing matched, with `as_of`, instead of answering from memory.',
    ],
    traps: [
      '`search` ranks by the words in `query`; put the distinctive words of the phrase there, not a paraphrase. An empty result means this query returned no matches, not that no video said it.',
      'A search uses 4 credits per passage it returns past the first 5. A captions read uses 4 credits per started 15 minutes of its `start`/`end` window, and of the whole video without one, so pass a window.',
      'A Premium read (`quality: "premium"`, paid plans) labels speakers. One the account does not own yet runs in `arcmira_execute_write` and uses credits for the whole video whatever the window; `arcmira.price(video)` returns that price first and uses no credits.',
      '`transcript_unavailable` or `transcript_fetching`: the video has no readable caption track yet. Answer from the search passage and say the words come from it.',
    ],
  },
  {
    name: 'podcast-transcript-search',
    description: 'Use Arcmira to search podcast transcripts on YouTube for a topic, guest or phrase: which episodes covered it, what was said, and a timestamped link.',
    title: 'Podcast transcript search',
    summary:
      '`search` with a show in `channelIds` finds the episodes that covered a topic, guest or phrase, with the words and a link to the second. `status({ channelId })` says how far the show\'s transcript search runs, and `episodes` lists its latest episodes, so an empty result can be told apart from a missing episode.',
    asks: ['search podcast transcripts for a topic or phrase', 'which episodes of a podcast covered a topic or had a guest', 'find the moment in a podcast episode, with a timestamped link'],
    ids: [
      'A show resolves with `{ type: "channel" }`; its id is `youtube_channel_id` (a UC id). Users shorten show names ("All In"); say when the show was assumed.',
      'A guest resolves with `{ type: "person" }`. Their id in `entityIds` limits results to episodes they appear in; in `speakerIds` it returns their own lines.',
      'Across every podcast: drop the pick, `channelIds`, and the `status` and `episodes` calls.',
    ],
    programs: [
      {
        title: 'A topic on one podcast, last 90 days',
        code: `${pick('All-In Podcast', 'channel')}
const QUERY = "tariffs";   // the topic, guest name or phrase, as the user typed it
const [hits, s, latest] = await Promise.all([
  arcmira.search({ query: QUERY, channelIds: [id], after: arcmira.daysAgo(90), limit: 5 }),
  arcmira.status({ channelId: id }),
  arcmira.episodes(id, { limit: 3 }),
]);
const episodes = new Map();
for (const c of hits.chunks) {
  const ep = episodes.get(c.video_id) ?? { episode: c.video_title, date: c.published_at, moments: [] };
  ep.moments.push({ second: c.start_seconds, said: c.text.slice(0, 300), url: c.watch_url });
  episodes.set(c.video_id, ep);
}
return {
  show: { name: e?.name ?? null, channel_id: id, assumed, why },
  window: hits.window, as_of: hits.as_of, search_indexed_through: s.channel.search_indexed_through,
  latest_episodes: latest.episodes.map(x => ({ title: x.title, date: x.published_at })),
  episodes: [...episodes.values()],
  ...(hits.chunks.length ? {} : { none: hits.note ?? null }),
};`,
      },
    ],
    good: [
      'Names the show with its channel id, and says when it was assumed.',
      'Lists the episodes that covered it, each with the date, the words said and a link that opens at the second.',
      'Gives `search_indexed_through` for the show and the window it searched.',
      'Says so when nothing matched, and that an empty result is not proof the show never said it.',
    ],
    traps: [
      'An empty result means this query returned no matches. Check `search_indexed_through` and the latest episodes before saying the show never covered it; the newest episode may not be in transcript search yet.',
      'A guest name in `query` matches only where the name is spoken. Resolve the guest and pass the id for the episodes they appear in.',
      'Never count passages to say how many episodes covered a name; `occurrences` with the show and the entity id counts episodes.',
      'A passage is not a clip: `start_seconds` is where it starts. `find-quotes` and `youtube-clip-finder` read the transcript lines for a start and an end.',
    ],
  },
  {
    name: 'brand-mention-monitoring',
    description: 'Use Arcmira to monitor brand mentions on YouTube: how often a company or product comes up, which shows discuss it, whether it\'s rising, quotes and alerts.',
    title: 'Brand mention monitoring',
    summary:
      'Measures a brand against the competitors the user names, in one program: `momentum` gives the verdict and the 7-day and 30-day mention counts, `occurrences` the shows that mention each brand most, and `search` quotes about the user\'s brand. Alerts by email or Slack are a monitor, which `company-watch` saves.',
    asks: [
      'how often a brand or product is mentioned on YouTube, podcasts included, and on which shows',
      'is talk about our brand rising or fading, against competitors',
      'brand mentions, media monitoring or competitor monitoring across shows',
      'alerts when a brand is mentioned, by email or Slack',
    ],
    ids: [
      'Resolve each brand with no type (the catalog types some companies as product). A brand name is often a common word ("Linear", "Ramp"): name each pick, for example "Linear, the software company", so the user can catch a wrong one.',
      'Put the user\'s brand first in `BRANDS`, then each competitor they named.',
    ],
    steps: [
      'Run the program and answer with one row per brand.',
      'Before reporting a count, read the quotes and the top shows and say which sense of the name it is (Mercury the bank, not the planet). Drop a sense the user did not mean.',
      'For alerts, load `company-watch` and run its second and third programs with the ids this program found.',
    ],
    programs: [
      {
        title: 'A brand against its competitors, 7 and 30 days',
        code: `const BRANDS = ["Anthropic", "OpenAI"], IDS = [null, null];   // the user's brand first, then competitors. After an ask, put the picked option's id in IDS and run again
const brands = [];
for (const [i, n] of BRANDS.entries()) {
  const r = IDS[i] ? null : await arcmira.resolve(n);   // no type: a company may be typed product
  const e = r && (r.best ?? r.suggested);
  if (r && !e) return { unresolved: n, ask: r.ask };
  const id = IDS[i] ?? e.id;
  const [m, occ] = await Promise.all([arcmira.momentum(id), arcmira.occurrences({ entityIds: [id], after: arcmira.daysAgo(30), limit: 5 })]);
  brands.push({
    name: m.entity.name, id, type: m.entity.type, page: m.entity.page, assumed: Boolean(r?.suggested), why: r?.suggested?.evidence ?? null,
    verdict: m.verdict, last_7d: m.volume.mentions_7d, last_30d: m.volume.mentions_30d, prior_30d: m.volume.mentions_prior_30d, as_of: m.as_of,
    top_shows: occ.rows.map(x => ({ show: x.channel_name, channel_id: x.channel_id, episodes: x.count })),
  });
}
const lead = brands[0];
let quotes = await arcmira.search({ query: lead.name, about: [lead.id], after: arcmira.daysAgo(30), limit: 3 });
const quotesTagged = quotes.chunks.length > 0;   // false: the fallback matched the words, which can be a namesake; say so
if (!quotesTagged) quotes = await arcmira.search({ query: lead.name, after: arcmira.daysAgo(30), limit: 3 });
return {
  brands, quotes_about: lead.name, quotes_tagged_to_brand: quotesTagged,
  quotes: quotes.chunks.map(c => ({ said: c.text.slice(0, 300), show: c.channel_name, episode: c.video_title, date: c.published_at, url: c.watch_url })),
};`,
      },
    ],
    good: [
      'Names each brand with its type and id, and any it assumed or set aside as a namesake.',
      'One row per brand: the verdict, the 7-day, 30-day and prior 30-day counts, `as_of`, and the shows that mention it most with episode counts.',
      'Two or three quotes about the user\'s brand in the speakers\' words, each with show, date and `watch_url`, and says when they matched the words rather than the brand.',
      'For alerts, confirms what to follow and how it arrives before `company-watch` saves the monitor.',
    ],
    traps: [
      'Counts measure the shows Arcmira indexes, not the internet. Cite `as_of` before saying a brand was not mentioned.',
      'Each `momentum` call uses 10 credits at any window: one per brand.',
      'A mention is not an ad read. Whether a mention was paid is `sponsor-research`: `recommendations` with `kind: "sponsored"` is a Pro+ read and can return `recommendations_not_enabled`. Explain the account-access limit and the required tier and link the API reports in `unlock`; never label a mention paid or organic without that read.',
      'Read the quotes before asserting a lone mention: a show far from the brand is a namesake the catalog mislabelled.',
    ],
  },
  {
    name: 'what-did-they-say',
    description: 'Use Arcmira when asked what someone said about something: a person\'s or company\'s own words from YouTube, with the show, the date and a timestamped link.',
    title: 'What did they say',
    summary:
      'Answers "what did they say about it" from the transcripts. `search` with the speaker\'s id in `speakerIds` returns passages where they speak the topic words. When that is empty, `about` with the same id returns what others said about them, kept apart. A company speaks through its people or its own show.',
    asks: ['what did a person say about a topic, in their own words', 'what did a company or its CEO say on a podcast or YouTube', 'who said a line, and where'],
    ids: [
      'A person resolves with `{ type: "person" }`; pass what the user said about them as `context`.',
      'A company speaks through its people or its own show. Resolve the executive with `{ type: "person" }`, or the company\'s show with `{ type: "channel" }` and pass its `youtube_channel_id` in `channelIds`.',
      'The topic words go in `query`, never in `about`.',
      'For "who said this line", search the line with no speaker filter and read `speakers` on each passage.',
    ],
    programs: [
      {
        title: 'What one person said about a topic, last 90 days',
        code: `${pick('Jensen Huang', 'person')}
const TOPIC = "export controls";   // the topic in the user's words
const after = arcmira.daysAgo(90);
const own = await arcmira.search({ query: TOPIC, speakerIds: [id], after, limit: 5 });
const about = own.chunks.length ? null : await arcmira.search({ query: TOPIC, about: [id], after, limit: 3 });
const name = e?.name ?? null;
const said = own.chunks.map(c => {
  const mine = name ? c.text.split("\\n").filter(l => l.startsWith(name + ": ")) : [];
  return { lines: mine.length ? mine : [c.text.slice(0, 300)], speaker_named_on_lines: mine.length > 0, show: c.channel_name, episode: c.video_title, date: c.published_at, url: c.watch_url };
});
return {
  speaker: { id, name, assumed, why }, topic: TOPIC, window: own.window, as_of: own.as_of,
  in_their_words: said,
  ...(said.length ? {} : { note: own.note ?? null, said_about_them: (about?.chunks ?? []).map(c => ({ said: c.text.slice(0, 300), show: c.channel_name, date: c.published_at, url: c.watch_url })) }),
};`,
      },
    ],
    good: [
      'Names the person it searched, with the id, and any namesake it set aside.',
      'Quotes only the person\'s own lines, exactly as the transcript gives them, never paraphrased inside quotation marks, each with show, episode, date and `watch_url`.',
      'When no line names a speaker, says the attribution covers the passage, not each line.',
      'Keeps what others said about them apart from their own words, and says so when nothing matched, with `as_of`.',
    ],
    traps: [
      'Speaker labels cover part of the index. An empty `speakerIds` search is not proof they never said it: read `note`, and give what others said about them as that, not as their words.',
      'A chunk found with `speakerIds` can include other people\'s lines. Lines start with "Name: " when the speaker is known.',
      '`search` needs a topic of two or more characters in `query`.',
      'For the start and end of the moment, `find-quotes` and `youtube-clip-finder` read the transcript lines around the passage.',
    ],
  },
  {
    name: 'youtube-clip-finder',
    description: 'Use Arcmira to find the clip: search YouTube transcripts for a moment, get a watch link at the second, start and end seconds, and an embed that starts there.',
    title: 'Find a YouTube clip',
    summary:
      '`search` finds the passage. `transcript` with `start` and `end` returns the lines around it with second offsets, which give the cut points. The program returns a YouTube link that opens at the start, the start and end seconds, and an embed that plays that span.',
    asks: [
      'find the clip where someone says a thing, with start and end seconds',
      'a link that opens the video at that second, or an embed of the moment',
      'cut points for a video editor or an edit decision list',
      'a quote with its moment, to cite or to review before cutting',
    ],
    ids: [
      'A speaker resolves with `{ type: "person" }`; pass the id as `speakerIds`. A show goes in `channelIds` as its UC id.',
      'A clip with no speaker: drop the pick and `speakerIds`, and search the phrase alone.',
      'The phrase goes in `query` with its distinctive words, never in `about`.',
    ],
    steps: [
      'Run the program. It reads 10 seconds before the passage and 50 after. Pick the lines that hold the moment and trim `start` and `end` to them, then use those seconds in the link and the embed.',
      'Lead with `youtube_url`, the start and end seconds, and `embed`.',
      `When the user wants the video file, say this line first, word for word: "${CLIP_RIGHTS}" Then give that clip's \`download.command\`, with the trimmed seconds. Run it only when the user asks you to; otherwise print it.`,
      'Never add browser cookies or a login to the command, and never work around an age, region, membership or private restriction. When yt-dlp says the video needs a sign-in, stop and tell the user.',
      'If yt-dlp is missing, link its install page: https://github.com/yt-dlp/yt-dlp#installation.',
    ],
    programs: [
      {
        title: 'The clip where one person says a phrase',
        code: `${pick('Chamath', 'person')}
const PHRASE = "Anthropic IPO";   // the distinctive words of the moment
const RIGHTS = ${JSON.stringify(CLIP_RIGHTS)};
const hits = await arcmira.search({ query: PHRASE, speakerIds: [id], limit: 5 });
const clips = [];
for (const c of hits.chunks.slice(0, 2)) {
  const clip = { episode: c.video_title, show: c.channel_name, date: c.published_at, video_id: c.video_id, passage_url: c.watch_url };
  try {
    const t = await arcmira.transcript(c.video_id, { start: Math.max(0, c.start_seconds - 10), end: c.start_seconds + 50 });
    clip.start = Math.floor(t.lines[0]?.start ?? c.start_seconds);
    clip.end = Math.ceil(t.lines.at(-1)?.end ?? c.start_seconds + 60);
    clip.lines = t.lines.map(l => ({ start: Math.floor(l.start), end: Math.ceil(l.end), text: l.text }));
  } catch (err) {
    clip.start = Math.floor(c.start_seconds);
    clip.end = clip.start + 60;
    clip.approximate = true;
    clip.passage = c.text;
    clip.transcript = err.code ?? "error";
  }
  clip.youtube_url = \`https://www.youtube.com/watch?v=\${c.video_id}&t=\${clip.start}\`;
  clip.embed = \`https://www.youtube.com/embed/\${c.video_id}?start=\${clip.start}&end=\${clip.end}\`;
  clip.download = { say_first: RIGHTS, command: \`yt-dlp --download-sections "*\${clip.start}-\${clip.end}" --force-keyframes-at-cuts -o "clip.%(ext)s" "https://www.youtube.com/watch?v=\${c.video_id}"\` };
  clips.push(clip);
}
return { speaker: { id, name: e?.name ?? null, assumed, why }, as_of: hits.as_of, ...(clips.length ? { clips } : { none: hits.note ?? null }) };`,
      },
    ],
    good: [
      'Names the speaker or show it searched, with the id, and the episode title and date.',
      'Gives `start` and `end` in whole seconds, trimmed to the moment, and says they come from caption lines, which are machine text.',
      'Links `youtube_url` and `embed` with those seconds, and quotes only the speaker\'s lines.',
      'Gives the download command only when the user wants the file, and always after the rights line.',
      'Says so when nothing matched, with `as_of`.',
    ],
    traps: [
      'Caption timing can drift by a second or two, and the player seeks to the nearest keyframe, so a clip can start a moment early. Tell the user to check the cut on the first play.',
      'The embed `end` counts from the start of the video, not from `start`.',
      'A caption read uses 4 credits per started 15 minutes of its window. Keep the window short.',
      'Some videos have no caption track yet (`transcript_unavailable`, `transcript_fetching`): the program marks the clip `approximate`, from the passage start plus 60 seconds. Say so, and say the words come from the search passage.',
      '`passage_url` opens the passage on arcmira.com and can start before the moment; label it as the passage, not the cut.',
      'A chunk found with `speakerIds` can include other people\'s lines. Lines start with "Name: " when the speaker is known.',
    ],
  },
];
