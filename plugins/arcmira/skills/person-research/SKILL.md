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

1. Resolve the exact name the user said. `best` is only a guess when other candidates are close: "Sam" resolves to a bare "Sam" row while Sam Altman has sixteen times the appearances, and "Chamath" returns no `best` and several spellings of one person.
2. Weigh `best` against the other candidates and against what the user said around the name (the OpenAI CEO, a sponsor, a show). One candidate fits: use it.
3. Two or more fit: either check each against the data (run the query for each and keep the one the context and the data support), or stop and show the user a short list, one line per candidate: name, type, and one distinguishing fact (appearance count or top show), then ask which.
4. Nothing close (a show typed "All In"): retry with spelling variants ("All-In", "All-In Podcast") before you ask.
5. Say which entity the answer is about (name, type, id) in the answer, and name any close candidate you set aside. Never switch entities silently.

For this task:

- Resolve with `{ type: "person" }`. A first name alone ("Sam") matches many people: use what the user said about them (runs OpenAI, hosts a show) to pick from the choose list, and ask when nothing in the request settles it.
- The catalog can hold one person under several spellings; take the row with the most appearances and say which id you used.

## Worked program

Pass each block to `execute` as one program, with the name swapped for the user's. It opens with the pick: when close candidates compete it returns `choose` and runs nothing else. Pick from that list by the user's context or ask them, then run it again with `ID` set to the pick. Build date windows from `arcmira.daysAgo(n)` and `arcmira.today()`.

### Prep on one person

```javascript
const NAME = "Jensen Huang", ID = null;   // after a choose list, set ID to the pick and run again
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const r = ID ? null : await arcmira.resolve(NAME, { type: "person", limit: 10 });
const close = r ? r.candidates.filter(c => c.id && c.id !== r.best?.id && norm(c.name).includes(norm(NAME)) && c.appearance_count * 4 >= (r.best?.appearance_count ?? 0)).sort((a, b) => b.appearance_count - a.appearance_count) : [];
if (r && (!r.best || !r.best.id || close.length > 0)) return { choose: [r.best, ...close].filter(c => c && c.id).slice(0, 5).map(c => ({ id: c.id, name: c.name, type: c.type, appearances: c.appearance_count })) };
const id = ID ?? r.best.id;
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
  } catch (e) {
    fromAppearance = { episode: ep.media.title, error: e.code };
  }
}
return {
  person: { id, name: m.entity.name, page: m.entity.page },
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

Plan gates throw with `.unlock.url`: relay the link. Never fill a gap from memory or the web. Docs: https://arcmira.com/docs/mcp-server
