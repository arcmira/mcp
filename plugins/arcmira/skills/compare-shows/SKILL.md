---
name: compare-shows
description: "Compares two podcasts or YouTube shows side by side: size, latest episode, what each talks about, what both cover, and shared sponsors. Uses arcmira."
---

# Compare two shows

`status` sizes each show, `episodes` gives the latest, `occurrences` with both channel ids ranks what each covers and returns `shared` for what both mention, and `sponsors` of each, joined on entity id, gives shared sponsors.

Use it through the arcmira MCP server (`describe`, then `execute` with a program) or the arcmira CLI, whose commands have the same names. The `arcmira` skill and `describe` carry the full method reference.

## When to use

- compare two shows, or a show against a competitor
- what two podcasts both talk about, or who they both advertise
- a digest of what one or two shows covered this week or month

## Pick the entity the user meant

Users give names; filters take ids only (ent_..., UC..., 11-character video ids), and a name where an id belongs throws `id_required`.

1. Resolve the exact name the user said. `best` is only a guess when other candidates are close: "Sam" resolves to a bare "Sam" row while Sam Altman has sixteen times the appearances, and "Chamath" returns no `best` and several spellings of one person.
2. Weigh `best` against the other candidates and against what the user said around the name (the OpenAI CEO, a sponsor, a show). One candidate fits: use it.
3. Two or more fit: either check each against the data (run the query for each and keep the one the context and the data support), or stop and show the user a short list, one line per candidate: name, type, and one distinguishing fact (appearance count or top show), then ask which.
4. Nothing close (a show typed "All In"): retry with spelling variants ("All-In", "All-In Podcast") before you ask.
5. Say which entity the answer is about (name, type, id) in the answer, and name any close candidate you set aside. Never switch entities silently.

For this task:

- Resolve each show with `{ type: "channel" }` and use `youtube_channel_id`. Users shorten show names ("All In", "MTS"): retry the full or hyphenated name when nothing close comes back, and check each `best.name` against the show meant, since a clip or fan channel can share the name.
- Pass both UC ids in one `occurrences` call and read `shared`.

## Worked program

Pass each block to `execute` as one program, with the name swapped for the user's. It opens with the pick: when close candidates compete it returns `choose` and runs nothing else. Pick from that list by the user's context or ask them, then run it again with `ID` set to the pick. Build date windows from `arcmira.daysAgo(n)` and `arcmira.today()`.

### Two shows, last 30 days

```javascript
const SHOWS = ["TBPN", "All-In Podcast"], IDS = [null, null];   // after a choose list, put the picked UC id in IDS and run again
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ids = [], names = [];
for (const [i, n] of SHOWS.entries()) {
  if (IDS[i]) { ids.push(IDS[i]); names.push(n); continue; }
  const r = await arcmira.resolve(n, { type: "channel", limit: 10 });
  const close = r.candidates.filter(c => c.youtube_channel_id && c.youtube_channel_id !== r.best?.youtube_channel_id && norm(c.name).includes(norm(n)) && c.appearance_count * 4 >= (r.best?.appearance_count ?? 0));
  if (!r.best?.youtube_channel_id || close.length > 0) return { unresolved: n, choose: [r.best, ...close].filter(c => c?.youtube_channel_id).slice(0, 5).map(c => ({ name: c.name, channel_id: c.youtube_channel_id, appearances: c.appearance_count })) };
  ids.push(r.best.youtube_channel_id);
  names.push(r.best.name);
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
  shows: ids.map((id, i) => ({ name: names[i], channel_id: id, videos_indexed: [s0, s1][i].channel.searchable_videos, indexed_through: [s0, s1][i].channel.indexed_through, latest: [e0, e1][i].episodes[0]?.title ?? null,
    top: occ.rows.filter(x => x.channel_id === id).slice(0, 5).map(x => [x.name, x.count]) })),
  both_discussed: occ.shared.slice(0, 5).map(x => ({ name: x.name, id: x.entity_id, episodes_by_show: x.by_channel.map(c => [c.channel_name, c.count]) })),
  shared_sponsors: sp0.sponsors.filter(x => inOther.has(x.entity.id)).map(x => ({ name: x.entity.name, id: x.entity.id, ad_reads: [x.ad_reads, inOther.get(x.entity.id)] })),
};
```

## A good answer

- Names both shows as resolved, with their channel ids.
- A side-by-side: videos indexed and `indexed_through` for each, the latest episode, and each show's top subjects with episode counts.
- What both covered, from `shared`, with episodes per show, and the shared sponsors with ad reads per show, for a stated window.

## Traps

- With two or more `channelIds`, `occurrences` puts the overlap in `shared`; `rows` alone never shows it.
- Never count `episodes` to size a show; `status({ channelId }).channel.searchable_videos` is the count.
- An empty `shared` in a short window is an answer (no overlap in the window), not an error; widen the window only if the user asked for a longer one.

Plan gates throw with `.unlock.url`: relay the link. Never fill a gap from memory or the web. Docs: https://arcmira.com/docs/mcp-server
