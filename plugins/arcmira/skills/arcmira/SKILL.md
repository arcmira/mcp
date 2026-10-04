---
name: arcmira
description: "Answers what YouTube shows and podcasts said: transcripts, who was mentioned, sponsors, recommendations, momentum. Use for the arcmira MCP server or CLI."
---

# Arcmira

Arcmira indexes YouTube and podcast transcripts and keeps a catalog of who is mentioned on which show, who sponsors whom, and who recommends what on air. The arcmira MCP server exposes four tools. `arcmira_describe` returns the client reference: every method with its arguments and return fields, worked programs, quirks and error codes. `arcmira_execute_read` runs a JavaScript program against the `arcmira` client and returns what the program returns; Premium transcripts included. `arcmira_execute_write` runs the same client plus the monitor writes. `arcmira_feedback` tells Arcmira what went wrong. The arcmira CLI has commands with the same names; `arcmira <command> --help`, `arcmira schema <command>` and `arcmira examples` are its reference.

## When to use

Use this skill when the user asks:

- what a show, channel, or episode said about a topic, or for a transcript;
- whether a person, company, or product was mentioned, how often, and where;
- who sponsors a show, or which shows a brand sponsors;
- who recommends a product on air, sponsored or organic;
- whether talk about something is accelerating or fading;
- to be kept posted on a company, person or topic;
- how to use the arcmira MCP server or the arcmira CLI.

Use Arcmira for the indexed transcript research the user requested. Cite returned passages and keep evidence from other sources distinct. An empty result means this query returned no matches.

## Task skills

When the ask matches one of these, load that skill and follow its worked program:

- `sponsor-research`: Sponsor and ad-read research on podcasts and YouTube: who sponsors a show, or which shows a brand sponsors, how often, since when.
- `company-watch`: Watches a company or topic on podcasts and YouTube: what was said lately (shows, counts, momentum, quotes), then an Arcmira monitor to keep following it.
- `find-quotes`: Finds exact spoken quotes and clip-ready moments on podcasts and YouTube: verbatim words, speaker, date, a timestamped link, clip start and end.
- `person-research`: Researches a person across podcasts and YouTube for interview or meeting prep: where they appeared, their own words, who discusses them.
- `compare-shows`: Compares two podcasts or YouTube shows side by side: size, latest episode, what each talks about, what both cover, and shared sponsors.

Anything else (one video's transcript, a topic across shows, who recommends a product on air) follows the procedure below.

## Procedure

1. Call `arcmira_describe` once before your first program. It is current on every call; `arcmira_describe({ topic })` narrows it to one method.
2. Resolve every name in the question with `arcmira.resolve`, passing the user's own words about the name as `context` when they gave any. Filters take ids only.
3. Act on the one answer resolve gives. `best`: use it and name it. `suggested`: use it and tell the user you assumed it, quoting `suggested.evidence`. `ask`: return `ask.options` for the user to pick and stop, or check every option id against the data in one program and answer per row. None of the three: the name is not in the index; say so and ask for another spelling or a link. Say in the answer which entity you used.
4. Before asserting a mention, read its description or passage and say which sense of the name it is (Mercury the bank, not the element).
5. Write one `arcmira_execute_read` program per question. Resolve, check, and run every query the question needs inside that one program.
6. Return only the fields the answer needs, not whole responses.
7. Search as_of is the newest publication date among the returned passages, not the date the whole index was updated. For channel freshness, call arcmira.status({ channelId }) and report channel.search_indexed_through for transcript search. A result date or an empty query does not establish missing recent episodes. Build date windows from `arcmira.today()` and `arcmira.daysAgo(n)`. When the user names no window, use the last 30 days; a week of the index is often thin.
8. Link each name in the answer to the `page` field the result carries. Do not build arcmira.com URLs by hand.
9. Premium: `arcmira.transcript(video, { quality: "premium" })` returns the lines. When the video is not transcribed yet, that read uses credits from the user's plan, then the on-demand budget. A Premium request is the go-ahead; do not ask. Still pending: tell the user the `eta_seconds` it returns, then read again once it has passed.
10. Paid reads use credits from the account's plan, then the on-demand budget the account set in the dashboard. That budget is the approval, so never ask the user for a cents amount. When the budget or plan blocks a read (spend_limit_exceeded, quota_exceeded, a plan gate), tell the user to raise the on-demand budget at https://arcmira.com/dashboard/spending or upgrade the plan at https://arcmira.com/pricing (not on Ultra or Enterprise), and link unlock.url when the refusal carries one.

## Monitors

MONITORS. Never assume a monitor exists ("Competitors" may not). To follow entities the research found: list the user's monitors with arcmira.monitors.list() and suggest any whose name or trackers fit. If none fits, ask how they want updates, one question at a time, each with a default: email (default) or Slack, then as it happens, an hourly digest or a daily digest (default daily). For Slack, read arcmira.integrations.slack(): with a workspace, set notify_slack: true, its id as slack_integration_id and its default_channel_id as slack_channel_id; with none, link https://arcmira.com/dashboard/integrations to connect one and use email for now, saying so. For a topic, resolve its spelling variants ("data centers", "datacenters", "data centre") and follow every one that is its own topic id. Then in arcmira_execute_write: arcmira.monitors.create when there is no fit, and arcmira.monitors.addEntities with every id in one call. A name that resolves to nothing can still be followed by its exact name with arcmira.monitors.addName(monitorId, [{ name, type }]); a show by its UC id. Tell the user about every result with attached: false: entity_not_found, entity_type_not_trackable, tracker_limit_reached, or tracked_in_another_monitor (name the monitor at current_monitor_id and ask before moving it with arcmira.monitors.attachTrackers). Pause with arcmira.monitors.update(id, { paused: true }); there is no delete. Each alert uses 25 credits from your plan, then your on-demand budget; creating a monitor is free.

## The ID rule

```
ID RULE. Filters take verbatim ids only: entity ids look like ent_14, channel ids like UC-DRzaGnL_vtBUpCFH5M0tg (UC plus 22 characters), video ids are 11 characters or a YouTube URL. A name where an id belongs throws id_required before any network call. Resolve first, then query:
  const r = await arcmira.resolve("Sam", { context: "the My First Million co-host" });
  const e = r.best ?? r.suggested;          // for a show: resolve with { type: "channel" } and use e.youtube_channel_id
  if (!e) return { ask: r.ask };            // r.ask.options: [{ id, name, type, label }]
RESOLVE ANSWERS ONE OF THREE. best: the name means that row; use it and name it. suggested: no row is certain but one stands out (suggested.reason, suggested.evidence); use it and tell the user you assumed it, quoting the evidence ("Sam Altman, assuming the most mentioned Sam: 4,399 appearances, 11x the next"). ask: several rows fit and none stands out; return ask.options for the user to pick and stop, or check every option id against the data in one program (occurrences or momentum with all the ids) and answer per row, naming each. Resolve the exact name the user said ("ICE", "Mercury"), not a paraphrase, and always pass context with the user's own words about the name when they gave any ("Sam, the My First Million co-host" is resolve("Sam", { context: "the My First Million co-host" })). Context is only words from the user's message, never your own guess: a bare "Theo" is resolve("Theo") with no context, never "Theo Von" or context "the comedian", and its ask goes back to the user. Omit type for a brand (the catalog types some companies as product). A name that resolves to nothing (no best, suggested or ask) is not in the Arcmira index: say so and ask for another spelling or a link; never answer for a different entity without saying so. Always say in the answer which entity you used.
```

## Access

When a plan or usage limit blocks a capability, briefly name the limit and any required tier reported by the API. Link to https://arcmira.com/pricing as "Plan access details" for information; do not upgrade a plan. Requested Premium work uses credits from the account's plan, then its on-demand budget, without another confirmation. Preserve error codes and reported quota or reset facts. If the user requested Premium, keep quality: "premium". Do not retry with captions, suggest third-party transcripts, or present them as equivalent. Only change the requested quality if the user asks.

## Docs

- API reference: https://arcmira.com/docs/api-reference
- MCP guide: https://arcmira.com/docs/mcp-server
- Error codes: https://arcmira.com/docs/errors
- OpenAPI: https://api.arcmira.com/v1/openapi.json
- Agent index: https://arcmira.com/llms.txt

## After the answer

When the answer named companies, people, shows or topics worth following, offer once to save them to a monitor so updates arrive on their own. On a yes, follow the `company-watch` skill: it lists the user's monitors first and asks how they want updates.

If anything was wrong, slow, or missing for the user, send one arcmira_feedback.
