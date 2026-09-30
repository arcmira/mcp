---
name: find-quotes
description: "Finds exact spoken quotes and clip-ready moments on podcasts and YouTube: verbatim words, speaker, date, a timestamped link, clip start and end. Uses arcmira."
---

# Find quotes and clip moments

`search` finds the passage; `transcript` with `start` and `end` returns the exact lines around it with second offsets, which give the verbatim quote and the clip boundaries. Only that window is billed.

Use it through the arcmira MCP server (`describe`, then `execute` with a program) or the arcmira CLI, whose commands have the same names. The `arcmira` skill and `describe` carry the full method reference.

## When to use

- find a quote, with the source and a timestamp
- the moment a show talked about a topic, to clip or cite
- what a specific person said about a topic, in their words

## Pick the entity the user meant

Users give names; filters take ids only (ent_..., UC..., 11-character video ids), and a name where an id belongs throws `id_required`.

1. Resolve the exact name the user said. `best` is only a guess when other candidates are close: "Sam" resolves to a bare "Sam" row while Sam Altman has sixteen times the appearances, and "Chamath" returns no `best` and several spellings of one person.
2. Weigh `best` against the other candidates and against what the user said around the name (the OpenAI CEO, a sponsor, a show). One candidate fits: use it.
3. Two or more fit: either check each against the data (run the query for each and keep the one the context and the data support), or stop and show the user a short list, one line per candidate: name, type, and one distinguishing fact (appearance count or top show), then ask which.
4. Nothing close (a show typed "All In"): retry with spelling variants ("All-In", "All-In Podcast") before you ask.
5. Say which entity the answer is about (name, type, id) in the answer, and name any close candidate you set aside. Never switch entities silently.

For this task:

- A speaker resolves with `{ type: "person" }`; pass the id as `speakerIds` (who said it). A person or brand the passage is about goes in `about`. A show goes in `channelIds` as its UC id.
- People are often named by first name ("Chamath"). When the candidates are spellings of one person, take the one with the most appearances and say so; when they are different people, ask.
- The topic words go in `query`, never in `about`. If a filtered search returns no chunks, rerun it with fewer filters before saying nothing was found.

## Worked program

Pass each block to `execute` as one program, with the name swapped for the user's. It opens with the pick: when close candidates compete it returns `choose` and runs nothing else. Pick from that list by the user's context or ask them, then run it again with `ID` set to the pick. Build date windows from `arcmira.daysAgo(n)` and `arcmira.today()`.

### What one person said about a topic, with clip boundaries

```javascript
const NAME = "Chamath", ID = null;   // after a choose list, set ID to the pick and run again
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const r = ID ? null : await arcmira.resolve(NAME, { type: "person", limit: 10 });
const close = r ? r.candidates.filter(c => c.id && c.id !== r.best?.id && norm(c.name).includes(norm(NAME)) && c.appearance_count * 4 >= (r.best?.appearance_count ?? 0)).sort((a, b) => b.appearance_count - a.appearance_count) : [];
if (r && (!r.best || !r.best.id || close.length > 0)) return { choose: [r.best, ...close].filter(c => c && c.id).slice(0, 5).map(c => ({ id: c.id, name: c.name, type: c.type, appearances: c.appearance_count })) };
const id = ID ?? r.best.id;
const hits = await arcmira.search({ query: "Anthropic IPO", speakerIds: [id], limit: 5 });
const moments = [];
for (const c of hits.chunks.slice(0, 2)) {
  const moment = { episode: c.videoTitle, show: c.channelName, date: c.publishedAt, url: c.watchUrl, speakers: c.speakers_by.map(s => s.name) };
  try {
    const t = await arcmira.transcript(c.videoId, { start: Math.max(0, c.startSeconds - 10), end: c.startSeconds + 50 });
    moment.clip = { start: t.lines[0]?.start ?? c.startSeconds, end: t.lines.at(-1)?.end ?? c.startSeconds + 60 };
    moment.lines = t.lines.map(l => `[${Math.round(l.start)}s] ${l.text}`);
  } catch (e) {
    moment.clip = { start: c.startSeconds, end: c.startSeconds + 60 };
    moment.passage = c.text;
    moment.transcript = e.code;
  }
  moments.push(moment);
}
return { speaker_id: id, as_of: hits.as_of, moments };
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

Plan gates throw with `.unlock.url`: relay the link. Never fill a gap from memory or the web. Docs: https://arcmira.com/docs/mcp-server
