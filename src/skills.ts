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

export interface TaskSkill {
  name: string;
  /** Always-on text in every host's skill listing: keep it under 160 characters. */
  description: string;
  title: string;
  summary: string;
  asks: string[];
  /** Task-specific resolution notes; PICK_STEPS (the same for every skill) comes first. */
  ids: string[];
  programs: ReadonlyArray<{ title: string; code: string }>;
  good: string[];
  traps: string[];
}

/** How every task skill turns a name into the one entity the user meant. */
export const PICK_STEPS = [
  'Resolve the exact name the user said, and pass their own words about it as `context` when they gave any ("Sam, the My First Million co-host" is `resolve("Sam", { context: "the My First Million co-host" })`).',
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
  return `const NAME = "${name}", CONTEXT = undefined, ID = null;   // CONTEXT: the user's own words about the name. After an ask, set ID to the picked option's ${channel ? 'channel_id' : 'id'} and run again
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
let cursor, entity;
do {
  const page = await arcmira.recommendations(id, { kind: "sponsored", after, limit: 50, cursor });
  entity = page.entity;
  reads.push(...page.data);
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
  brand: { id, name: entity?.name ?? e?.name ?? null, type: entity?.type ?? e?.type ?? null, assumed, why }, window: { after, through: arcmira.today() }, ad_reads_total: reads.length,
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
      '`recommendations` is a paid method: a free key throws `recommendations_not_enabled` with `.unlock.url`. Relay the link and answer the show direction with `sponsors`.',
      'An ad read is sponsored; an unpaid on-air endorsement is `kind: "organic"`. Do not mix them in one count.',
      'Page with `cursor` until `has_more` is false before you count reads; one page is at most 50 rows.',
    ],
  },
  {
    name: 'company-watch',
    description: 'Tracks what podcasts and YouTube shows said about a company or product this week: which shows, how often, momentum, and quotes with links. Uses arcmira.',
    title: 'Company watch',
    summary:
      'One program answers "what was said about X this week": episode counts per show from `occurrences`, the trend from `momentum`, the catalog notes on each mention from `mentions`, and quotes from `search` filtered to passages about the entity.',
    asks: ['what is being said about a company, product or brand this week or this month', 'did any show mention us, a competitor or an investor lately', 'is talk about a company rising or fading, and where'],
    ids: [
      'Resolve with no type: the catalog types some companies as product.',
      'A company name is often a common word ("Linear", "Ramp", "ICE"). State which one the answer covers, for example "Linear, the software company (product, ent_279443)", so the user can catch a wrong pick.',
    ],
    programs: [
      {
        title: 'The last seven days about one company',
        code: `${pick('Linear')}
const after = arcmira.daysAgo(7);
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
  window: { after, through: arcmira.today() },
  momentum: { verdict: m.verdict, last_7d: m.volume.mentions_7d, last_30d: m.volume.mentions_30d, prior_30d: m.volume.mentions_prior_30d, as_of: m.as_of },
  shows: occ.rows.map(x => ({ show: x.channel_name, channel_id: x.channel_id, episodes: x.count, times_said: x.occurrences })),
  context: notes.data.map(x => ({ show: x.media.source_channel?.name ?? null, episode: x.media.title, date: x.media.published_at, note: x.description })),
  quotes_tagged_to_entity: quotesTagged,
  quotes: quotes.chunks.map(c => ({ said: c.text.slice(0, 300), show: c.channelName, episode: c.videoTitle, date: c.publishedAt, url: c.watchUrl })),
};`,
      },
    ],
    good: [
      'Opens with the entity it covers (name, type, id).',
      'Gives the verdict (accelerating, flat or fading) and the 7-day and 30-day counts, with `as_of`.',
      'Lists the shows with episode counts for the window, and states the window.',
      'Gives two or three quotes in the speakers\' words, each with show, date and the `watchUrl` link, and says what the talk was about without adding facts the results do not carry.',
    ],
    traps: [
      'Counts measure the shows Arcmira indexes, not the internet. An empty week means no indexed show said it; cite `as_of` before saying nothing happened.',
      'Read episode titles and notes before asserting a lone mention: a title far from the company is a homonym the catalog mislabelled.',
      'Count episodes with `occurrences`, never by counting `mentions` rows (one episode has several rows).',
    ],
  },
  {
    name: 'find-quotes',
    description: 'Finds exact spoken quotes and clip-ready moments on podcasts and YouTube: verbatim words, speaker, date, a timestamped link, clip start and end. Uses arcmira.',
    title: 'Find quotes and clip moments',
    summary:
      '`search` finds the passage; `transcript` with `start` and `end` returns the exact lines around it with second offsets, which give the verbatim quote and the clip boundaries. Only that window is billed.',
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
  const moment = { episode: c.videoTitle, show: c.channelName, date: c.publishedAt, url: c.watchUrl, speakers: c.speakers_by.map(s => s.name) };
  try {
    const t = await arcmira.transcript(c.videoId, { start: Math.max(0, c.startSeconds - 10), end: c.startSeconds + 50 });
    moment.clip = { start: t.lines[0]?.start ?? c.startSeconds, end: t.lines.at(-1)?.end ?? c.startSeconds + 60 };
    moment.lines = t.lines.map(l => \`[\${Math.round(l.start)}s] \${l.text}\`);
  } catch (err) {
    moment.clip = { start: c.startSeconds, end: c.startSeconds + 60 };
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
      'Links the `watchUrl`, which starts at the moment, and gives a clip start and end in seconds from the transcript lines.',
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
for (const x of rows.data) if (x.is_appearance) appeared.set(x.media.video_id, { show: x.media.source_channel?.name ?? null, episode: x.media.title, date: x.media.published_at });
let fromAppearance = null;   // no speaker-tagged chunks: read their newest appearance instead
const ep = own.chunks.length === 0 ? rows.data.find(x => x.is_appearance) : undefined;
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
  in_their_words: own.chunks.map(c => ({ said: c.text.slice(0, 300), episode: c.videoTitle, show: c.channelName, date: c.publishedAt, url: c.watchUrl })),
  from_their_appearance: fromAppearance,
  said_about_them: about.chunks.map(c => ({ said: c.text.slice(0, 200), show: c.channelName, date: c.publishedAt, url: c.watchUrl })),
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
  window: { after, through: arcmira.today() },
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
