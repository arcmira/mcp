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
  const r = await arcmira.resolve("Ramp");   // r.confidence: exact | ambiguous | fuzzy | single_fuzzy | none
  // r.best is set only for an unambiguous match. Check r.best.type and r.best.name against what the user meant
  // (a brand, a person, a show). If r.best is null, pick from r.candidates by type and name, or report the options.
  const id = r.best.id;                      // then filter with it (after the null check). For a show, resolve with { type: "channel" } and use best.youtube_channel_id.
Resolve the exact name the user said ("ICE", "Mercury"), never a paraphrase ("ICE immigration"); use what the user meant to check .best.type and .best.name, not as query text. single_fuzzy is one loose match: read it before trusting it. When two candidates both fit the meaning (the catalog holds duplicates), take the one with the higher appearance_count, or query both and say which ids you used.
```

## Methods

Every method is async and returns parsed JSON. The program runs as the body of an async function with `arcmira` and `ArcmiraError` in scope. `arcmira.today()` returns "YYYY-MM-DD" on the server clock. `arcmira.daysAgo(n)` returns the ISO date n days ago.

| Method | Call | Returns | Notes |
| --- | --- | --- | --- |
| `resolve` | `arcmira.resolve(q, { type?, limit? })` | `{ query, confidence, best, candidates[{id, name, type, appearance_count, youtube_channel_id, page, suggested}], note }` | q is a name, @handle, YouTube URL or UC id. type: person \| organization \| product \| topic \| channel. limit 1..15 (default 8). Omit type for a brand or company: the catalog types some companies as product (Cursor, Linear) and some products as organization. Pass type only for a person or a show (channel). |
| `search` | `arcmira.search({ query, channelIds?, entityIds?, speakerIds?, kind?, after?, before?, source?, limit? })` | `{ chunks[{text, video_id, title, published_at, start_seconds, watchUrl, channel_id}] }` | Spoken slices for one topic or phrase; one topic per call. channelIds up to 8 UC ids, entityIds up to 8 ent_ ids (what the slice is about), speakerIds up to 8 person ent_ ids (who is speaking). kind: mention \| recommendation_sponsored \| recommendation_organic keeps one class of slice. after/before are ISO dates. limit 1..20 (default 5). source: arcmira_premium \| creator_captions \| third_party_quick. Search finds wording. For "has X ever been mentioned", counts, or sponsors, use the catalog methods below; they are exact and cheaper. |
| `mentions` | `arcmira.mentions({ entityId, channelId?, after?, before?, limit?, cursor? })` | `{ entity{id, name, type, page}, data[{media{video_id, title, published_at, channel_id, source_channel{name}}, start_seconds, is_appearance}], has_more, next_cursor }` | One row per catalog mention, newest first. limit 1..100. An empty list means no mention in the index, never search the web to fill it. Rows carry no wording: for a quote or a moment, use search, which reads the transcripts themselves and finds topics the catalog has not tagged. |
| `momentum` | `arcmira.momentum(entityId)` | `{ entity, verdict (accelerating \| flat \| fading \| none), as_of, volume{mentions_7d, mentions_30d, mentions_prior_30d, mentions_90d, total}, top_shows[{channel_id, channel_name, mentions}], paid_vs_organic }` | Momentum measures the shows Arcmira indexes, not the internet. The 30-day split is relative to as_of. |
| `sponsors` | `arcmira.sponsors(channelId, { minAdReads?, status?, limit? })` | `{ channel, sponsors[{entity{id, name, page}, ad_reads, first_seen, last_seen, status}], meta{total}, access? }` | Recurring sponsors of one show from the ad-read rollup, ranked by ad_reads. status: active \| lapsed. |
| `recommendations` | `arcmira.recommendations(entityId, { kind?, channelId?, after?, before?, limit?, cursor? })` | `{ entity, data[{mention_class (ad_read = sponsored, endorsement = organic), verbatim_quote, speaker_role, promo_code, offer, media{video_id, title, published_at, channel_id, source_channel{name}}, start_seconds}], has_more }` | Who recommends one entity on air. kind: sponsored \| organic \| all (default all). limit 1..50. Pro plan; a free key gets recommendations_not_enabled with its unlock link. |
| `episodes` | `arcmira.episodes(channelId, { limit?, after?, before? })` | `{ episodes[{video_id, title, published_at, duration_seconds, view_count, watch_url}], indexed_through, index_age_days }` | Newest indexed episodes of one show, limit 1..25. episodes[0].video_id is what transcript and occurrences take for "the latest episode". For how many videos a show has indexed, use arcmira.status({ channelId }).channel.searchable_videos, not this list. |
| `transcript` | `arcmira.transcript(videoIdOrUrl, { quality?, language?, timestamps?, start?, end? })` | `{ video, lines[{start, text, speaker?}] \| paragraphs[], speakers[], languages, source, revision }` | quality: captions (default) \| premium (diarized, every line names its speaker; paid plans, bills per row). start/end in seconds bill only that window; pass them for "the first minute". Premium speakers on a day-old video may still be labels like Speaker A, not names. |
| `occurrences` | `arcmira.occurrences({ channelIds?, entityIds?, videoIds?, types?, mode?, after?, before?, limit? })` | `{ rows[{entity_id, name, type, channel_id, channel_name, count (episodes), occurrences (times said)}], shared[{entity_id, name, type, channel_count, by_channel[{channel_id, channel_name, count, occurrences}]}], as_of }` | Ranked catalog counts: what shows talk about, how many episodes mentioned an entity, what one episode mentions (videoIds). Needs at least one of channelIds (up to 8), entityIds (up to 20), videoIds (up to 20). types: person \| organization \| product \| topic \| channel. mode: mentions (default) \| appearances. rows is one row per entity per channel. With two or more channelIds, shared lists the entities every one of those channels mentions, ranked: read shared, not rows, for "what do both shows talk about" or "common to". Date windows: after is the first day counted and before is the first day left out, so for "August" pass after "2026-08-01" and before "2026-09-01". Say which boundary you used; an episode published in the last hours of a month in UTC can land on the other side. |
| `status` | `arcmira.status({ channelId?, jobId? })` | `{ channel{youtube_channel_id, searchable_videos, indexed_through, search_indexed_through, source_mix}, note } for a channel; a transcription job for jobId; with no argument the key: { tier, scopes, ... }` | indexed_through is the as-of date for mentions and counts; search_indexed_through for transcript search. Cite it when an answer says nothing was found. |

The arcmira CLI (npm package `arcmira`) has commands with the same names. `arcmira sponsors UC... --min-ad-reads 3` is the shell form of `arcmira.sponsors(id, { minAdReads: 3 })`.

## Worked examples

Each block is a complete program to pass to the `execute` tool.

### One search, compact result

```javascript
const hits = await arcmira.search({ query: "stablecoins", channelIds: ["UC-DRzaGnL_vtBUpCFH5M0tg"], after: arcmira.daysAgo(90), limit: 3 });
return hits.chunks.map(c => ({ said: c.text, video: c.title, date: c.published_at, url: c.watchUrl }));
```

### Resolve, verify, then filter

```javascript
const r = await arcmira.resolve("Linear", { type: "organization" });
if (!r.best) return { options: r.candidates };          // let the user pick
const m = await arcmira.momentum(r.best.id);
return { entity: r.best.name, id: r.best.id, verdict: m.verdict, last30: m.volume.mentions_30d, prior30: m.volume.mentions_prior_30d, as_of: m.as_of };
```

### A show by name: resolve as a channel

```javascript
const show = await arcmira.resolve("All-In Podcast", { type: "channel" });
const ch = show.best?.youtube_channel_id;
if (!ch) return { options: show.candidates };
const ep = await arcmira.episodes(ch, { limit: 1 });
const what = await arcmira.occurrences({ videoIds: [ep.episodes[0].video_id], types: ["organization"], limit: 5 });
return { episode: ep.episodes[0], mentions: what.rows.map(r => ({ name: r.name, id: r.entity_id, times: r.occurrences })) };
```

### What two shows both talk about (shared, not rows)

```javascript
const o = await arcmira.occurrences({ channelIds: ["UC-DRzaGnL_vtBUpCFH5M0tg", "UCESLZhusAkFfsNsApnjF_Cg"], types: ["organization", "product"], limit: 40 });
return o.shared.slice(0, 5).map(s => ({ name: s.name, id: s.entity_id, episodes_by_show: s.by_channel.map(c => [c.channel_name, c.count]) }));
```

### Sponsors two shows share

```javascript
const [a, b] = await Promise.all([arcmira.sponsors("UC-DRzaGnL_vtBUpCFH5M0tg"), arcmira.sponsors("UCESLZhusAkFfsNsApnjF_Cg")]);
const ids = new Set(b.sponsors.map(s => s.entity.id));
return a.sponsors.filter(s => ids.has(s.entity.id)).map(s => ({ name: s.entity.name, id: s.entity.id, ad_reads_a: s.ad_reads, ad_reads_b: b.sponsors.find(x => x.entity.id === s.entity.id).ad_reads }));
```

### Who is speaking in the first minute (Premium)

```javascript
const ep = await arcmira.episodes("UC-DRzaGnL_vtBUpCFH5M0tg", { limit: 1 });
const t = await arcmira.transcript(ep.episodes[0].video_id, { quality: "premium", start: 0, end: 60 });
return { video: ep.episodes[0].title, speakers: t.speakers, opening: (t.lines ?? []).slice(0, 8).map(l => `[${l.start}] ${l.speaker ?? "?"}: ${l.text}`) };
```

### A date window: episodes that mentioned a person in August (before is the first day left out)

```javascript
const p = await arcmira.resolve("Sam Altman", { type: "person" });
if (!p.best) return { options: p.candidates };
const rows = await arcmira.occurrences({ channelIds: ["UC-DRzaGnL_vtBUpCFH5M0tg"], entityIds: [p.best.id], after: "2026-08-01", before: "2026-09-01" });
const row = rows.rows[0];
return row ? { person: p.best.name, episodes: row.count, times: row.occurrences } : { person: p.best.name, episodes: 0, times: 0 };
```

### Sponsored or organic

```javascript
const recs = await arcmira.recommendations("ent_14", { kind: "all", limit: 50 });
const organic = recs.data.filter(r => r.mention_class === "endorsement");
return { sponsored: recs.data.length - organic.length, organic: organic.length, organic_shows: [...new Set(organic.map(r => r.media.source_channel?.name))] };
```

### Rank entities by 30-day mentions

```javascript
const names = ["Anthropic", "OpenAI", "Cursor"];
const out = [];
for (const n of names) {
  const r = await arcmira.resolve(n);                 // no type: a company may be typed product
  if (!r.best) { out.push({ name: n, unresolved: r.candidates.map(c => c.id + " " + c.name + " " + c.type) }); continue; }
  const m = await arcmira.momentum(r.best.id);
  out.push({ name: r.best.name, id: r.best.id, last30: m.volume.mentions_30d });
}
return out.sort((a, b) => (b.last30 ?? -1) - (a.last30 ?? -1));
```

### Coverage and the index date

```javascript
const s = await arcmira.status({ channelId: "UC-DRzaGnL_vtBUpCFH5M0tg" });
return { searchable_videos: s.channel.searchable_videos, indexed_through: s.channel.indexed_through, search_indexed_through: s.channel.search_indexed_through, today: arcmira.today() };
```

## Quirks

- Dates: arcmira.today() and arcmira.daysAgo(n) give ISO dates from the server clock; use them for "the last 90 days" instead of guessing today. The index is not live: check indexed_through or as_of before saying nothing happened recently.
- momentum splits the last 30 days against the prior 30; recommendations rows are all-time unless you pass after/before. For a month, after is its first day and before is the first day of the next month.
- The catalog holds some duplicates (a brand under two ids, an agency under two rows). When candidates show two rows with the same name and type, sum or pick deliberately and say which ids you used. A lone mention row whose episode title is far from the entity (a jungle episode for a bank) is likely a homonym the catalog mislabelled: read the title before asserting the mention.
- Momentum, mentions and counts measure the shows Arcmira indexes, not the whole internet. Say "on the shows Arcmira indexes" when it matters.
- Every plan gate throws with .code and .unlock.url (the page that lifts it). Relay the link; never work around a gate by searching the open web.
- Results carry names beside ids and arcmira.com page links. Link names to those pages in the answer; never invent an arcmira.com URL.

## Errors

Errors throw ArcmiraError with .code and, for gates, .unlock { tier, url }. Codes you will see: id_required (a name where an id belongs; call arcmira.resolve first), invalid_video, too_many (over the id cap), entity_not_found, filter_requires_paid, recommendations_not_enabled, rate_limited (.retry_after_seconds), call_budget (over 40 API calls in one program; narrow the query). See https://arcmira.com/docs/errors.

## Docs

- API reference: https://arcmira.com/docs/api-reference
- MCP guide: https://arcmira.com/docs/mcp-server
- Error codes: https://arcmira.com/docs/errors
- OpenAPI: https://api.arcmira.com/v1/openapi.json
- Agent index: https://arcmira.com/llms.txt
