---
name: sponsor-research
description: "Sponsor and ad-read research on podcasts and YouTube: who sponsors a show, or which shows a brand sponsors, how often, since when. Uses arcmira."
---

# Sponsor research

Two directions. A show to its sponsors: `arcmira.sponsors(channelId)` ranks recurring sponsors by ad reads with first and last seen dates. A brand to the shows it sponsors: `arcmira.recommendations(entityId, { kind: "sponsored" })` lists each ad read, which the program groups by show.

Use it through the arcmira MCP server (`describe`, then `execute` with a program) or the arcmira CLI, whose commands have the same names. The `arcmira` skill and `describe` carry the full method reference.

## When to use

- who sponsors a show, how many ad reads, since when, still active
- which shows a brand sponsors or advertises on, and how often
- sponsors two shows share (sponsors of each, then intersect by entity.id)

## Pick the entity the user meant

Users give names; filters take ids only (ent_..., UC..., 11-character video ids), and a name where an id belongs throws `id_required`.

1. Resolve the exact name the user said. `best` is only a guess when other candidates are close: "Sam" resolves to a bare "Sam" row while Sam Altman has sixteen times the appearances, and "Chamath" returns no `best` and several spellings of one person.
2. Weigh `best` against the other candidates and against what the user said around the name (the OpenAI CEO, a sponsor, a show). One candidate fits: use it.
3. Two or more fit: either check each against the data (run the query for each and keep the one the context and the data support), or stop and show the user a short list, one line per candidate: name, type, and one distinguishing fact (appearance count or top show), then ask which.
4. Nothing close (a show typed "All In"): retry with spelling variants ("All-In", "All-In Podcast") before you ask.
5. Say which entity the answer is about (name, type, id) in the answer, and name any close candidate you set aside. Never switch entities silently.

For this task:

- A show resolves with `{ type: "channel" }`; its id is `youtube_channel_id` (a UC id).
- A brand resolves with no type (a company can be typed product). A sponsor is a company: a person or a topic with the same name ("Freddie Mercury") is not the brand.
- When two company rows compete, the one with ad reads is the sponsor: run the brand program for each and keep the one with reads.

## Worked program

Pass each block to `execute` as one program, with the name swapped for the user's. It opens with the pick: when close candidates compete it returns `choose` and runs nothing else. Pick from that list by the user's context or ask them, then run it again with `ID` set to the pick. Build date windows from `arcmira.daysAgo(n)` and `arcmira.today()`.

### A show's sponsors

```javascript
const NAME = "TBPN", ID = null;   // after a choose list, set ID to the pick and run again
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const r = ID ? null : await arcmira.resolve(NAME, { type: "channel", limit: 10 });
const close = r ? r.candidates.filter(c => c.youtube_channel_id && c.youtube_channel_id !== r.best?.youtube_channel_id && norm(c.name).includes(norm(NAME)) && c.appearance_count * 4 >= (r.best?.appearance_count ?? 0)).sort((a, b) => b.appearance_count - a.appearance_count) : [];
if (r && (!r.best || !r.best.youtube_channel_id || close.length > 0)) return { choose: [r.best, ...close].filter(c => c && c.youtube_channel_id).slice(0, 5).map(c => ({ id: c.youtube_channel_id, name: c.name, type: c.type, appearances: c.appearance_count })) };
const id = ID ?? r.best.youtube_channel_id;
const s = await arcmira.sponsors(id);   // limit is a Pro+ filter; slice instead
return {
  show: s.channel.name, channel_id: id, page: s.channel.page, sponsors_total: s.meta.total,
  sponsors: s.sponsors.slice(0, 10).map(x => ({ name: x.entity.name, id: x.entity.id, page: x.entity.page, ad_reads: x.ad_reads, episodes: x.videos, first_seen: x.first_seen, last_seen: x.last_seen, status: x.sponsor_status?.status ?? null })),
};
```

### The shows a brand sponsors, last 90 days

```javascript
const NAME = "Mercury", ID = null;   // after a choose list, set ID to the pick and run again
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const r = ID ? null : await arcmira.resolve(NAME, { limit: 10 });
const close = r ? r.candidates.filter(c => c.id && c.id !== r.best?.id && norm(c.name).includes(norm(NAME)) && c.appearance_count * 4 >= (r.best?.appearance_count ?? 0)).sort((a, b) => b.appearance_count - a.appearance_count) : [];
if (r && (!r.best || !r.best.id || close.length > 0)) return { choose: [r.best, ...close].filter(c => c && c.id).slice(0, 5).map(c => ({ id: c.id, name: c.name, type: c.type, appearances: c.appearance_count })) };
const id = ID ?? r.best.id;
const after = arcmira.daysAgo(90);
const reads = [];
let cursor, entity;
do {
  const page = await arcmira.recommendations(id, { kind: "sponsored", after, limit: 50, cursor });
  entity = page.entity;
  reads.push(...page.data);
  cursor = page.has_more ? page.next_cursor : undefined;
} while (cursor && reads.length < 500);
const shows = new Map();
for (const x of reads) {
  const name = x.media.source_channel?.name ?? x.media.channel_id;
  const row = shows.get(name) ?? { show: name, channel_id: x.media.channel_id, ad_reads: 0, episodes: new Set(), latest: "" };
  row.ad_reads += 1;
  row.episodes.add(x.media.video_id);
  if (x.media.published_at > row.latest) row.latest = x.media.published_at;
  shows.set(name, row);
}
return {
  brand: { id, name: entity?.name ?? NAME, type: entity?.type ?? null }, window: { after, through: arcmira.today() }, ad_reads_total: reads.length,
  shows: [...shows.values()].sort((a, b) => b.ad_reads - a.ad_reads).slice(0, 10).map(s => ({ ...s, episodes: s.episodes.size })),
  sample_read: reads[0] ? { said: reads[0].verbatim_quote, show: reads[0].media.source_channel?.name ?? null, date: reads[0].media.published_at, promo_code: reads[0].promo_code } : null,
};
```

## A good answer

- Names the brand or show it used, with its type and id, and any look-alike it set aside.
- Ranks sponsors (or shows) by ad reads and gives the counts, first and last seen dates, and active or lapsed.
- States the window and the as-of date, and that counts cover the shows Arcmira indexes.
- Quotes one ad read verbatim with its promo code when there is one, and links each name to the `page` the result carries.

## Traps

- `recommendations` is a paid method: a free key throws `recommendations_not_enabled` with `.unlock.url`. Relay the link and answer the show direction with `sponsors`.
- An ad read is sponsored; an unpaid on-air endorsement is `kind: "organic"`. Do not mix them in one count.
- Page with `cursor` until `has_more` is false before you count reads; one page is at most 50 rows.

Plan gates throw with `.unlock.url`: relay the link. Never fill a gap from memory or the web. Docs: https://arcmira.com/docs/mcp-server
