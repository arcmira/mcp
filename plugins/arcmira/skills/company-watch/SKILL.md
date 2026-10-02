---
name: company-watch
description: "Sets up Arcmira monitors: finds the companies, people and topic spellings to follow, then saves them to the right monitor with the delivery the user wants."
---

# Company watch: set up a monitor

Turns "keep me posted on X" into a monitor that delivers. Research picks the entity ids: a company or person through `resolve`, a topic through each of its spellings. The user's own monitors decide where they go: suggest one that fits, or create one after asking how they want updates. Only the save runs in `arcmira_execute_write`; everything before it reads.

Use it through the arcmira MCP server (`arcmira_describe`, then `arcmira_execute_read` with a program) or the arcmira CLI, whose commands have the same names. `arcmira_describe` carries the full method reference (CLI: `arcmira <command> --help`), and the `arcmira` skill the shared procedure.

## When to use

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

- Resolve a company with no type (the catalog types some companies as product) and a person with `{ type: "person" }`. Name each pick so the user can catch a wrong one before it is saved.
- A topic has spellings. Resolve each variant with `{ type: "topic" }` ("data centers", "datacenters", "data centre", "data center") and keep every distinct id: one tracker per spelling catches what one would miss.
- Never assume a monitor exists ("Competitors" may not). Read `arcmira.monitors.list()` and the trackers of each candidate before suggesting one, and never add an entity a monitor already follows.

## Steps

1. Find what to follow and the monitors that could hold it: the first program below, in `arcmira_execute_read`. Reuse ids the research already found instead of resolving again.
2. A monitor fits when its name or its trackers match the subject. Suggest it by name ("Add Linear and Height to your Competitors monitor?") and wait for a yes.
3. None fits: ask how the user wants updates, one question at a time, each with a default they can accept with "yes". First where: email to the account address (default) or Slack. Then when: as it happens, an hourly digest, or a daily digest (default daily). Then the name (default: the subject, like "Data center discourse").
4. Slack needs the workspace connected first at https://arcmira.com/dashboard/integrations: link it and wait until the user says it is done. Reuse the `slackIntegration.id` an existing monitor shows as `slackIntegrationId`. When no monitor shows one, create the monitor with email and tell the user to switch its delivery to Slack in the dashboard.
5. Save with the second program, in `arcmira_execute_write`: create the monitor only when none fits, then `addEntities` with every id in one call. Report each id as attached, already followed, or refused with its reason.
6. Close with what arrives, where and when, and that `arcmira.monitors.update(id, { isPaused: true })` pauses it; nothing is deleted.

## Worked program

Pass each block to `arcmira_execute_read` as one program (a block marked arcmira_execute_write goes to that tool), with the name swapped for the user's. It opens with the pick: set `CONTEXT` to the user's own words about the name. When several entities fit it returns `ask` and runs nothing else. Show those options to the user, then run it again with `ID` set to the pick. When the result carries `assumed: true`, tell the user which entity was assumed and why (`why`). Build date windows from `arcmira.daysAgo(n)` and `arcmira.today()`.

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
const { monitors } = await arcmira.monitors.list();
const existing = await Promise.all(monitors.slice(0, 10).map(async m => ({
  id: m.id, name: m.name, paused: m.isPaused, frequency: m.notifyFrequency, slack: m.slackIntegration ?? null,
  follows: (await arcmira.monitors.trackers(m.id)).trackers.map(t => t.displayName ?? t.entityName),
})));
return { follow, unresolved, monitors: existing, more_monitors: Math.max(0, monitors.length - 10) };
```

### Save to a monitor (arcmira_execute_write)

```javascript
const MONITOR_ID = null;   // a fitting monitor's id from the first program, or null to create one
const IDS = ["ent_279443"];   // every id the user agreed to follow
const DELIVERY = { name: "Competitors", notifyFrequency: "daily" };   // the user's answers; Slack: add notifySlack: true and slackIntegrationId
const monitor = MONITOR_ID ? { id: MONITOR_ID } : (await arcmira.monitors.create(DELIVERY)).monitor;
const saved = await arcmira.monitors.addEntities(monitor.id, IDS);
return { monitor: { id: monitor.id, name: monitor.name ?? null, created: !MONITOR_ID }, results: saved.results };
```

## A good answer

- Names every entity and topic spelling it will follow, with ids, and any it could not resolve.
- Suggests an existing monitor only after reading the user's monitors, and says which entities it already follows.
- Asks the delivery questions one at a time with a default each, and links the Slack connection page before choosing Slack.
- After saving, says what arrives, where and how often, and how to pause it.

## Traps

- Never create or change a monitor before the user agreed to where it goes and how it delivers.
- A monitor id comes from `monitors.list()`, never from a name the user said.
- `insufficient_scope` means the sign-in lacks monitors:write or trackers:write: tell the user to reconnect Arcmira and allow monitor changes.
- A topic spelling that resolves to the same id as another adds nothing; keep only distinct ids.

When a plan or usage limit blocks a capability, briefly name the limit and any required tier reported by the API. Link to https://arcmira.com/pricing as "Plan access details" for information; do not upgrade a plan. Requested Premium work uses included credits, then on-demand within the account's budget, without another confirmation. Preserve error codes and reported quota or reset facts. If the user requested Premium, keep quality: "premium". Do not retry with captions, suggest third-party transcripts, or present them as equivalent. Only change the requested quality if the user asks.

Search as_of is the newest publication date among the returned passages, not the date the whole index was updated. For channel freshness, call arcmira.status({ channelId }) and report channel.search_indexed_through for transcript search. A result date or an empty query does not establish missing recent episodes.

Keep outside evidence separate from Arcmira results. Docs: https://arcmira.com/docs/mcp-server

## After the answer

When the answer named companies, people, shows or topics worth following, offer once to save them to a monitor so updates arrive on their own. On a yes, follow the `company-watch` skill: it lists the user's monitors first and asks how they want updates.

If anything was wrong, slow, or missing for the user, send one arcmira_feedback.
