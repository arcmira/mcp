---
name: company-watch
description: "Watches a company or topic on podcasts and YouTube: what was said lately (shows, counts, momentum, quotes), then an Arcmira monitor to keep following it."
---

# Company watch

Answers "what was said about X lately" in one program, over the last 30 days unless the user names a window: episode counts per show from `occurrences`, the trend from `momentum`, the catalog notes from `mentions`, and quotes from `search` about the entity. Then it turns "keep me posted on X" into a monitor that delivers. Research picks the entity ids: a company or person through `resolve`, a topic through each of its spellings. The user's own monitors decide where they go: suggest one that fits, or create one after asking how they want updates. Only the save runs in `arcmira_execute_write`; everything before it reads.

Use it through the arcmira MCP server (`arcmira_describe`, then `arcmira_execute_read` with a program) or the arcmira CLI, whose commands have the same names. `arcmira_describe` carries the full method reference (CLI: `arcmira <command> --help`), and the `arcmira` skill the shared procedure.

## When to use

- what is being said about a company, product or brand lately, this month or this week, and is talk rising or fading
- did any show mention us, a competitor or an investor lately
- keep me posted on a company, a competitor, a person or a topic
- save what this research found to a monitor, or tell me when X comes up on a show
- watch a topic like "data center discourse" across shows

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

- Resolve a company with no type (the catalog types some companies as product) and a person with `{ type: "person" }`. A company name is often a common word ("Linear", "Ramp", "ICE"): name each pick, for example "Linear, the software company (product, ent_279443)", so the user can catch a wrong one before it is answered or saved.
- A topic has spellings. Resolve each variant with `{ type: "topic" }` ("data centers", "datacenters", "data centre", "data center") and keep every distinct id: one tracker per spelling catches what one would miss.
- Never assume a monitor exists ("Competitors" may not). Read `arcmira.monitors.list()` and the trackers of each candidate before suggesting one, and never add an entity a monitor already follows.

## Steps

1. What was said lately: run the first program and answer. Then offer to keep following the entity with a monitor; on a yes, go on.
2. Find what to follow and the monitors that could hold it: the second program, in `arcmira_execute_read`. Reuse ids the research already found instead of resolving again.
3. A monitor fits when its name or its trackers match the subject. Suggest it by name ("Add Linear to your Dev tools monitor?") and wait for a yes.
4. None fits: ask how the user wants updates, one question at a time, each with a default they can accept with "yes". First where: email to the account address (default) or Slack. Then when: as it happens, an hourly digest, or a daily digest (default daily). Then the name (default: the subject, like "Data center discourse").
5. Slack: the first program lists the connected workspaces (`slack`). With one, deliver there: `notify_slack: true`, its id as `slack_integration_id` and its `default_channel_id` as `slack_channel_id`; with several, ask which. With none, link https://arcmira.com/dashboard/integrations to connect one, and save with email for now, saying so; switch it later with `arcmira.monitors.update`.
6. Save with the third program, in `arcmira_execute_write`: create the monitor only when none fits (or set Slack on the one that fits), then `addEntities` with every id in one call. A name resolve found nothing for can still be followed by its exact name with `addName` (a show by its UC id), which catches it once a show says it.
7. Tell the user plainly about every id that did not attach. `entity_not_found`: Arcmira has no such entity; offer another spelling. `entity_type_not_trackable`: that kind of entity cannot be followed. `tracker_limit_reached`: the plan's tracker limit is full; pausing or removing trackers in the dashboard, or a higher plan, makes room. `tracked_in_another_monitor`: say which monitor already follows it (`current_monitor_name`) and ask before moving it; on a yes, `arcmira.monitors.attachTrackers(monitorId, [tracker_id])` in `arcmira_execute_write` moves it. When a result carries `canonical_entity_id`, the id was merged into that one; name the canonical entity.
8. Close with what arrives, where and when, and that `arcmira.monitors.update(id, { paused: true })` pauses it; nothing is deleted.

## Worked program

Pass each block to `arcmira_execute_read` as one program (a block marked arcmira_execute_write goes to that tool), with the name swapped for the user's. It opens with the pick: set `CONTEXT` to the user's own words about the name. When several entities fit it returns `ask` and runs nothing else. Show those options to the user, then run it again with `ID` set to the pick. When the result carries `assumed: true`, tell the user which entity was assumed and why (`why`). Build date windows from `arcmira.daysAgo(n)` and `arcmira.today()`.

### The last 30 days about one company (arcmira_execute_read)

```javascript
const NAME = "Linear", CONTEXT = undefined, ID = null;   // CONTEXT: the user's own words about the name, never a guess. After an ask, set ID to the picked option's id and run again
const r = ID ? null : await arcmira.resolve(NAME, { context: CONTEXT });
const e = r && (r.best ?? r.suggested);
if (r && !e) return { ask: r.ask };
const id = ID ?? e.id;
const assumed = Boolean(r?.suggested), why = r?.suggested?.evidence ?? null;
const after = arcmira.daysAgo(30);   // the user's window when they name one ("this week": 7)
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
  window: occ.window,
  momentum: { verdict: m.verdict, last_7d: m.volume.mentions_7d, last_30d: m.volume.mentions_30d, prior_30d: m.volume.mentions_prior_30d, as_of: m.as_of },
  shows: occ.rows.map(x => ({ show: x.channel_name, channel_id: x.channel_id, episodes: x.count, times_said: x.occurrences })),
  context: notes.mentions.map(x => ({ show: x.media.source_channel?.name ?? null, episode: x.media.title, date: x.media.published_at, note: x.description })),
  quotes_tagged_to_entity: quotesTagged,
  quotes: quotes.chunks.map(c => ({ said: c.text.slice(0, 300), show: c.channel_name, episode: c.video_title, date: c.published_at, url: c.watch_url })),
};
```

### Find what to follow, and the monitors that could hold it (arcmira_execute_read)

```javascript
const NAMES = ["Linear", "Height"], TOPICS = ["data centers", "datacenters", "data centre"];   // the user's subjects; TOPICS: every spelling of one topic
const follow = [], unresolved = [];
for (const n of NAMES) {
  const r = await arcmira.resolve(n);
  const e = r.best ?? r.suggested;
  if (e) follow.push({ name: e.name, id: e.id, type: e.type, assumed: Boolean(r.suggested), why: r.suggested?.evidence ?? null });
  else unresolved.push({ name: n, ask: r.ask ?? null });
}
for (const t of TOPICS) {
  const r = await arcmira.resolve(t, { type: "topic" });
  const e = r.best ?? r.suggested;
  if (e && !follow.some(f => f.id === e.id)) follow.push({ name: e.name, id: e.id, type: e.type, spelling: t });
}
const [{ monitors }, { integrations }] = await Promise.all([arcmira.monitors.list(), arcmira.integrations.slack()]);
const existing = await Promise.all(monitors.slice(0, 10).map(async m => ({
  id: m.id, name: m.name, paused: m.paused, frequency: m.notify_frequency, slack: Boolean(m.notify_slack),
  follows: (await arcmira.monitors.trackers(m.id)).trackers.map(t => t.display_name ?? t.entity_name),
})));
const slack = integrations.map(i => ({ slack_integration_id: i.id, workspace: i.team_name, slack_channel_id: i.default_channel_id, channel: i.channels.find(c => c.id === i.default_channel_id)?.name ?? null }));
return { follow, unresolved, monitors: existing, more_monitors: Math.max(0, monitors.length - 10), slack };
```

### Save to a monitor (arcmira_execute_write)

```javascript
const MONITOR_ID = null;   // a fitting monitor's id from the first program, or null to create one
const IDS = ["ent_279443"];   // every id the user agreed to follow
const NAMES = [];   // names resolve found nothing for that the user still wants followed: [{ name: "Acme Robotics", type: "organization" }]
const DELIVERY = { name: "Linear", notify_frequency: "daily" };   // the user's answers, for a new monitor
const SLACK = null;   // the user chose Slack: { slack_integration_id, slack_channel_id } from the first program's slack
const slack = SLACK ? { notify_slack: true, slack_integration_id: SLACK.slack_integration_id, ...(SLACK.slack_channel_id ? { slack_channel_id: SLACK.slack_channel_id } : {}) } : {};
const monitor = MONITOR_ID
  ? (SLACK ? (await arcmira.monitors.update(MONITOR_ID, slack)).monitor : { id: MONITOR_ID })
  : (await arcmira.monitors.create({ ...DELIVERY, ...slack })).monitor;
const { results } = IDS.length ? await arcmira.monitors.addEntities(monitor.id, IDS) : { results: [] };
const byName = [];
for (const n of NAMES) {
  try { byName.push(...(await arcmira.monitors.addName(monitor.id, [n])).results); }
  catch (err) { byName.push({ name: n.name, code: err.code, message: err.message }); }
}
const others = results.some(r => r.reason === "tracked_in_another_monitor") ? (await arcmira.monitors.list()).monitors : [];
return {
  monitor: { id: monitor.id, name: monitor.name ?? null, created: !MONITOR_ID, slack: Boolean(SLACK) },
  attached: results.filter(r => r.attached).map(r => ({ entity_id: r.canonical_entity_id ?? r.entity_id, merged_from: r.canonical_entity_id ? r.entity_id : null, new_tracker: r.created })),
  not_attached: results.filter(r => !r.attached).map(r => ({ entity_id: r.entity_id, reason: r.reason, tracker_id: r.tracker_id ?? null, current_monitor_id: r.current_monitor_id ?? null, current_monitor_name: others.find(m => m.id === r.current_monitor_id)?.name ?? null })),
  by_name: byName,
};
```

## A good answer

- For what was said: opens with the entity (name, type, id), gives the verdict with the 7-day and 30-day counts and `as_of`, the shows with episode counts for the stated window, and two or three quotes in the speakers' words, each with show, date and `watch_url`.
- Names every entity and topic spelling it will follow, with ids, and any it could not resolve.
- Suggests an existing monitor only after reading the user's monitors, and says which entities it already follows.
- Asks the delivery questions one at a time with a default each; for Slack, uses the connected workspace, or links the connection page and says the monitor uses email until then.
- Names every id that did not attach and why, and asks before moving a tracker another monitor holds.
- After saving, says what arrives, where and how often, and how to pause it.

## Traps

- Counts measure the shows Arcmira indexes, not the internet. An empty window means no indexed show said it; cite `as_of` before saying nothing happened. Count episodes with `occurrences`, never by counting `mentions` rows.
- Read episode titles and notes before asserting a lone mention: a title far from the company is a homonym the catalog mislabelled.
- Never create or change a monitor before the user agreed to where it goes and how it delivers.
- A monitor id comes from `monitors.list()`, never from a name the user said.
- `tracked_in_another_monitor` leaves the tracker where it is. Never move it without a yes.
- `insufficient_scope` means the sign-in lacks monitors:write or trackers:write: tell the user to reconnect Arcmira and allow monitor changes.
- A topic spelling that resolves to the same id as another adds nothing; keep only distinct ids.

When a plan or usage limit blocks a capability, briefly name the limit and any required tier reported by the API. Link to https://arcmira.com/pricing as "Plan access details" for information; do not upgrade a plan. Requested Premium work uses credits from the account's plan, then its on-demand budget, without another confirmation. Preserve error codes and reported quota or reset facts. If the user requested Premium, keep quality: "premium". Do not retry with captions, suggest third-party transcripts, or present them as equivalent. Only change the requested quality if the user asks.

Search as_of is the newest publication date among the returned passages, not the date the whole index was updated. For channel freshness, call arcmira.status({ channelId }) and report channel.search_indexed_through for transcript search. A result date or an empty query does not establish missing recent episodes.

Keep outside evidence separate from Arcmira results. Docs: https://arcmira.com/docs/mcp-server

## After the answer

When the answer named companies, people, shows or topics worth following, offer once to save them to a monitor so updates arrive on their own. On a yes, follow the `company-watch` skill: it lists the user's monitors first and asks how they want updates.

If anything was wrong, slow, or missing for the user, send one arcmira_feedback.
