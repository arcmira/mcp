# Arcmira: YouTube Transcript Search

Give your AI the ability to find who said what with timestamps, discover what’s being discussed across videos and livestreams, and distinguish organic recommendations from sponsored ad reads.

## Connect your AI

Copy this into your coding agent:

```text
Fetch and execute the appropriate instructions to set me up for Arcmira from https://arcmira.com/agent-setup/prompt.md
```

For Claude, ChatGPT, Cursor, and other MCP clients, use **`https://mcp.arcmira.com/mcp`** and sign in to Arcmira. [Setup by host](https://arcmira.com/agent-setup) · [Documentation](https://arcmira.com/docs/mcp-server) · [Website](https://arcmira.com/mcp) · [Plugin and skills](plugins/arcmira)

Try: “Which brands sponsor both TBPN and the All-In Podcast?” or “Find what Sam Altman said about AI agents, with timestamped links.”

Results cover indexed videos. Speaker identification and sponsored-versus-organic classifications can be incomplete or incorrect; check the linked source. Plan limits apply.

[Share plugin feedback](https://github.com/arcmira/mcp/issues/new?template=plugin-feedback.yml) · [Update installed skills](plugins/arcmira#keep-it-updated)

## Connect

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
| `arcmira_describe` | `topic?` | The arcmira client reference: the id rule, which method answers which question, every method with arguments and return fields, nine worked example programs, the quirks that cost answers, the budget and monitor rules, error codes, and doc links. About 23,000 characters; `topic` narrows it to one method and its examples. Never bills. |
| `arcmira_execute_read` | `code` | What the program printed plus its return value. The code is the body of an async function with `arcmira` and `ArcmiraError` in scope. Reads, Premium transcripts included, and the user's monitors. Limits: 30 seconds, 40 API calls, and 12,000 characters of output in total, 3,000 per string, and 100 items per array. |
| `arcmira_execute_write` | `code` | The same as `arcmira_execute_read`, with the account writes added: `arcmira.monitors.create`, `arcmira.monitors.update` (including `paused`), `arcmira.monitors.addEntities`, `arcmira.monitors.addName` and `arcmira.monitors.attachTrackers`. Nothing is deleted. |
| `arcmira_feedback` | `category`, `note`, `request_id?`, `call_id?` | One `POST /v1/feedback` of type `experience`. `category` is `wrong_entity`, `bad_data`, `missing`, `slow`, `confusing` or `other`; `note` says what happened. Returns the feedback id. |

Every tool also takes an optional `intent`, at most 300 characters: the user's request in a few words. A host that omits it loses nothing. See [What we log](#what-we-log).

`arcmira_describe`, `arcmira_execute_read` and `arcmira_feedback` are read-only: they change nothing on the account. Every read is metered, Premium included. `arcmira_execute_write` is not read-only and not destructive: it creates and changes monitors and trackers, and pauses instead of deleting.

On-demand spend extends the plan. The account's on-demand budget is the approval, so an agent never asks the user for a cents amount. When a budget or plan blocks a purchase (`spend_limit_exceeded`, `quota_exceeded`, a plan gate), the agent tells the user to raise the on-demand budget at https://arcmira.com/dashboard/spending or upgrade the plan at https://arcmira.com/pricing, and links the refusal's `unlock.url`.

A Premium transcript is one read in `arcmira_execute_read`:

```javascript
const t = await arcmira.transcript("cdLeJU_1UH8", { quality: "premium" });
return t.state === "ready" ? t.lines : { state: t.state, eta_seconds: t.eta_seconds, note: t.note };
```

When the video is not transcribed yet, `GET /v1/transcripts/{video_id}?quality=premium` buys it within the account's plan (included credits, then the on-demand budget) and answers `202` with the job and `Retry-After`. The client reads again at `Retry-After` for up to 25 seconds. Repeated reads never buy twice. Still `pending` after that: the result carries `eta_seconds`, and the same read in a later program returns the lines. A plan without Premium throws `paid_plan_required`; a budget that blocks the purchase throws `spend_limit_exceeded` or `quota_exceeded`, and the quote rides on the error as `quote`. The price covers the whole video at 75 rows per 15-minute quarter and four credits per row, and `start` and `end` never lower it; `arcmira.quote(video)` reads it for free.

Results that are empty, an error, truncated or a resolve `ask` end with one line, `feedback`, which names the call: `If this was wrong, slow, or missing for the user, send one arcmira_feedback with call_id mcpc_...`.

The client's methods are the arcmira CLI's commands, with the same names and the flags as options, so the MCP, the CLI and the SDK teach one vocabulary:

| Method | Fronts | Use it for |
|---|---|---|
| `arcmira.resolve(q, { type?, context?, limit? })` | `GET /v1/entities/resolve` | A name, `@handle`, URL or `UC` id to one of three answers: `best`, `suggested` (with `reason` and `evidence`), or `ask` with options |
| `arcmira.search({ query, channelIds?, about?, speakerIds?, kind?, entityIds?, after?, before?, source?, limit? })` | `GET /v1/search` | Spoken slices for one topic, or about an entity, or spoken by a person, with watch links and dates |
| `arcmira.mentions({ entityId, channelId?, after?, before?, limit?, cursor? })` | `GET /v1/mentions` | Has X mentioned Y, first seen, last seen |
| `arcmira.momentum(entityId)` | `GET /v1/entities/{id}/momentum` | Last 30 days against the prior 30, with a verdict |
| `arcmira.sponsors(channelId, { minAdReads?, status?, limit? })` | `GET /v1/channels/{id}/sponsors` | Recurring sponsors of one show |
| `arcmira.recommendations(entityId, { kind?, channelId?, after?, before?, limit?, cursor? })` | `GET /v1/recommendations?entity_id=` | Who recommends one entity, sponsored or organic, with the quote |
| `arcmira.episodes(channelId, { limit?, after?, before? })` | `GET /v1/channels/{id}/videos` | Newest indexed episodes, with the `video_id` the others take |
| `arcmira.transcript(videoIdOrUrl, { quality?, language?, timestamps?, start?, end? })` | `GET /v1/transcripts/{video_id}`, read again at `Retry-After` while a Premium purchase is pending | The transcript of one video, captions or Premium, whole or a window |
| `arcmira.occurrences({ channelIds?, entityIds?, videoIds?, types?, mode?, after?, before?, limit? })` | `GET /v1/mentions/counts` | What shows talk about, what they share, what one episode mentions |
| `arcmira.quote(videoIdOrUrl)` | `GET /v1/transcripts/{video_id}/quote` | The free whole-video Premium quote: rows, credits, and any on-demand cents |
| `arcmira.status({ channelId? })` | `GET /v1/channels/{id}/coverage`, `GET /v1/me` | Coverage and the index date, or the key, plan, credits and on-demand budget |
| `arcmira.monitors.list()` | `GET /v1/monitors` | The user's monitors, with delivery settings and tracker counts |
| `arcmira.monitors.trackers(monitorId)` | `GET /v1/monitors/{id}/trackers` | What one monitor already follows |
| `arcmira.monitors.create({ name, notify_frequency, notify_emails?, notify_slack?, ... })` | `POST /v1/monitors` | A new monitor. Write tool only |
| `arcmira.monitors.update(monitorId, { ..., paused? })` | `PATCH /v1/monitors/{id}` | Delivery changes, or a pause. Write tool only |
| `arcmira.monitors.addEntities(monitorId, entityIds, { personMatchMode? })` | `POST /v1/monitors/{id}/entities` | Follows up to 90 entity ids in one call: reuses or creates each tracker by id and attaches it. An id that cannot attach says why (`entity_not_found`, `entity_type_not_trackable`, `tracker_limit_reached`, `tracked_in_another_monitor`). Write tool only |
| `arcmira.monitors.addName(monitorId, { name, type, personMatchMode? })` | `POST /v1/trackers`, then `POST /v1/monitors/{id}/trackers` | Follows one exact name before it is indexed (a show by its `UC` id). A name the account already tracks is not moved; the result says `tracker_exists`. Write tool only |
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

- `arcmira_execute_read`: `GET https://api.arcmira.com/v1/*`. A Premium purchase happens inside the transcript `GET`.
- `arcmira_execute_write`: the read set, plus `POST` and `PATCH` under `/v1/monitors` and `/v1/trackers`. Never `DELETE`, and never the webhook secret rotation.

The proxy enforces this in the Worker, so a raw `fetch()` gets the same answer as a client method. A write method called from `arcmira_execute_read` throws `write_tool_required` before any request. The isolate gets 5 seconds of CPU, the tool waits 30 seconds of wall time, the client stops at 40 API calls with `call_budget`, and the rendered output is cut at 12,000 characters in total, 3,000 per string and 100 items per array, with `truncated_arrays` naming each cut array and a `recovery` line that says how to get every row. A syntax error comes back as `syntax_error` with the function-body rule; a thrown error as `program_error` with its message.

The result is valid bounded JSON with `ok` and `value` or `error` first, then actual `calls`, `rate_limit`, `api_build`, truncation facts and capped logs. Large results retain continuation and recovery fields. Execution metadata uses the same meter. Timeout reports `calls: null` and `outcome_uncertain: true`; in-flight reads may still finish and consume rows. Authentication 429/503 asks clients to retry with the same credential; only invalid credentials trigger reconnect.

## Gates

A gate inside a program throws an `ArcmiraError` with the API's error fields, and the execute tools return it as `ERROR` with `isError: true`:

```
{"ok":false,"error":{"code":"recommendations_not_enabled","message":"Sponsor recommendations require Pro.","gate":"plan"},"calls":1,"outcome_uncertain":false}
```

Switch on `code`, relay `unlock.url` to the human, and honor `retry_after_seconds` on `rate_limited`. A 200 that withheld something (Premium transcript text, the paid-versus-organic split, sponsors past the free slice) is a normal result carrying the same body under `access`. The full catalog is at https://arcmira.com/docs/errors.

Every result, gates included, carries the key's budget after the call under `_meta["arcmira.com/rate_limit"]` as `{ "limit": 20, "remaining": 17, "reset": 1788819360 }`, read from the API's RateLimit headers, and `_meta["arcmira.com/build"]`: `server`, `deploy`, `api` (the API build that answered) and `client` (the host's name from its handshake, forwarded to the API as `x-arcmira-client`).

## What we log

Each tool call is logged to Arcmira's product analytics (PostHog), linked to the account that made it, so we can see how the tools are used and fix what fails. One record per call holds:

- the tool name, the host's name and version, the server version, and how long the call took;
- the input: the program text of either execute tool (first 4,000 characters), the `arcmira_describe` topic, or the `arcmira_feedback` category and note;
- `intent`, when the agent sends it;
- the outcome, not the result: ok or the error code, the result size, whether it was truncated, and the API routes the call made (`GET /v1/search`, not its query string).

Before the record is stored, the API replaces anything that looks like a credential or an email address (`arc_` keys, `Bearer` tokens, `sk-` keys, addresses) with `[redacted]`. Results, transcript text and logs printed by a program are never logged. A call with no valid credential is not logged. The record is sent after the result, so logging never delays or changes an answer; a record that fails to send is dropped.

## Upgrading from 0.9

0.10 follows the cleaned-up v1 API. Programs that read the old field names read `undefined`; describe and the skills carry the new ones.

- Lists name their collection: `mentions().mentions`, `recommendations().recommendations` (was `data`). A recommendation's `class` is `sponsored`, `organic` or `mention` (was `mention_class` `ad_read`, `endorsement`, `mention`).
- Search chunks are snake_case: `video_id`, `video_title`, `published_at`, `start_seconds`, `watch_url`, `channel_name`, `cite_line`. Search `kind` is `sponsored`, `organic` or `mention`, or an array of them.
- `before` is the first day left out on every method (it was the last day counted). Every dated result echoes `window`.
- Monitor fields are snake_case in both directions: `create({ name, notify_frequency })`, `update(id, { paused: true })`, and `monitors.list()` returns `paused`, `notify_frequency`, `tracker_count`.
- `arcmira.status({ jobId })` is gone: a pending Premium read returns its job and `eta_seconds`, and the same read returns the lines once they are ready.
- New: `arcmira.monitors.addName(monitorId, { name, type })` follows an exact name before it is indexed.

## Upgrading from 0.8

`describe` is now `arcmira_describe`, `execute` is now `arcmira_execute_read`, and `prepare_transcript` is now a Premium read, `arcmira.transcript(video, { quality: "premium" })`, inside `arcmira_execute_read`. A host that cached the old list and calls an old name gets `tool_retired`, which names the replacement. `max_on_demand_cents` is no longer an input: the account's on-demand budget decides.

## Upgrading from 0.6.0

The ten tools (`resolve_entities`, `search_transcripts`, `list_mentions`, `entity_momentum`, `count_occurrences`, `list_episodes`, `list_sponsors`, `list_recommendations`, `index_status`, `get_transcript`) are gone from `tools/list`. A host that cached the old list and calls one gets `tool_retired`, which names `arcmira_describe`. Each old tool is one client method: `resolve_entities` is `arcmira.resolve`, `search_transcripts` is `arcmira.search`, `list_mentions` is `arcmira.mentions`, `entity_momentum` is `arcmira.momentum`, `count_occurrences` is `arcmira.occurrences`, `list_episodes` is `arcmira.episodes`, `list_sponsors` is `arcmira.sponsors`, `list_recommendations` is `arcmira.recommendations`, `index_status` is `arcmira.status`, `get_transcript` is `arcmira.transcript`. The `recency` shorthand became `arcmira.daysAgo(n)`.

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

Every skill starts from names, never ids: each program resolves the name, returns `ask` options when several entities fit and none stands out, says when it assumed one, and names the entity it used. Every skill ends by offering to save what it found to a monitor and with the feedback line. The skills are generated from `src/reference.ts` and `src/skills.ts` by `scripts/build-skill.ts`; CI fails when a file drifts or a program calls a method the reference does not document, and `pnpm examples:check` runs every program against production.

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

`src/reference.ts` is the steering surface: the `arcmira_describe` text, the server instructions and the plugin skill all come from it.

Copyright Arcmira. All rights reserved for the server (see `LICENSE`); `plugins/arcmira` is Apache-2.0.
