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
| `describe` | `topic?` | The arcmira client reference: the id rule, which method answers which question, ten methods with arguments and return fields, eight worked example programs, the quirks that cost answers, error codes, and doc links. About 2,800 tokens; `topic` narrows it to one method and its examples. Never bills. |
| `execute` | `code` | What the program printed plus its return value. The code is the body of an async function with `arcmira` and `ArcmiraError` in scope. Limits: 30 seconds, 40 API calls, 20,000 characters of output. |

`describe`, `execute` and `quote_transcript` are read-only. `prepare_transcript` is explicitly non-read-only, destructive, idempotent for the same persisted key and inputs, and open-world: it spends account balance and can submit external provider work. These hints describe effects. A Premium transcript request authorizes available included credits without another confirmation. The agent takes max_rows from the current quote, persists the retry key, and uses max_on_demand_cents: 0. Extra dollar charges require explicit authorization or an existing account spending policy.

| `quote_transcript` | `video_id` | Free GET `/v1/transcripts/{video_id}/quote`. Reports whole-video row/credit price and possible on-demand cents. |
| `prepare_transcript` | `video_id`, `max_rows`, `max_on_demand_cents?`, `idempotency_key` | Only POST `/v1/transcriptions`. Persist the key before calling. Omitted money ceiling means zero. Reuse the exact key and inputs after an uncertain response. Returns `{request, existing?}`: 201 ready, 202 pending, or 200 replay. |

Premium preparation prices the whole video: 75 rows per 15-minute quarter, with four credits per row in credit mode. Consult the free quote for actual units and overage. `start` and `end` select lines and never lower that purchase price. Premium GET never buys; return `state: pending` and its `status_url`, or the `purchase_required` quote/prepare links. Read `.lines` only when `state` is `ready`. The execute sandbox cannot POST, including preparation. Poll `arcmira.status({jobId: request.id})`; `refund_pending` is not a completed refund.

The client's methods are the arcmira CLI's commands, with the same names and the flags as options, so the MCP, the CLI and the SDK teach one vocabulary:

| Method | Fronts | Use it for |
|---|---|---|
| `arcmira.resolve(q, { type?, context?, limit? })` | `GET /v1/entities/resolve` | A name, `@handle`, URL or `UC` id to one of three answers: `best`, `suggested` (with `reason` and `evidence`), or `ask` with options |
| `arcmira.search({ query, channelIds?, about?, speakerIds?, kind?, entityIds?, after?, before?, source?, limit? })` | `GET /v1/transcripts/search` | Spoken slices for one topic, or about an entity, or spoken by a person, with watch links and dates |
| `arcmira.mentions({ entityId, channelId?, after?, before?, limit?, cursor? })` | `GET /v1/mentions` | Has X mentioned Y, first seen, last seen |
| `arcmira.momentum(entityId)` | `GET /v1/entities/{id}/momentum` | Last 30 days against the prior 30, with a verdict |
| `arcmira.sponsors(channelId, { minAdReads?, status?, limit? })` | `GET /v1/channels/{id}/sponsors` | Recurring sponsors of one show |
| `arcmira.recommendations(entityId, { kind?, channelId?, after?, before?, limit?, cursor? })` | `GET /v1/entities/{id}/recommendations` | Who recommends one entity, sponsored or organic, with the quote |
| `arcmira.episodes(channelId, { limit?, after?, before? })` | `GET /v1/channels/{id}/videos` | Newest indexed episodes, with the `video_id` the others take |
| `arcmira.transcript(videoIdOrUrl, { quality?, language?, timestamps?, start?, end? })` | `GET /v1/transcripts/{video_id}` | The transcript of one video, captions or Premium, whole or a window |
| `arcmira.occurrences({ channelIds?, entityIds?, videoIds?, types?, mode?, after?, before?, limit? })` | `GET /v1/mentions/counts` | What shows talk about, what they share, what one episode mentions |
| `arcmira.status({ channelId?, jobId? })` | `GET /v1/channels/{id}/coverage`, `GET /v1/transcriptions/{id}`, `GET /v1/me` | Coverage and the index date, a transcription job, or the key |

`arcmira.today()` and `arcmira.daysAgo(n)` give ISO dates from the server clock for date windows.

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

`execute` runs the program in a fresh [Dynamic Worker](https://developers.cloudflare.com/dynamic-workers/) isolate. The isolate's only network is the parent's outbound proxy, which refuses anything that is not `GET https://api.arcmira.com/v1/*` with `outbound_refused` and adds the caller's credential to what it forwards, so the program never holds the key. The isolate gets 5 seconds of CPU, `execute` waits 30 seconds of wall time, the client stops at 40 API calls with `call_budget`, and the rendered output is cut at 20,000 characters with a line that says how to shrink it. A syntax error comes back as `syntax_error` with the function-body rule; a thrown error as `program_error` with its message.

The result is valid bounded JSON with `ok` and `value` or `error` first, then actual `calls`, `rate_limit`, `api_build`, truncation facts and capped logs. Large results retain continuation and recovery fields. Execution metadata uses the same meter. Timeout reports `calls: null` and `outcome_uncertain: true`; in-flight reads may still finish and consume rows. Authentication 429/503 asks clients to retry with the same credential; only invalid credentials trigger reconnect.

## Gates

A gate inside a program throws an `ArcmiraError` with the API's error fields, and `execute` returns it as `ERROR` with `isError: true`:

```
{"ok":false,"error":{"code":"recommendations_not_enabled","message":"Sponsor recommendations require Pro.","gate":"plan"},"calls":1,"outcome_uncertain":false}
```

Switch on `code`, relay `unlock.url` to the human, and honor `retry_after_seconds` on `rate_limited`. A 200 that withheld something (Premium transcript text, the paid-versus-organic split, sponsors past the free slice) is a normal result carrying the same body under `access`. The full catalog is at https://arcmira.com/docs/errors.

Every result, gates included, carries the key's budget after the call under `_meta["arcmira.com/rate_limit"]` as `{ "limit": 20, "remaining": 17, "reset": 1788819360 }`, read from the API's RateLimit headers, and `_meta["arcmira.com/build"]`: `server`, `deploy`, `api` (the API build that answered) and `client` (the host's name from its handshake, forwarded to the API as `x-arcmira-client`).

## Upgrading from 0.6.0

The ten tools (`resolve_entities`, `search_transcripts`, `list_mentions`, `entity_momentum`, `count_occurrences`, `list_episodes`, `list_sponsors`, `list_recommendations`, `index_status`, `get_transcript`) are gone from `tools/list`. A host that cached the old list and calls one gets `tool_retired`, which names `describe`. Each old tool is one client method: `resolve_entities` is `arcmira.resolve`, `search_transcripts` is `arcmira.search`, `list_mentions` is `arcmira.mentions`, `entity_momentum` is `arcmira.momentum`, `count_occurrences` is `arcmira.occurrences`, `list_episodes` is `arcmira.episodes`, `list_sponsors` is `arcmira.sponsors`, `list_recommendations` is `arcmira.recommendations`, `index_status` is `arcmira.status`, `get_transcript` is `arcmira.transcript`. The `recency` shorthand became `arcmira.daysAgo(n)`.

## Plugin

`plugins/arcmira` bundles the MCP URL and six skills for Claude Code, Codex, Cursor, Agent Plugins hosts and Gemini CLI:

| Skill | For |
| --- | --- |
| `arcmira` | The client reference: the id rule, every method, worked programs |
| `sponsor-research` | Who sponsors a show, or which shows a brand sponsors, how often, since when |
| `company-watch` | What shows said about a company this week: shows, counts, momentum, quotes |
| `find-quotes` | Exact spoken quotes with speaker, date, a timestamped link, clip start and end |
| `person-research` | Interview or meeting prep: appearances, a person's own words, who discusses them |
| `compare-shows` | Two shows side by side: size, topics, overlap, shared sponsors |

Every skill starts from names, never ids: each program resolves the name, returns `ask` options when several entities fit and none stands out, says when it assumed one, and names the entity it used. The skills are generated from `src/reference.ts` and `src/skills.ts` by `scripts/build-skill.ts`; CI fails when a file drifts or a program calls a method the reference does not document, and `pnpm examples:check` runs every program against production.

```bash
claude plugin marketplace add arcmira/mcp
claude plugin install arcmira@arcmira
```

## Stay up to date

Arcmira ships changes weekly. Keep auto-update on.

- **The MCP server needs nothing.** It is remote: hosts fetch its tools and instructions on connect, and `describe` returns the reference from the server on every call, opening with a version line. The MCP server alone is always current.
- **Claude Code plugin.** Auto-update is off by default for a third-party marketplace. Turn it on: run `/plugin`, open **Marketplaces**, pick `arcmira`, and choose **Enable auto-update**. Or set it in `~/.claude/settings.json`:

  ```json
  { "extraKnownMarketplaces": { "arcmira": { "source": { "source": "github", "repo": "arcmira/mcp" }, "autoUpdate": true } } }
  ```

  Update now: `claude plugin update arcmira@arcmira`.
- **Codex plugin.** `codex plugin marketplace upgrade arcmira`, then restart Codex.
- **Skills installed with `npx skills add arcmira/mcp`.** `npx skills update`.

Each release bumps the version in every plugin manifest (a test enforces it), because Claude Code only updates a plugin whose version changed.

## Develop

```bash
pnpm install
pnpm dev            # wrangler dev on :8790 with a local Worker Loader
pnpm test           # node:test, sandbox programs run under a fake loader
pnpm typecheck
pnpm manifest:check # every client call matches the live OpenAPI document
pnpm skill:check    # every plugins/arcmira/skills/*/SKILL.md matches src/reference.ts and src/skills.ts
ARCMIRA_KEY=arc_sk_... pnpm examples:check   # every worked program and task-skill program runs against production
pnpm sandbox:check  # src/sandbox/client-source.ts matches src/sandbox/client.js
ARCMIRA_KEY=arc_sk_... node --experimental-strip-types scripts/smoke.ts http://localhost:8790/mcp
```

`src/reference.ts` is the steering surface: the `describe` text, the server instructions and the plugin skill all come from it.

Copyright Arcmira. All rights reserved for the server (see `LICENSE`); `plugins/arcmira` is Apache-2.0.
