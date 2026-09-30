---
name: company-watch
description: "Tracks what podcasts and YouTube shows said about a company or product this week: which shows, how often, momentum, and quotes with links. Uses arcmira."
---

# Company watch

One program answers "what was said about X this week": episode counts per show from `occurrences`, the trend from `momentum`, the catalog notes on each mention from `mentions`, and quotes from `search` filtered to passages about the entity.

Use it through the arcmira MCP server (`describe`, then `execute` with a program) or the arcmira CLI, whose commands have the same names. The `arcmira` skill and `describe` carry the full method reference.

## When to use

- what is being said about a company, product or brand this week or this month
- did any show mention us, a competitor or an investor lately
- is talk about a company rising or fading, and where

## Pick the entity the user meant

Users give names; filters take ids only (ent_..., UC..., 11-character video ids), and a name where an id belongs throws `id_required`.

1. Resolve the exact name the user said. `best` is only a guess when other candidates are close: "Sam" resolves to a bare "Sam" row while Sam Altman has sixteen times the appearances, and "Chamath" returns no `best` and several spellings of one person.
2. Weigh `best` against the other candidates and against what the user said around the name (the OpenAI CEO, a sponsor, a show). One candidate fits: use it.
3. Two or more fit: either check each against the data (run the query for each and keep the one the context and the data support), or stop and show the user a short list, one line per candidate: name, type, and one distinguishing fact (appearance count or top show), then ask which.
4. Nothing close (a show typed "All In"): retry with spelling variants ("All-In", "All-In Podcast") before you ask.
5. Say which entity the answer is about (name, type, id) in the answer, and name any close candidate you set aside. Never switch entities silently.

For this task:

- Resolve with no type: the catalog types some companies as product.
- A company name is often a common word ("Linear", "Ramp", "ICE"). State which one the answer covers, for example "Linear, the software company (product, ent_279443)", so the user can catch a wrong pick.

## Worked program

Pass each block to `execute` as one program, with the name swapped for the user's. It opens with the pick: when close candidates compete it returns `choose` and runs nothing else. Pick from that list by the user's context or ask them, then run it again with `ID` set to the pick. Build date windows from `arcmira.daysAgo(n)` and `arcmira.today()`.

### The last seven days about one company

```javascript
const NAME = "Linear", ID = null;   // after a choose list, set ID to the pick and run again
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const r = ID ? null : await arcmira.resolve(NAME, { limit: 10 });
const close = r ? r.candidates.filter(c => c.id && c.id !== r.best?.id && norm(c.name).includes(norm(NAME)) && c.appearance_count * 4 >= (r.best?.appearance_count ?? 0)).sort((a, b) => b.appearance_count - a.appearance_count) : [];
if (r && (!r.best || !r.best.id || close.length > 0)) return { choose: [r.best, ...close].filter(c => c && c.id).slice(0, 5).map(c => ({ id: c.id, name: c.name, type: c.type, appearances: c.appearance_count })) };
const id = ID ?? r.best.id;
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
  entity: { id, name: m.entity.name, type: m.entity.type, page: m.entity.page },
  window: { after, through: arcmira.today() },
  momentum: { verdict: m.verdict, last_7d: m.volume.mentions_7d, last_30d: m.volume.mentions_30d, prior_30d: m.volume.mentions_prior_30d, as_of: m.as_of },
  shows: occ.rows.map(x => ({ show: x.channel_name, channel_id: x.channel_id, episodes: x.count, times_said: x.occurrences })),
  context: notes.data.map(x => ({ show: x.media.source_channel?.name ?? null, episode: x.media.title, date: x.media.published_at, note: x.description })),
  quotes_tagged_to_entity: quotesTagged,
  quotes: quotes.chunks.map(c => ({ said: c.text.slice(0, 300), show: c.channelName, episode: c.videoTitle, date: c.publishedAt, url: c.watchUrl })),
};
```

## A good answer

- Opens with the entity it covers (name, type, id).
- Gives the verdict (accelerating, flat or fading) and the 7-day and 30-day counts, with `as_of`.
- Lists the shows with episode counts for the window, and states the window.
- Gives two or three quotes in the speakers' words, each with show, date and the `watchUrl` link, and says what the talk was about without adding facts the results do not carry.

## Traps

- Counts measure the shows Arcmira indexes, not the internet. An empty week means no indexed show said it; cite `as_of` before saying nothing happened.
- Read episode titles and notes before asserting a lone mention: a title far from the company is a homonym the catalog mislabelled.
- Count episodes with `occurrences`, never by counting `mentions` rows (one episode has several rows).

Plan gates throw with `.unlock.url`: relay the link. Never fill a gap from memory or the web. Docs: https://arcmira.com/docs/mcp-server
