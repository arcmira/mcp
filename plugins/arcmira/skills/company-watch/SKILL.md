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

1. Resolve the exact name the user said, and pass their own words about it as `context` when they gave any ("Sam, the My First Million co-host" is `resolve("Sam", { context: "the My First Million co-host" })`). Context is only words from the user's message, never your guess: a bare "Theo" is `resolve("Theo")`, and its ask goes back to the user.
2. `best`: the name means that row. Use it and name it.
3. `suggested`: no row is certain but one stands out. Use it and tell the user you assumed it, quoting `suggested.evidence` ("Sam Altman, assuming the most mentioned Sam: 4,399 appearances, 11x the next").
4. `ask`: several rows fit and none stands out. Return `ask.options` for the user to pick and stop, or check every option id against the data in one program (occurrences or momentum with all the ids) and answer per row, naming each.
5. None of the three: the name is not in the Arcmira index. Say so and ask for another spelling or a link; never answer for a different entity without saying so.
6. Say which entity the answer is about (name, type, id) in the answer. Never switch entities silently.
7. Before asserting a mention, read its description or passage and say which sense of the name it is (Mercury the bank, not the element). Drop rows about another sense.

For this task:

- Resolve with no type: the catalog types some companies as product.
- A company name is often a common word ("Linear", "Ramp", "ICE"). State which one the answer covers, for example "Linear, the software company (product, ent_279443)", so the user can catch a wrong pick.

## Worked program

Pass each block to `execute` as one program, with the name swapped for the user's. It opens with the pick: set `CONTEXT` to the user's own words about the name. When several entities fit it returns `ask` and runs nothing else. Show those options to the user, then run it again with `ID` set to the pick. When the result carries `assumed: true`, tell the user which entity was assumed and why (`why`). Build date windows from `arcmira.daysAgo(n)` and `arcmira.today()`.

### The last seven days about one company

```javascript
const NAME = "Linear", CONTEXT = undefined, ID = null;   // CONTEXT: the user's own words about the name, never a guess. After an ask, set ID to the picked option's id and run again
const r = ID ? null : await arcmira.resolve(NAME, { context: CONTEXT });
const e = r && (r.best ?? r.suggested);
if (r && !e) return { ask: r.ask };
const id = ID ?? e.id;
const assumed = Boolean(r?.suggested), why = r?.suggested?.evidence ?? null;
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
