# Arcmira MCP for YouTube and podcast transcript search

Search YouTube video and podcast transcripts, retrieve timestamped quotes, find entity mentions and media appearances, inspect organic endorsements and ad reads, and monitor new mentions with your agent.

[Arcmira](https://arcmira.com) · [API docs](https://arcmira.com/docs) · [MCP setup](https://arcmira.com/docs/mcp-server)

## Connect Arcmira

Add the remote MCP server at `https://mcp.arcmira.com/mcp` and sign in through your host. For setup instructions, use [Connect your agent](https://arcmira.com/agent-setup).

For a coding agent, paste:

```text
Fetch and execute the appropriate instructions to set me up for Arcmira from https://arcmira.com/agent-setup/prompt.md
```

## Run your first search

Ask your agent:

> Search YouTube and podcast transcripts for GPU financing over the last 60 days. Return the relevant quotes with speakers when available, publication dates, transcript sources, and timestamped links. Read the surrounding exchanges before summarizing what the sources imply.

The agent calls `arcmira_describe` once to load the client reference, then runs a program with `arcmira_execute_read`. Return structured fields for further analysis and a compact, sourced answer for the reader.

```javascript
const query = "GPU financing";
const hits = await arcmira.search({
  query, after: arcmira.daysAgo(60), before: arcmira.today(), limit: 5,
});
return { query, window: hits.window, passages: hits.chunks };
```

The search supports up to 20 passages, but full passages can exceed the execute tool's output budget. If the result is truncated, request fewer passages or return only the fields needed for the next step. Keep selected text intact and retain its source link.

## Choose the method for the task

| Task | Client method | What to retain |
| --- | --- | --- |
| Search YouTube and podcast transcripts for quotes | `arcmira.search` | Passage text, attribution when available, publication date, watch URL |
| Read the surrounding transcript | `arcmira.transcript` | State, timestamped lines, source, speaker mapping |
| Find mentions of a person, company, product or topic | `arcmira.mentions` | Entity, description, source video, position, appearance flag |
| Count a person's media appearances | `arcmira.occurrences` with `mode: "appearances"` | Counted window, episode counts by channel |
| Compare mention momentum | `arcmira.momentum` | Current/prior counts, change, verdict, returned window |
| Find organic endorsements or ad reads | `arcmira.recommendations` | Classification, verbatim quote, source and position |
| Find recurring channel sponsors | `arcmira.sponsors` | Sponsor, ad-read count, video count, first/latest dates |
| Set up YouTube monitoring | `arcmira.monitors` through `arcmira_execute_write` | Monitor, tracked entities, delivery settings |

Resolve names before applying entity or channel ID filters. Plain keyword search does not need a resolver call. The MCP client's argument names differ from the HTTP and SDK names; use the reference returned by `arcmira_describe`.

## Continue the research

[Continue the investment research workflow](https://arcmira.com/docs/workflows/investment-research). You will learn how to follow a search result into competing explanations, inspect the surrounding exchange, verify claims against disclosures, and write a brief with the questions that remain unresolved.

Speaker identification and commercial classifications can be incomplete. Check the linked source. Missing a source or a capability your workflow needs? Use `arcmira_feedback` to describe it, why it matters, and what better support would be worth. [Help shape the index](https://arcmira.com/docs/feedback#help-shape-the-index).

[Plugin and skills](plugins/arcmira) · [Share plugin feedback](https://github.com/arcmira/mcp/issues/new?template=plugin-feedback.yml) · [Update installed skills](plugins/arcmira#keep-it-updated)

## Authentication options

Two ways in. Hosts that speak the MCP authorization spec sign you in; everything else sends a key.

**Sign in through the host.** Add `https://mcp.arcmira.com/mcp` with no key. The server answers 401 with an OAuth challenge, the host registers itself against `api.arcmira.com`, opens arcmira.com for sign-in and consent, and connects with a token that carries the permissions you allowed. Tokens refresh on their own; revoke a host under Settings, Connected apps.

```bash
claude mcp add --transport http --scope user arcmira https://mcp.arcmira.com/mcp
```

```bash
codex mcp add arcmira --url https://mcp.arcmira.com/mcp
```

Claude Desktop, claude.ai, ChatGPT, and Cursor: add the URL as a custom connector or MCP server with no headers and follow the sign-in prompt. Per-host steps are on https://arcmira.com/agent-setup.

**Send a key.** Any client that cannot do the sign-in sends a bearer token instead, and the server skips OAuth.

An account key (`arc_sk_...`) comes from https://arcmira.com. Plan and scopes decide what each tool returns. With no account and no browser, sign up from the API. Post an email address, then post the six digit code from that inbox back.

```bash
curl -X POST "https://api.arcmira.com/v1/signups?src=mcp-tool" \
  -H 'Content-Type: application/json' \
  -d '{"email":"agent@example.com"}'

curl -X POST "https://api.arcmira.com/v1/signups/verify" \
  -H 'Content-Type: application/json' \
  -d '{"email":"agent@example.com","code":"482913"}'
```

```bash
claude mcp add --transport http --scope user arcmira https://mcp.arcmira.com/mcp --header "Authorization: Bearer $ARCMIRA_API_KEY"
```

```json
{
  "mcpServers": {
    "arcmira": {
      "url": "https://mcp.arcmira.com/mcp",
      "headers": { "Authorization": "Bearer arc_sk_..." }
    }
  }
}
```

The 401 body carries that signup call under `error.data.unlock.action`, so an agent that cannot sign in can create an account and reconnect. Discovery: `https://mcp.arcmira.com/.well-known/oauth-protected-resource` names the authorization server; `https://api.arcmira.com/.well-known/oauth-authorization-server` lists its endpoints.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `arcmira_describe` | `topic?` | The arcmira client reference: the id rule, which method answers which question, every method with arguments and return fields, worked example programs, the quirks that cost answers, the usage and monitor rules, error codes, and doc links. About 25,000 characters; `topic` narrows it to one method and its examples. Never bills. |
| `arcmira_execute_read` | `code` | What the program printed plus its return value. The code is the body of an async function with `arcmira` and `ArcmiraError` in scope. Reads, Premium transcripts included, and the user's monitors. Limits: 30 seconds, 40 API calls, and 12,000 characters of output in total, 3,000 per string, and 100 items per array. |
| `arcmira_execute_write` | `code` | The same as `arcmira_execute_read`, with the account writes added: `arcmira.monitors.create`, `arcmira.monitors.update` (including `paused`), `arcmira.monitors.addEntities`, `arcmira.monitors.addName` and `arcmira.monitors.attachTrackers`. Nothing is deleted. |
| `arcmira_feedback` | `category`, `note`, `request_id?`, `call_id?` | One `POST /v1/feedback` of type `experience`. `category` is `wrong_entity`, `bad_data`, `missing`, `slow`, `confusing` or `other`; `note` says what happened. Returns the feedback id. |

Every tool also takes an optional `intent`, at most 300 characters: the user's request in a few words. A host that omits it loses nothing. See [What we log](#what-we-log).

Only `arcmira_describe` is annotated read-only. Both program tools can start Premium transcription, which uses credits from the plan and then the on-demand budget, so neither is read-only. Only `arcmira_execute_write` is destructive, because it can overwrite monitor settings and pause monitors; a Premium read only adds. Both can request arbitrary public videos and carry open-world annotations. Feedback adds a stored record and is an additive write. These labels describe possible effects; the `execute_read` name identifies the client access level, not a guarantee of no side effects.

Metered reads use credits from your plan, then the on-demand budget you set in the dashboard. Arcmira enforces that budget on every read, and no tool takes a spending amount. A search uses 4 credits per passage it returns past the first 5, a captions read 4 credits per started 15 minutes of its window, and a Premium transcript 300 credits per started 15 minutes of the whole video. A Premium read that starts a transcription reports its `charge` (credits, and whether they came from the plan, on-demand usage, or both). `arcmira.quote(video)` returns that price beforehand and uses no credits; it is a price check, not a spoken quote. When the plan or budget blocks a read, the tool result is an error (`isError: true`) with the API's `code` (`paid_plan_required`, `quota_exceeded`, `spend_limit_exceeded`, `member_limit`, `fair_use_cap` or `on_demand_paused`), a `message` that states what was reached and what lifts it, and `unlock` when a plan or setting change lifts it. The server gives the agent these facts, not a script for what to say.

A Premium transcript is one read in `arcmira_execute_read`:

```javascript
const t = await arcmira.transcript("cdLeJU_1UH8", { quality: "premium" });
return t.state === "ready" ? t.lines : { state: t.state, eta_seconds: t.eta_seconds, note: t.note };
```

When the video is not transcribed yet, `GET /v1/transcripts/{video_id}?quality=premium` starts transcribing it and answers `202` with the job and `Retry-After`. The client reads again at `Retry-After` until 22 seconds into the program, a wait all Premium reads in one program share. Reading again never uses credits twice. Still `pending` after that: the result carries `eta_seconds`, and the same read in a later program returns the lines. A failed transcription comes back as `state` `failed` or `refunded` with the reason, and the read does not start another unless it passes `retry: true`, which an agent sends only when the user asks. A plan without Premium throws `paid_plan_required`; a budget that blocks the read throws `spend_limit_exceeded` or `quota_exceeded`, and the price rides on the error as `quote`. `start` and `end` never lower a Premium charge.

Results that are empty, an error, truncated or a resolve `ask` carry `call_id` (`mcpc_...`), which `arcmira_feedback` takes to name the call.

The client covers the same tasks as the CLI and SDKs. Argument names differ; use these MCP signatures:

| Method | Fronts | Use it for |
|---|---|---|
| `arcmira.resolve(q, { type?, context?, limit? })` | `GET /v1/entities/resolve` | A name, `@handle`, URL or `UC` id to one of three answers: `best`, `suggested` (with `reason` and `evidence`), or `ask` with options |
| `arcmira.search({ query, channelIds?, about?, speakerIds?, kind?, entityIds?, after?, before?, source?, limit? })` | `GET /v1/search` | Spoken slices for one topic, or about an entity, or spoken by a person, with watch links and dates |
| `arcmira.mentions({ entityId, channelId?, mode?, after?, before?, limit?, cursor? })` | `GET /v1/mentions` | Has X mentioned Y, first seen, last seen. `mode`: `both` (default), `mentions`, or `appearances` (people only). |
| `arcmira.momentum(entityId, { days? })` | `GET /v1/entities/{id}/momentum` | The last `days` (7 to 365, default 30) against the prior `days`, with a verdict and top shows for that window. 10 credits a call. |
| `arcmira.sponsors(channelId, { minAdReads?, status?, limit? })` | `GET /v1/channels/{id}/sponsors` | Recurring sponsors of one show |
| `arcmira.recommendations(entityId, { kind?, channelId?, after?, before?, limit?, cursor? })` | `GET /v1/recommendations?entity_id=` | Who recommends one entity, sponsored or organic, with the quote |
| `arcmira.episodes(channelId, { limit?, after?, before? })` | `GET /v1/channels/{id}/videos` | Newest indexed episodes, with the `video_id` the others take |
| `arcmira.transcript(videoIdOrUrl, { quality?, language?, timestamps?, start?, end? })` | `GET /v1/transcripts/{video_id}`, read again at `Retry-After` while a Premium transcription is pending | The transcript of one video, captions or Premium, whole or a window |
| `arcmira.occurrences({ channelIds?, entityIds?, videoIds?, types?, mode?, after?, before?, limit? })` | `GET /v1/mentions/counts` | What shows talk about, what they share, what one episode mentions. `mode`: `mentions`, `appearances`, or `both`; `limit`: 1 to 40. |
| `arcmira.quote(videoIdOrUrl)` | `GET /v1/transcripts/{video_id}/quote` | A price check, not a spoken quote: the credits a Premium read of the whole video would use, and any on-demand cents. Uses no credits |
| `arcmira.status({ channelId? })` | `GET /v1/channels/{id}/coverage`, `GET /v1/me` | Coverage and the index date, or the account the key spends (`account`, `role`), plan, credits and on-demand budget |
| `arcmira.monitors.list()` | `GET /v1/monitors` | The user's monitors, with delivery settings and tracker counts |
| `arcmira.monitors.trackers(monitorId)` | `GET /v1/monitors/{id}/trackers` | What one monitor already follows |
| `arcmira.monitors.create({ name, notify_frequency, notify_emails?, notify_slack?, ... })` | `POST /v1/monitors` | A new monitor. Write tool only |
| `arcmira.monitors.update(monitorId, { ..., paused? })` | `PATCH /v1/monitors/{id}` | Delivery changes, or a pause. Write tool only |
| `arcmira.monitors.addEntities(monitorId, entityIds, { personMatchMode? })` | `POST /v1/monitors/{id}/entities` | Follows up to 90 entity ids in one call: reuses or creates each tracker by id and attaches it. An id that cannot attach says why (`entity_not_found`, `entity_type_not_trackable`, `tracker_limit_reached`, `tracked_in_another_monitor`). Write tool only |
| `arcmira.monitors.addName(monitorId, [{ name, type, personMatchMode? }])` | `POST /v1/monitors/{id}/entities` with `names` | Follows up to 90 exact names before they are indexed (a show by its `UC` id), with one result per name as `addEntities` gives. Write tool only |
| `arcmira.monitors.attachTrackers(monitorId, trackerIds)` | `POST /v1/monitors/{id}/trackers` | Moves trackers another monitor holds, after the user agrees. Write tool only |
| `arcmira.integrations.slack()` | `GET /v1/integrations/slack` | The connected Slack workspaces, with the id and default channel a monitor delivers to |

`arcmira.today()` and `arcmira.daysAgo(n)` give ISO dates from the server clock for date windows. Windows are half-open, as on the API: `after` is the first day counted and `before` the first day left out, so August is `{ after: "2026-08-01", before: "2026-09-01" }`. Every dated result echoes `window: { after, before }`. Option names are the client's; request and response fields are the API's, so a monitor takes `notify_frequency` because `monitors.list()` returns it.

Filters take verbatim ids only. A name where an id belongs throws `id_required` before any network call, and the message names the fix. Resolve first, then query. `resolve` answers `best` (the name means one row), `suggested` (one row stands out; say you assumed it and why), or `ask` (several fit; let the user pick):

```javascript
const r = await arcmira.resolve("Linear");
const e = r.best ?? r.suggested;
if (!e) return { ask: r.ask };
const m = await arcmira.momentum(e.id);
return { entity: e.name, id: e.id, assumed: Boolean(r.suggested), why: r.suggested?.evidence ?? null, verdict: m.verdict, last30: m.volume.mentions_30d, prior30: m.volume.mentions_prior_30d, as_of: m.as_of };
```

Example prompts once the server is connected:

- Which brands sponsor both TBPN and the All-In Podcast?
- How hot is Linear, the project management tool, on the spoken web right now?
- Find a moment on TBPN from the last 90 days where someone talks about stablecoins, and quote it.
- Who is speaking in the first minute of the latest TBPN episode, according to the Premium transcript?
- On TBPN, how many episodes mentioned Cursor in July versus August?

Good first ids: TBPN is channel `UC-DRzaGnL_vtBUpCFH5M0tg`, All-In Podcast is `UCESLZhusAkFfsNsApnjF_Cg`, Ramp is `ent_14`.

## The sandbox

`arcmira_execute_read` and `arcmira_execute_write` run the program in a fresh [Dynamic Worker](https://developers.cloudflare.com/dynamic-workers/) isolate. The isolate's only network is the parent's outbound proxy, which adds the caller's credential to what it forwards, so the program never holds the key, and refuses anything outside the tool's allowlist with `outbound_refused`:

- `arcmira_execute_read`: `GET https://api.arcmira.com/v1/*`. A Premium transcription starts inside the transcript `GET`.
- `arcmira_execute_write`: the read set, plus `POST` and `PATCH` under `/v1/monitors` and `PATCH` under `/v1/trackers`. Never `DELETE`, and never the webhook secret rotation. A tracker is created inside a monitor, so nothing posts to `/v1/trackers`.

The proxy enforces this in the Worker, so a raw `fetch()` gets the same answer as a client method. A write method called from `arcmira_execute_read` throws `write_tool_required` before any request. The isolate gets 5 seconds of CPU, the tool waits 30 seconds of wall time, the client stops at 40 API calls with `call_budget`, and the rendered output is cut at 12,000 characters in total, 3,000 per string and 100 items per array, with `truncated_arrays` naming each cut array and a `recovery` line that says how to get every row. A syntax error comes back as `syntax_error` with the function-body rule; a thrown error as `program_error` with its message.

The result is valid bounded JSON with `ok` and `value` or `error` first, then actual `calls`, `rate_limit`, `api_build`, truncation facts and capped logs. Large results retain continuation and recovery fields. Execution metadata uses the same meter. Timeout reports `calls: null` and `outcome_uncertain: true`; in-flight reads may still finish and consume rows. Authentication 429/503 asks clients to retry with the same credential; only invalid credentials trigger reconnect.

## Gates

A gate inside a program throws an `ArcmiraError` with the API's error fields, and the execute tools return it as `ERROR` with `isError: true`:

```
{"ok":false,"error":{"code":"recommendations_not_enabled","message":"Sponsor recommendations require Pro.","gate":"plan"},"calls":1,"outcome_uncertain":false}
```

Switch on `code`. `unlock.url` names the plan or setting that lifts a gate, and `rate_limited` carries `retry_after_seconds`. A 200 that withheld something (Premium transcript text, the paid-versus-organic split, sponsors past the free slice) is a normal result carrying the same body under `access`. The full catalog is at https://arcmira.com/docs/errors.

Every result, gates included, carries the key's budget after the call under `_meta["arcmira.com/rate_limit"]` as `{ "limit": 20, "remaining": 17, "reset": 1788819360 }`, read from the API's RateLimit headers, and `_meta["arcmira.com/build"]`: `server`, `deploy`, `api` (the API build that answered) and `client` (the host's name from its handshake, forwarded to the API as `x-arcmira-client`).

## What we log

Each tool call is logged to Arcmira's product analytics (PostHog), linked to the account that made it, so we can see how the tools are used and fix what fails. One record per call holds:

- the tool name, the host's name and version, the server version, and how long the call took;
- the input: the program text of either execute tool (first 4,000 characters), the `arcmira_describe` topic, or the `arcmira_feedback` category and note;
- `intent`, when the agent sends it;
- the outcome, not the result: ok or the error code, the result size, whether it was truncated, and the API routes the call made (`GET /v1/search`, not its query string).

Before the record is stored, the API replaces anything that looks like a credential or an email address (`arc_` keys, `Bearer` tokens, `sk-` keys, addresses) with `[redacted]`. Results, transcript text and logs printed by a program are never logged. A call with no valid credential is not logged. The record is sent after the result, so logging never delays or changes an answer; a record that fails to send is dropped.

## Upgrading

Upgrade notes for every release, the 0.7 tool renames and the 0.10 field changes included, are in [CHANGELOG.md](CHANGELOG.md).

## Plugin

`plugins/arcmira` bundles the MCP URL and six skills for Claude Code, Codex, Cursor, Agent Plugins hosts and Gemini CLI:

| Skill | For |
| --- | --- |
| `arcmira` | The shared procedure and id rule, which task skill fits which ask, and a pointer to `arcmira_describe` for the method reference |
| `sponsor-research` | Who sponsors a show, or which shows a brand sponsors, how often, since when |
| `company-watch` | Sets up a monitor: the entities and topic spellings to follow, the user's monitors first, then the delivery they want |
| `find-quotes` | Exact spoken quotes with speaker, date, a timestamped link, clip start and end |
| `person-research` | Interview or meeting prep: appearances, a person's own words, who discusses them |
| `compare-shows` | Two shows side by side: size, topics, overlap, shared sponsors |

Every skill starts from names, never ids: each program resolves the name, returns `ask` options when several entities fit and none stands out, says when it assumed one, and names the entity it used. Every skill ends with the monitor line (monitors can follow what it found, and what an alert uses) and the feedback line. The skills are generated from `src/reference.ts` and `src/skills.ts` by `scripts/build-skill.ts`; CI fails when a file drifts or a program calls a method the reference does not document, and `pnpm examples:check` runs every program against production.

```bash
claude plugin marketplace add arcmira/mcp
claude plugin install arcmira@arcmira
```

## Stay up to date

Arcmira ships changes weekly. Keep auto-update on.

- **The MCP server needs nothing.** It is remote: hosts fetch its tools and instructions on connect, and `arcmira_describe` returns the reference from the server on every call, opening with a version line. The MCP server alone is always current.
- **Claude Code plugin.** Auto-update is off by default for a third-party marketplace. Turn it on: run `/plugin`, open **Marketplaces**, pick `arcmira`, and choose **Enable auto-update**. Or set it in `~/.claude/settings.json`:

  ```json
  { "extraKnownMarketplaces": { "arcmira": { "source": { "source": "github", "repo": "arcmira/mcp" }, "autoUpdate": true } } }
  ```

  Update now: `claude plugin update arcmira@arcmira`.
- **Codex plugin.** `codex plugin marketplace upgrade arcmira`, then restart Codex.
- **Skills installed with `npx skills add arcmira/mcp`.** `npx skills update`.

Each release bumps the version in every plugin manifest (a test enforces it), because Claude Code only updates a plugin whose version changed.

## Gemini CLI

Install the remote connection and core Arcmira reference from this repository:

```bash
gemini extensions install https://github.com/arcmira/mcp
```

The root `gemini-extension.json` points to the same remote MCP and loads the `arcmira` skill as its context file, like the plugin bundle. Sign in through the MCP authorization flow. The root extension does not separately install the five optional task skills.

## Develop

```bash
pnpm install
pnpm dev            # wrangler dev on :8790 with a local Worker Loader
pnpm test           # node:test, sandbox programs run under a fake loader
pnpm typecheck
pnpm manifest:check # every client call matches the live OpenAPI document
pnpm skill:check    # every plugins/arcmira/skills/*/SKILL.md matches src/reference.ts and src/skills.ts
ARCMIRA_KEY=arc_sk_... pnpm examples:check   # every worked program and read task-skill program runs against production
pnpm sandbox:check  # src/sandbox/client-source.ts matches src/sandbox/client.js
ARCMIRA_KEY=arc_sk_... node --experimental-strip-types scripts/smoke.ts http://localhost:8790/mcp
```

`src/reference.ts` is the steering surface: the `arcmira_describe` text, the server instructions and the `arcmira` skill all come from it.

Copyright Arcmira. All rights reserved for the server (see `LICENSE`); `plugins/arcmira` is Apache-2.0.
