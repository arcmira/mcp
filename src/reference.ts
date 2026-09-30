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

export const ID_RULE = `ID RULE. Filters take verbatim ids only: entity ids look like ent_14, channel ids like UC-DRzaGnL_vtBUpCFH5M0tg (UC plus 22 characters), video ids are 11 characters or a YouTube URL. A name where an id belongs throws id_required before any network call. Resolve first, verify, then query:
  const r = await arcmira.resolve("Ramp");   // r.confidence: exact | single_fuzzy | ambiguous | fuzzy | none
  // r.best is set only for an unambiguous match; check r.best.type and r.best.name against what the user meant.
  // If r.best is null, pick from r.candidates by type and name, or return the options.
  const id = r.best.id;                      // for a show: resolve with { type: "channel" } and use best.youtube_channel_id
Resolve the exact name the user said ("ICE", "Mercury"), not a paraphrase; use what they meant only to check the type and name. Omit type for a brand (the catalog types some companies as product). When two candidates fit the same meaning (the catalog holds duplicates), query both and say which ids you used, or take the one with the higher appearance_count.`;

export interface MethodDoc {
  name: string;
  signature: string;
  returns: string;
  notes: string[];
}

export const METHODS: readonly MethodDoc[] = [
  {
    name: 'resolve',
    signature: 'arcmira.resolve(q, { type?, limit? })',
    returns: '{ query, confidence, best, candidates[{id, name, type, appearance_count, youtube_channel_id, page}], note }',
    notes: ['q is a name, @handle, YouTube URL or UC id. type: person | organization | product | topic | channel; pass it only for a person or a show. limit 1..15.'],
  },
  {
    name: 'search',
    signature: 'arcmira.search({ query, channelIds?, about?, speakerIds?, kind?, after?, before?, source?, limit? })',
    returns: '{ chunks[{text, videoId, videoTitle, publishedAt, startSeconds, watchUrl, channelId, channelName, about[], speakers_by[]}], as_of }',
    notes: [
      'Spoken passages that match the words in query (a topic, a phrase). channelIds: up to 8 UC ids. about: up to 8 ent_ ids of a brand or person the passage is about; speakerIds: up to 8 person ids who said it; kind: mention | recommendation_sponsored | recommendation_organic. Never put a topic word in about; it goes in query. If a search with about, speakerIds or kind returns no chunks, rerun it with query and channelIds only before saying nothing was found. limit 1..20 (default 5). source: arcmira_premium | creator_captions | third_party_quick.',
    ],
  },
  {
    name: 'mentions',
    signature: 'arcmira.mentions({ entityId, channelId?, after?, before?, limit?, cursor? })',
    returns: '{ entity{id, name, page}, data[{media{video_id, title, published_at, channel_id, source_channel{name}}, start_seconds}], has_more, next_cursor }',
    notes: ['When and where a name came up: one row per catalog mention, newest first, several rows per episode, limit 1..100. Never count rows to answer how many episodes: occurrences gives count per window. Rows carry no wording; for a quote use search. Read the episode title before asserting a lone row: a title far from the entity (a jungle episode for a bank) is a homonym the catalog mislabelled.'],
  },
  {
    name: 'momentum',
    signature: 'arcmira.momentum(entityId)',
    returns: '{ entity, verdict (accelerating | flat | fading | none), as_of, volume{mentions_30d, mentions_prior_30d, mentions_90d, total}, top_shows[{channel_id, channel_name, mentions}] }',
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
    returns: '{ entity, data[{mention_class (ad_read = sponsored, endorsement = organic), verbatim_quote, promo_code, media{video_id, title, published_at, source_channel{name}}, start_seconds}], has_more }',
    notes: ['Who recommends one entity on air. kind: sponsored | organic | all (default all), limit 1..50. Pro plan; a free key gets recommendations_not_enabled with its unlock link.'],
  },
  {
    name: 'episodes',
    signature: 'arcmira.episodes(channelId, { limit?, after?, before? })',
    returns: '{ episodes[{video_id, title, published_at, duration_seconds, view_count, watch_url}], indexed_through, index_age_days }',
    notes: ['Newest indexed episodes of one show, limit 1..25; episodes[0] is the latest. Never count episodes to size a show: status({ channelId }).channel.searchable_videos is the count.'],
  },
  {
    name: 'transcript',
    signature: 'arcmira.transcript(videoIdOrUrl, { quality?, language?, timestamps?, start?, end? })',
    returns: '{ video{id, title, channel_name, published_at, watch_url}, lines[{start, end, text, speaker?}], speakers[{id, name}], quality, source, language, as_of }',
    notes: ['quality: captions (default) | premium (diarized: each line carries speaker, an id into speakers[], where name is the person or a label like Speaker 1; paid plans). start/end in seconds bill only that window: pass them for "the first minute".'],
  },
  {
    name: 'occurrences',
    signature: 'arcmira.occurrences({ channelIds?, entityIds?, videoIds?, types?, mode?, after?, before?, limit? })',
    returns: '{ rows[{entity_id, name, type, channel_id, channel_name, count (episodes), occurrences (times said)}], shared[{entity_id, name, type, by_channel[{channel_id, channel_name, count}]}], as_of }',
    notes: [
      'Ranked catalog counts per entity per channel: what a show talks about, how many episodes mentioned an entity in a window, what one episode mentions (videoIds). Needs channelIds (up to 8), entityIds (up to 20) or videoIds (up to 20). types: person | organization | product | topic | channel. With two or more channelIds read shared, not rows, for what both shows mention.',
    ],
  },
  {
    name: 'status',
    signature: 'arcmira.status({ channelId? | jobId? })',
    returns: '{ channel{youtube_channel_id, searchable_videos, indexed_through, search_indexed_through} } for a show; a transcription job for jobId; the key and plan with no argument',
    notes: ['searchable_videos is how many videos of a show are indexed; indexed_through is the as-of date to cite when nothing was found.'],
  },
];

export const EXAMPLES: ReadonlyArray<{ title: string; code: string }> = [
  {
    title: 'One search, compact result',
    code: `const hits = await arcmira.search({ query: "stablecoins", channelIds: ["UC-DRzaGnL_vtBUpCFH5M0tg"], after: arcmira.daysAgo(90), limit: 3 });
return hits.chunks.map(c => ({ said: c.text, video: c.videoTitle, date: c.publishedAt, url: c.watchUrl }));`,
  },
  {
    title: 'Resolve, verify, then filter',
    code: `const r = await arcmira.resolve("Linear");
if (!r.best) return { options: r.candidates };   // let the user pick
const m = await arcmira.momentum(r.best.id);
return { entity: r.best.name, id: r.best.id, verdict: m.verdict, last30: m.volume.mentions_30d, prior30: m.volume.mentions_prior_30d, as_of: m.as_of };`,
  },
  {
    title: 'A show by name: its id, size, and what its latest episode mentions',
    code: `const show = await arcmira.resolve("All-In Podcast", { type: "channel" });
const ch = show.best?.youtube_channel_id;
if (!ch) return { options: show.candidates };
const [s, ep] = await Promise.all([arcmira.status({ channelId: ch }), arcmira.episodes(ch, { limit: 1 })]);
const what = await arcmira.occurrences({ videoIds: [ep.episodes[0].video_id], types: ["organization"], limit: 5 });
return { channel_id: ch, videos_indexed: s.channel.searchable_videos, indexed_through: s.channel.indexed_through, latest: ep.episodes[0].title, mentions: what.rows.map(r => [r.name, r.entity_id, r.occurrences]) };`,
  },
  {
    title: 'What two shows both talk about (shared, not rows)',
    code: `const o = await arcmira.occurrences({ channelIds: ["UC-DRzaGnL_vtBUpCFH5M0tg", "UCESLZhusAkFfsNsApnjF_Cg"], types: ["organization", "product"], limit: 40 });
return o.shared.slice(0, 5).map(s => ({ name: s.name, id: s.entity_id, episodes_by_show: s.by_channel.map(c => [c.channel_name, c.count]) }));`,
  },
  {
    title: 'Sponsors two shows share',
    code: `const [a, b] = await Promise.all([arcmira.sponsors("UC-DRzaGnL_vtBUpCFH5M0tg"), arcmira.sponsors("UCESLZhusAkFfsNsApnjF_Cg")]);
const inB = new Map(b.sponsors.map(s => [s.entity.id, s.ad_reads]));
return a.sponsors.filter(s => inB.has(s.entity.id)).map(s => ({ name: s.entity.name, id: s.entity.id, ad_reads: [s.ad_reads, inB.get(s.entity.id)] }));`,
  },
  {
    title: 'Who speaks in the first minute (Premium)',
    code: `const ep = await arcmira.episodes("UC-DRzaGnL_vtBUpCFH5M0tg", { limit: 1 });
const t = await arcmira.transcript(ep.episodes[0].video_id, { quality: "premium", start: 0, end: 60 });
const name = new Map((t.speakers ?? []).map(s => [s.id, s.name]));
return { video: ep.episodes[0].title, speakers: (t.speakers ?? []).map(s => s.name), opening: t.lines.slice(0, 8).map(l => \`[\${l.start}] \${name.get(l.speaker) ?? "?"}: \${l.text}\`) };`,
  },
  {
    title: 'A month window (after and before are both counted); return the window so the answer states it',
    code: `const p = await arcmira.resolve("Cursor");
if (!p.best) return { options: p.candidates };
const window = { after: "2026-08-01", before: "2026-08-31" };
const o = await arcmira.occurrences({ channelIds: ["UC-DRzaGnL_vtBUpCFH5M0tg"], entityIds: [p.best.id], ...window });
const row = o.rows[0];
return { entity: p.best.name, id: p.best.id, window, episodes: row?.count ?? 0, times: row?.occurrences ?? 0, as_of: o.as_of };`,
  },
  {
    title: 'Rank brands by 30-day mentions',
    code: `const out = [];
for (const n of ["Anthropic", "OpenAI", "Cursor"]) {
  const r = await arcmira.resolve(n);   // no type: a company may be typed product
  if (!r.best) { out.push({ name: n, unresolved: r.candidates.map(c => [c.id, c.name, c.type]) }); continue; }
  const m = await arcmira.momentum(r.best.id);
  out.push({ name: r.best.name, id: r.best.id, last30: m.volume.mentions_30d });
}
return out.sort((a, b) => (b.last30 ?? -1) - (a.last30 ?? -1));`,
  },
];

export const QUIRKS = [
  'Dates: arcmira.today() and arcmira.daysAgo(n) give ISO dates from the server clock; never guess today. after and before are both counted (August is after 2026-08-01, before 2026-08-31), in UTC. The index is not live: cite indexed_through or as_of before saying nothing happened recently.',
  'Momentum, mentions and counts measure the shows Arcmira indexes, not the internet; say so when it matters. An empty result means the index has no match: never fill it from memory or the web.',
  'Every plan gate throws with .code and .unlock.url, the page that lifts it. Relay the link.',
  'Results carry names beside ids and arcmira.com page links; link names to those pages and never invent an arcmira.com URL.',
];

export const MAX_CALLS = 40;

export const ERRORS = `Errors throw ArcmiraError with .code and, for gates, .unlock { tier, url }: id_required (a name where an id belongs; call arcmira.resolve first), invalid_video, too_many (over an id cap), entity_not_found, filter_requires_paid, recommendations_not_enabled, quota_exceeded, rate_limited (.retry_after_seconds), call_budget (over ${MAX_CALLS} API calls in one program). See ${DOCS.errors}.`;

const ROUTING =
  'WHICH METHOD. A quote or what was said about a topic: search. Whether and when a name came up: mentions. How hot something is: momentum. What a show talks about, what two shows share, what one episode mentions, how many episodes mentioned X in a window: occurrences. Who sponsors a show: sponsors. Who recommends a brand: recommendations. The latest episode: episodes(channelId, { limit: 1 }). How many videos a show has indexed and its as-of date: status({ channelId }). One video\'s words: transcript.';

function methodText(m: MethodDoc): string {
  return [`${m.signature}   -> ${m.returns}`, ...m.notes.map((n) => `   ${n}`)].join('\n');
}

/** The whole reference, or every signature plus the notes and examples that name one topic (the id rule and routing table stay). */
export function referenceText(topic?: string): string {
  const wanted = topic?.trim().toLowerCase();
  const hit = (text: string): boolean => !wanted || text.toLowerCase().includes(wanted);
  const methodHits = METHODS.filter((m) => hit(`${m.name} ${m.signature}`));
  const methods = METHODS.map((m) => (methodHits.length === 0 || methodHits.includes(m) ? methodText(m) : `${m.signature}   -> ${m.returns}`));
  const exampleHits = EXAMPLES.filter((e) => hit(`${e.title} ${e.code}`));
  const examples = exampleHits.length > 0 ? exampleHits : EXAMPLES;
  return [
    'arcmira client (JavaScript). Every method is async and returns parsed JSON. Your program is the body of an async function with arcmira and ArcmiraError in scope: use await, console.log for progress, and return one compact value with only the fields the answer needs.',
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
    `DOCS. API reference ${DOCS.api}, MCP guide ${DOCS.mcp}, error codes ${DOCS.errors}, OpenAPI ${DOCS.openapi}, agent index ${DOCS.llms}.`,
  ].join('\n');
}

export const SHORT_GUIDE = [
  'Arcmira is the search engine for the spoken web: indexed YouTube and podcast transcripts with a catalog of who is mentioned where, who sponsors whom, and who recommends what on air.',
  'Two tools. describe returns the arcmira client reference (methods, worked example programs, quirks, doc links): call it once before your first execute. execute runs JavaScript you write against that client and returns what you print or return.',
  'Write one program per question: resolve every name it carries (arcmira.resolve), check each .best against what the user meant, run every query the question needs, and return only the fields the answer needs. Filters take ids only (ent_..., UC..., 11-character video ids); a name where an id belongs throws id_required.',
  'Use arcmira.today() and arcmira.daysAgo(n) for date windows. Momentum, mentions and counts measure the shows Arcmira indexes, not the internet. Every gate throws with .unlock.url; relay that link and never fill a gap from the open web.',
  'Connect with no key and the host signs you in through OAuth, or send Authorization: Bearer <key>. With no account, POST https://api.arcmira.com/v1/signups?src=mcp-tool with {"email"} and then /v1/signups/verify with the code.',
  `Good first ids: TBPN is channel UC-DRzaGnL_vtBUpCFH5M0tg, All-In Podcast is UCESLZhusAkFfsNsApnjF_Cg, Ramp is ent_14. Docs: ${DOCS.mcp} and ${DOCS.llms}.`,
].join(' ');
