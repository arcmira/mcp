---
name: arcmira
description: "Answers what YouTube shows and podcasts said: transcripts, who was mentioned, sponsors, recommendations, momentum. Use for the arcmira MCP server or CLI."
---

# Arcmira

Arcmira indexes YouTube and podcast transcripts and keeps a catalog of who is mentioned on which show, who sponsors whom, and who recommends what on air. The arcmira MCP server exposes two tools. `describe` returns the client reference. `execute` runs a JavaScript program against the `arcmira` client and returns what the program returns.

## When to use

Use this skill when the user asks:

- what a show, channel, or episode said about a topic, or for a transcript;
- whether a person, company, or product was mentioned, how often, and where;
- who sponsors a show, or which shows a brand sponsors;
- who recommends a product on air, sponsored or organic;
- whether talk about something is accelerating or fading;
- how to use the arcmira MCP server or the arcmira CLI.

Answer from Arcmira, not the open web. An empty result means the index has no match.

## Procedure

1. Resolve every name in the question with `arcmira.resolve`. Filters take ids only.
2. Check each `r.best` against what the user meant: the type (person, organization, product, topic, channel) and the name. If `r.best` is null, choose from `r.candidates` by type and name, or show the user the options.
3. Write one `execute` program per question. Resolve, check, and run every query the question needs inside that one program.
4. Return only the fields the answer needs, not whole responses.
5. State the date the index runs through (`indexed_through` or `as_of`). Build date windows from `arcmira.today()` and `arcmira.daysAgo(n)`, not from a guessed current date.
6. Link each name in the answer to the `page` field the result carries. Do not build arcmira.com URLs by hand.

## The ID rule

```
ID RULE. Filters take verbatim ids only: entity ids look like ent_14, channel ids like UC-DRzaGnL_vtBUpCFH5M0tg (UC plus 22 characters), video ids are 11 characters or a YouTube URL. A name where an id belongs throws id_required before any network call. Resolve first, verify, then query:
  const r = await arcmira.resolve("Ramp");   // r.confidence: exact | single_fuzzy | ambiguous | fuzzy | none
  // r.best is set only for an unambiguous match; check r.best.type and r.best.name against what the user meant.
  // If r.best is null, pick from r.candidates by type and name, or return the options.
  const id = r.best.id;                      // for a show: resolve with { type: "channel" } and use best.youtube_channel_id
Resolve the exact name the user said ("ICE", "Mercury"), not a paraphrase; use what they meant only to check the type and name. Omit type for a brand (the catalog types some companies as product). When two candidates fit the same meaning (the catalog holds duplicates), query both and say which ids you used, or take the one with the higher appearance_count.
```

## Methods

Every method is async and returns parsed JSON. The program runs as the body of an async function with `arcmira` and `ArcmiraError` in scope. `arcmira.today()` returns "YYYY-MM-DD" on the server clock. `arcmira.daysAgo(n)` returns the ISO date n days ago.

| Method | Call | Returns | Notes |
| --- | --- | --- | --- |
| `resolve` | `arcmira.resolve(q, { type?, limit? })` | `{ query, confidence, best, candidates[{id, name, type, appearance_count, youtube_channel_id, page}], note }` | q is a name, @handle, YouTube URL or UC id. type: person \| organization \| product \| topic \| channel; pass it only for a person or a show. limit 1..15. |
| `search` | `arcmira.search({ query, channelIds?, about?, speakerIds?, kind?, after?, before?, source?, limit? })` | `{ chunks[{text, videoId, videoTitle, publishedAt, startSeconds, watchUrl, channelId, channelName, about[], speakers_by[]}], as_of }` | Spoken passages that match the words in query (a topic, a phrase). channelIds: up to 8 UC ids. about: up to 8 ent_ ids of a brand or person the passage is about; speakerIds: up to 8 person ids who said it; kind: mention \| recommendation_sponsored \| recommendation_organic. Never put a topic word in about; it goes in query. If a search with about, speakerIds or kind returns no chunks, rerun it with query and channelIds only before saying nothing was found. limit 1..20 (default 5). source: arcmira_premium \| creator_captions \| third_party_quick. |
| `mentions` | `arcmira.mentions({ entityId, channelId?, after?, before?, limit?, cursor? })` | `{ entity{id, name, page}, data[{media{video_id, title, published_at, channel_id, source_channel{name}}, start_seconds}], has_more, next_cursor }` | When and where a name came up: one row per catalog mention, newest first, several rows per episode, limit 1..100. Never count rows to answer how many episodes: occurrences gives count per window. Rows carry no wording; for a quote use search. Read the episode title before asserting a lone row: a title far from the entity (a jungle episode for a bank) is a homonym the catalog mislabelled. |
| `momentum` | `arcmira.momentum(entityId)` | `{ entity, verdict (accelerating \| flat \| fading \| none), as_of, volume{mentions_30d, mentions_prior_30d, mentions_90d, total}, top_shows[{channel_id, channel_name, mentions}] }` | The last 30 days against the prior 30, as of as_of, across the shows Arcmira indexes. |
| `sponsors` | `arcmira.sponsors(channelId, { minAdReads?, status?, limit? })` | `{ channel{name, page}, sponsors[{entity{id, name, page}, ad_reads, videos, first_seen, last_seen, sponsor_status{status}}], meta{total} }` | Recurring sponsors of one show, ranked by ad_reads. status: active \| lapsed filters on sponsor_status.status. |
| `recommendations` | `arcmira.recommendations(entityId, { kind?, channelId?, after?, before?, limit?, cursor? })` | `{ entity, data[{mention_class (ad_read = sponsored, endorsement = organic), verbatim_quote, promo_code, media{video_id, title, published_at, source_channel{name}}, start_seconds}], has_more }` | Who recommends one entity on air. kind: sponsored \| organic \| all (default all), limit 1..50. Pro plan; a free key gets recommendations_not_enabled with its unlock link. |
| `episodes` | `arcmira.episodes(channelId, { limit?, after?, before? })` | `{ episodes[{video_id, title, published_at, duration_seconds, view_count, watch_url}], indexed_through, index_age_days }` | Newest indexed episodes of one show, limit 1..25; episodes[0] is the latest. Never count episodes to size a show: status({ channelId }).channel.searchable_videos is the count. |
| `transcript` | `arcmira.transcript(videoIdOrUrl, { quality?, language?, timestamps?, start?, end? })` | `{ video{id, title, channel_name, published_at, watch_url}, lines[{start, end, text, speaker?}], speakers[{id, name}], quality, source, language, as_of }` | quality: captions (default) \| premium (diarized: each line carries speaker, an id into speakers[], where name is the person or a label like Speaker 1; paid plans). start/end in seconds bill only that window: pass them for "the first minute". |
| `occurrences` | `arcmira.occurrences({ channelIds?, entityIds?, videoIds?, types?, mode?, after?, before?, limit? })` | `{ rows[{entity_id, name, type, channel_id, channel_name, count (episodes), occurrences (times said)}], shared[{entity_id, name, type, by_channel[{channel_id, channel_name, count}]}], as_of }` | Ranked catalog counts per entity per channel: what a show talks about, how many episodes mentioned an entity in a window, what one episode mentions (videoIds). Needs channelIds (up to 8), entityIds (up to 20) or videoIds (up to 20). types: person \| organization \| product \| topic \| channel. With two or more channelIds read shared, not rows, for what both shows mention. |
| `status` | `arcmira.status({ channelId? \| jobId? })` | `{ channel{youtube_channel_id, searchable_videos, indexed_through, search_indexed_through} } for a show; a transcription job for jobId; the key and plan with no argument` | searchable_videos is how many videos of a show are indexed; indexed_through is the as-of date to cite when nothing was found. |

The arcmira CLI (npm package `arcmira`) has commands with the same names. `arcmira sponsors UC... --min-ad-reads 3` is the shell form of `arcmira.sponsors(id, { minAdReads: 3 })`.

## Worked examples

Each block is a complete program to pass to the `execute` tool.

### One search, compact result

```javascript
const hits = await arcmira.search({ query: "stablecoins", channelIds: ["UC-DRzaGnL_vtBUpCFH5M0tg"], after: arcmira.daysAgo(90), limit: 3 });
return hits.chunks.map(c => ({ said: c.text, video: c.videoTitle, date: c.publishedAt, url: c.watchUrl }));
```

### Resolve, verify, then filter

```javascript
const r = await arcmira.resolve("Linear");
if (!r.best) return { options: r.candidates };   // let the user pick
const m = await arcmira.momentum(r.best.id);
return { entity: r.best.name, id: r.best.id, verdict: m.verdict, last30: m.volume.mentions_30d, prior30: m.volume.mentions_prior_30d, as_of: m.as_of };
```

### A show by name: its id, size, and what its latest episode mentions

```javascript
const show = await arcmira.resolve("All-In Podcast", { type: "channel" });
const ch = show.best?.youtube_channel_id;
if (!ch) return { options: show.candidates };
const [s, ep] = await Promise.all([arcmira.status({ channelId: ch }), arcmira.episodes(ch, { limit: 1 })]);
const what = await arcmira.occurrences({ videoIds: [ep.episodes[0].video_id], types: ["organization"], limit: 5 });
return { channel_id: ch, videos_indexed: s.channel.searchable_videos, indexed_through: s.channel.indexed_through, latest: ep.episodes[0].title, mentions: what.rows.map(r => [r.name, r.entity_id, r.occurrences]) };
```

### What two shows both talk about (shared, not rows)

```javascript
const o = await arcmira.occurrences({ channelIds: ["UC-DRzaGnL_vtBUpCFH5M0tg", "UCESLZhusAkFfsNsApnjF_Cg"], types: ["organization", "product"], limit: 40 });
return o.shared.slice(0, 5).map(s => ({ name: s.name, id: s.entity_id, episodes_by_show: s.by_channel.map(c => [c.channel_name, c.count]) }));
```

### Sponsors two shows share

```javascript
const [a, b] = await Promise.all([arcmira.sponsors("UC-DRzaGnL_vtBUpCFH5M0tg"), arcmira.sponsors("UCESLZhusAkFfsNsApnjF_Cg")]);
const inB = new Map(b.sponsors.map(s => [s.entity.id, s.ad_reads]));
return a.sponsors.filter(s => inB.has(s.entity.id)).map(s => ({ name: s.entity.name, id: s.entity.id, ad_reads: [s.ad_reads, inB.get(s.entity.id)] }));
```

### Who speaks in the first minute (Premium)

```javascript
const ep = await arcmira.episodes("UC-DRzaGnL_vtBUpCFH5M0tg", { limit: 1 });
const t = await arcmira.transcript(ep.episodes[0].video_id, { quality: "premium", start: 0, end: 60 });
const name = new Map((t.speakers ?? []).map(s => [s.id, s.name]));
return { video: ep.episodes[0].title, speakers: (t.speakers ?? []).map(s => s.name), opening: t.lines.slice(0, 8).map(l => `[${l.start}] ${name.get(l.speaker) ?? "?"}: ${l.text}`) };
```

### A month window (after and before are both counted); return the window so the answer states it

```javascript
const p = await arcmira.resolve("Cursor");
if (!p.best) return { options: p.candidates };
const window = { after: "2026-08-01", before: "2026-08-31" };
const o = await arcmira.occurrences({ channelIds: ["UC-DRzaGnL_vtBUpCFH5M0tg"], entityIds: [p.best.id], ...window });
const row = o.rows[0];
return { entity: p.best.name, id: p.best.id, window, episodes: row?.count ?? 0, times: row?.occurrences ?? 0, as_of: o.as_of };
```

### Rank brands by 30-day mentions

```javascript
const out = [];
for (const n of ["Anthropic", "OpenAI", "Cursor"]) {
  const r = await arcmira.resolve(n);   // no type: a company may be typed product
  if (!r.best) { out.push({ name: n, unresolved: r.candidates.map(c => [c.id, c.name, c.type]) }); continue; }
  const m = await arcmira.momentum(r.best.id);
  out.push({ name: r.best.name, id: r.best.id, last30: m.volume.mentions_30d });
}
return out.sort((a, b) => (b.last30 ?? -1) - (a.last30 ?? -1));
```

## Quirks

- Dates: arcmira.today() and arcmira.daysAgo(n) give ISO dates from the server clock; never guess today. after and before are both counted (August is after 2026-08-01, before 2026-08-31), in UTC. The index is not live: cite indexed_through or as_of before saying nothing happened recently.
- Momentum, mentions and counts measure the shows Arcmira indexes, not the internet; say so when it matters. An empty result means the index has no match: never fill it from memory or the web.
- Every plan gate throws with .code and .unlock.url, the page that lifts it. Relay the link.
- Results carry names beside ids and arcmira.com page links; link names to those pages and never invent an arcmira.com URL.

## Errors

Errors throw ArcmiraError with .code and, for gates, .unlock { tier, url }: id_required (a name where an id belongs; call arcmira.resolve first), invalid_video, too_many (over an id cap), entity_not_found, filter_requires_paid, recommendations_not_enabled, quota_exceeded, rate_limited (.retry_after_seconds), call_budget (over 40 API calls in one program). See https://arcmira.com/docs/errors.

## Docs

- API reference: https://arcmira.com/docs/api-reference
- MCP guide: https://arcmira.com/docs/mcp-server
- Error codes: https://arcmira.com/docs/errors
- OpenAPI: https://api.arcmira.com/v1/openapi.json
- Agent index: https://arcmira.com/llms.txt
