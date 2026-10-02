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

1. Resolve the exact name the user said, and pass their own words about it as `context` when they gave any ("Sam, the My First Million co-host" is `resolve("Sam", { context: "the My First Million co-host" })`). Context is only words from the user's message, never your guess: a bare "Theo" is `resolve("Theo")`, and its ask goes back to the user.
2. `best`: the name means that row. Use it and name it.
3. `suggested`: no row is certain but one stands out. Use it and tell the user you assumed it, quoting `suggested.evidence` ("Sam Altman, assuming the most mentioned Sam: 4,399 appearances, 11x the next").
4. `ask`: several rows fit and none stands out. Return `ask.options` for the user to pick and stop, or check every option id against the data in one program (occurrences or momentum with all the ids) and answer per row, naming each.
5. None of the three: the name is not in the Arcmira index. Say so and ask for another spelling or a link; never answer for a different entity without saying so.
6. Say which entity the answer is about (name, type, id) in the answer. Never switch entities silently.
7. Before asserting a mention, read its description or passage and say which sense of the name it is (Mercury the bank, not the element). Drop rows about another sense.

For this task:

- Resolve each show with `{ type: "channel" }` and use `youtube_channel_id`. Users shorten show names ("All In", "MTS"); resolve suggests a show by its initials or closest spelling, so say when a show was assumed. When nothing comes back, retry the full or hyphenated name before saying the show is not in the index.
- Pass both UC ids in one `occurrences` call and read `shared`.

## Worked program

Pass each block to `execute` as one program, with the name swapped for the user's. It opens with the pick: set `CONTEXT` to the user's own words about the name. When several entities fit it returns `ask` and runs nothing else. Show those options to the user, then run it again with `ID` set to the pick. When the result carries `assumed: true`, tell the user which entity was assumed and why (`why`). Build date windows from `arcmira.daysAgo(n)` and `arcmira.today()`.

### Two shows, last 30 days

```javascript
const SHOWS = ["TBPN", "All-In Podcast"], IDS = [null, null];   // after an ask, put the picked option's channel_id in IDS and run again
const ids = [], names = [], assumed = [];
for (const [i, n] of SHOWS.entries()) {
  if (IDS[i]) { ids.push(IDS[i]); names.push(n); assumed.push(null); continue; }
  const r = await arcmira.resolve(n, { type: "channel" });
  const e = r.best ?? r.suggested;
  if (!e) return { unresolved: n, ask: r.ask && { question: r.ask.question, options: r.ask.options.map(o => ({ ...o, channel_id: r.candidates.find(c => c.id === o.id)?.youtube_channel_id ?? null })) } };
  ids.push(e.youtube_channel_id);
  names.push(e.name);
  assumed.push(r.suggested ? r.suggested.evidence : null);
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
  shows: ids.map((id, i) => ({ name: names[i], channel_id: id, assumed: Boolean(assumed[i]), why: assumed[i], videos_indexed: [s0, s1][i].channel.searchable_videos, indexed_through: [s0, s1][i].channel.indexed_through, latest: [e0, e1][i].episodes[0]?.title ?? null,
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

When a plan or usage limit blocks a capability, briefly name the limit and any required tier reported by the API. Link to https://arcmira.com/pricing as "Plan access details" for information; do not initiate a purchase without explicit user authorization. Preserve error codes and reported quota or reset facts. If the user requested Premium, keep quality: "premium". Do not retry with captions, suggest third-party transcripts, or present them as equivalent. Only change the requested quality if the user asks.

PREMIUM PREPARATION. quote_transcript({video_id}) is a free whole-video quote. Read quote.rows and charge.unit/amount, plus max_on_demand_cents. A 15-minute quarter is 75 rows; credit mode uses four credits per row. A window never reduces the purchase price. With explicit user authorization, call prepare_transcript({video_id,max_rows,max_on_demand_cents,idempotency_key}) outside execute. Persist the key first; absent monetary ceiling means zero new on-demand cents. Same key and inputs recover an unknown response without a second purchase. POST returns {request,existing?}; inspect request.state and poll arcmira.status({jobId:request.id}) at request.nextPollSeconds. Premium GET ready has lines; pending has premium_job/status_url/next_poll_seconds; purchase_required is a refusal with quote/prepare URLs. refund_pending is unfinished recovery, not a completed refund. Never silently downgrade Premium to captions.

Never fill an index gap from memory or the web. Docs: https://arcmira.com/docs/mcp-server
