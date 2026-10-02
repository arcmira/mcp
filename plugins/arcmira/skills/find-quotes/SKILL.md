---
name: find-quotes
description: "Finds exact spoken quotes and clip-ready moments on podcasts and YouTube: verbatim words, speaker, date, a timestamped link, clip start and end. Uses arcmira."
---

# Find quotes and clip moments

`search` finds the passage; `transcript` with `start` and `end` returns the exact lines around it with second offsets, which give the verbatim quote and the clip boundaries. Caption reads bill returned lines. Premium preparation always prices the whole video; start/end only select the returned window.

Use it through the arcmira MCP server (`describe`, then `execute` with a program) or the arcmira CLI, whose commands have the same names. `describe` carries the full method reference (CLI: `arcmira <command> --help`), and the `arcmira` skill the shared procedure.

## When to use

- find a quote, with the source and a timestamp
- the moment a show talked about a topic, to clip or cite
- what a specific person said about a topic, in their words

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

- A speaker resolves with `{ type: "person" }`; pass the id as `speakerIds` (who said it). A person or brand the passage is about goes in `about`. A show goes in `channelIds` as its UC id.
- People are often named by first name ("Chamath"). Pass what the user said about them as `context`; resolve suggests the person when one stands out and asks when several fit.
- The topic words go in `query`, never in `about`. If a filtered search returns no chunks, rerun it with fewer filters before saying nothing was found.

## Worked program

Pass each block to `execute` as one program, with the name swapped for the user's. It opens with the pick: set `CONTEXT` to the user's own words about the name. When several entities fit it returns `ask` and runs nothing else. Show those options to the user, then run it again with `ID` set to the pick. When the result carries `assumed: true`, tell the user which entity was assumed and why (`why`). Build date windows from `arcmira.daysAgo(n)` and `arcmira.today()`.

### What one person said about a topic, with clip boundaries

```javascript
const NAME = "Chamath", CONTEXT = undefined, ID = null;   // CONTEXT: the user's own words about the name, never a guess. After an ask, set ID to the picked option's id and run again
const r = ID ? null : await arcmira.resolve(NAME, { type: "person", context: CONTEXT });
const e = r && (r.best ?? r.suggested);
if (r && !e) return { ask: r.ask };
const id = ID ?? e.id;
const assumed = Boolean(r?.suggested), why = r?.suggested?.evidence ?? null;
const hits = await arcmira.search({ query: "Anthropic IPO", speakerIds: [id], limit: 5 });
const moments = [];
for (const c of hits.chunks.slice(0, 2)) {
  const moment = { episode: c.videoTitle, show: c.channelName, date: c.publishedAt, url: c.watchUrl, speakers: c.speakers_by.map(s => s.name) };
  try {
    const t = await arcmira.transcript(c.videoId, { start: Math.max(0, c.startSeconds - 10), end: c.startSeconds + 50 });
    moment.clip = { start: t.lines[0]?.start ?? c.startSeconds, end: t.lines.at(-1)?.end ?? c.startSeconds + 60 };
    moment.lines = t.lines.map(l => `[${Math.round(l.start)}s] ${l.text}`);
  } catch (err) {
    moment.clip = { start: c.startSeconds, end: c.startSeconds + 60 };
    moment.passage = c.text;
    moment.transcript = err.code;
  }
  moments.push(moment);
}
return { speaker: { id, name: e?.name ?? null, assumed, why }, as_of: hits.as_of, ...(moments.length ? { moments } : { none: hits.note ?? null }) };
```

## A good answer

- Names the speaker or show it searched, with the id, and quotes the words exactly as the transcript lines give them, trimmed to whole sentences, never paraphrased inside quotation marks.
- Gives the show, the episode title, the date, and the speaker when the chunk or a premium transcript names one.
- Links the `watchUrl`, which starts at the moment, and gives a clip start and end in seconds from the transcript lines.
- Says so when nothing matched, with `as_of`, instead of offering a quote from memory.

## Traps

- `search` ranks by the words in `query`; put the distinctive words of the phrase there, not a paraphrase.
- A chunk found with `speakerIds` also holds other people's lines. Quote only lines that start with the speaker's name ("Chamath Palihapitiya: ..."), never the whole passage.
- Caption lines are machine text: fix nothing inside the quotation marks. A premium transcript (`quality: "premium"`, paid plans) adds speaker ids into `speakers[]`.
- Keep transcript windows short (`start`, `end`): a whole episode bills every line.
- Some videos have no readable caption track yet (`transcript_unavailable`, `transcript_fetching`); quote the search chunk `text` for those and say the words come from the search passage.

When a plan or usage limit blocks a capability, briefly name the limit and any required tier reported by the API. Link to https://arcmira.com/pricing as "Plan access details" for information; do not upgrade a plan. Requested Premium work may use included credits without another confirmation. Preserve error codes and reported quota or reset facts. If the user requested Premium, keep quality: "premium". Do not retry with captions, suggest third-party transcripts, or present them as equivalent. Only change the requested quality if the user asks.

Search as_of is the newest publication date among the returned passages, not the date the whole index was updated. For channel freshness, call arcmira.status({ channelId }) and report channel.search_indexed_through for transcript search. A result date or an empty query does not establish missing recent episodes.

Keep outside evidence separate from Arcmira results. Docs: https://arcmira.com/docs/mcp-server
