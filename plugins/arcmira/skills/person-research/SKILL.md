---
name: person-research
description: "Researches a person across podcasts and YouTube for interview or meeting prep: where they appeared, their own words, who discusses them. Uses arcmira."
---

# Person research

Three lenses on one person id. `momentum` gives attention and the shows that mention them most. `mentions` rows with `is_appearance` are episodes they were on. `search` with `speakerIds` returns their own words; `about` returns what others said about them.

Use it through the arcmira MCP server (`describe`, then `execute` with a program) or the arcmira CLI, whose commands have the same names. The `arcmira` skill and `describe` carry the full method reference.

## When to use

- prep for an interview, a podcast booking or a meeting with someone
- what has a person said recently, and where
- who talks about a person, and is attention rising

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

- Resolve with `{ type: "person" }`. A first name alone ("Sam") matches many people: pass what the user said about them (runs OpenAI, hosts a show) as `context`, and when resolve still answers `ask`, show its options.

## Worked program

Pass each block to `execute` as one program, with the name swapped for the user's. It opens with the pick: set `CONTEXT` to the user's own words about the name. When several entities fit it returns `ask` and runs nothing else. Show those options to the user, then run it again with `ID` set to the pick. When the result carries `assumed: true`, tell the user which entity was assumed and why (`why`). Build date windows from `arcmira.daysAgo(n)` and `arcmira.today()`.

### Prep on one person

```javascript
const NAME = "Jensen Huang", CONTEXT = undefined, ID = null;   // CONTEXT: the user's own words about the name, never a guess. After an ask, set ID to the picked option's id and run again
const r = ID ? null : await arcmira.resolve(NAME, { type: "person", context: CONTEXT });
const e = r && (r.best ?? r.suggested);
if (r && !e) return { ask: r.ask };
const id = ID ?? e.id;
const assumed = Boolean(r?.suggested), why = r?.suggested?.evidence ?? null;
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
    fromAppearance = { episode: t.video.title, show: t.video.channel_name, date: t.video.published_at, url: `${t.video.watch_url}${t.video.watch_url.includes("?") ? "&" : "?"}t=${s}`, lines: t.lines.map(l => `[${Math.round(l.start)}s] ${l.text}`), speaker_labelled: t.lines.some(l => l.speaker) };
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
};
```

## A good answer

- Names the person it researched (name and id), and any other person with the same name it set aside.
- Separates what the person said (speaker-filtered) from what others said about them, each with show, date and link.
- Gives the attention verdict, the 30-day count against the prior 30 days, and the top shows, with `as_of`.
- Lists recent episodes they appeared on, and ends with a few questions or themes that follow from the quotes when the user is prepping.

## Traps

- A search with `about` returns other people talking; only `speakerIds` returns the person's own words. Speaker tags cover part of the index (Sam Altman has none), so when the speaker search is empty, read a window of an episode they appeared on and say the lines come from their appearance, since caption lines do not name the speaker.
- A chunk found with `speakerIds` also holds other people's lines. Quote only lines that start with the person's name.
- Put the user's topic in `query` for the speaker search (it needs a word or phrase of two or more characters).
- Mentions and momentum count the shows Arcmira indexes, not all media.

When a plan or usage limit blocks a capability, briefly name the limit and any required tier reported by the API. Link to https://arcmira.com/pricing as "Plan access details" for information; do not upgrade a plan. Requested Premium work may use included credits without another confirmation. Preserve error codes and reported quota or reset facts. If the user requested Premium, keep quality: "premium". Do not retry with captions, suggest third-party transcripts, or present them as equivalent. Only change the requested quality if the user asks.

Never fill an index gap from memory or the web. Docs: https://arcmira.com/docs/mcp-server
