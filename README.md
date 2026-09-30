# Arcmira MCP: search YouTube and podcast transcripts from Claude, Cursor, ChatGPT, and Codex

Arcmira MCP is the official remote MCP server for [Arcmira](https://arcmira.com). It gives any MCP client two read-only tools over indexed YouTube and podcast transcripts. `describe` returns the reference for a typed JavaScript client, and `execute` runs a program you write against it: search, mentions, momentum, sponsors, recommendations, episodes, the full transcript of one video, ranked counts, and coverage, in one call per question.

Arcmira is an SF-based AI company and the search engine for the spoken web.

```bash
claude mcp add --transport http arcmira https://mcp.arcmira.com/mcp
```

One remote URL. Sign in through your host, or send an account key. The server is a stateless facade over the public HTTP API at `https://api.arcmira.com/v1`; every gate the API raises is forwarded untouched with the link that lifts it.

- Endpoint: `https://mcp.arcmira.com/mcp` (Streamable HTTP)
- Plugin for Claude Code, Codex, Cursor and Gemini: [`plugins/arcmira`](plugins/arcmira) (Apache-2.0), one skill generated from the same client reference
- Registry name: `io.github.arcmira/arcmira`
- Overview: https://arcmira.com/mcp
- Setup for each host: https://arcmira.com/agent-setup
- Reference: https://arcmira.com/docs/mcp-server
- Server card: https://mcp.arcmira.com/.well-known/mcp/server-card.json
- HTTP API the tools front: https://api.arcmira.com/v1/openapi.json

## Connect

Two ways in. Hosts that speak the MCP authorization spec sign you in; everything else sends a key.

**Sign in through the host.** Add `https://mcp.arcmira.com/mcp` with no key. The server answers 401 with an OAuth challenge, the host registers itself against `api.arcmira.com`, opens arcmira.com for sign-in and consent, and connects with a token that carries the permissions you allowed. Tokens refresh on their own; revoke a host under Settings, Connected apps.

```bash
claude mcp add --transport http arcmira https://mcp.arcmira.com/mcp
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
claude mcp add --transport http arcmira https://mcp.arcmira.com/mcp --header "Authorization: Bearer $ARCMIRA_API_KEY"
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
| `describe` | `topic?` | The arcmira client reference: the id rule, ten methods with arguments and return fields, ten worked example programs, the quirks that cost answers, error codes, and doc links. About 1,800 tokens; `topic` narrows it. Never bills. |
| `execute` | `code` | What the program printed plus its return value. The code is the body of an async function with `arcmira` and `ArcmiraError` in scope. Limits: 30 seconds, 40 API calls, 20,000 characters of output. |

Both tools declare `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`. Two tools cost about 1,500 tokens of definitions per conversation; the ten tools they replace cost 8,163.

The client's methods are the arcmira CLI's commands, with the same names and the flags as options, so the MCP, the CLI and the SDK teach one vocabulary:

| Method | Fronts | Use it for |
|---|---|---|
| `arcmira.resolve(q, { type?, limit? })` | `GET /v1/entities/search` | A name, `@handle`, URL or `UC` id to typed rows; `best` is set only for an unambiguous match |
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

Filters take verbatim ids only. A name where an id belongs throws `id_required` before any network call, and the message names the fix. Resolve first, verify `best` against what the user meant, then query:

```javascript
const r = await arcmira.resolve("Linear", { type: "organization" });
if (!r.best) return { options: r.candidates };
const m = await arcmira.momentum(r.best.id);
return { entity: r.best.name, id: r.best.id, verdict: m.verdict, last30: m.volume.mentions_30d, prior30: m.volume.mentions_prior_30d, as_of: m.as_of };
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

The result is one text block: the `console.log` lines, then `RETURN: <json>` or `ERROR: <json>`. There is no `structuredContent`, so every host reads the same thing. `_meta["arcmira.com/execution"]` carries the call count and the API build.

## Gates

A gate inside a program throws an `ArcmiraError` with the API's error fields, and `execute` returns it as `ERROR` with `isError: true`:

```
ERROR: {"name":"ArcmiraError","code":"recommendations_not_enabled","message":"Sponsor recommendations require Pro.","unlock":{"tier":"pro","url":"https://arcmira.com/pricing?src=mcp-tool","offer":null},"gate":"plan","status":403,...}
```

Switch on `code`, relay `unlock.url` to the human, and honor `retry_after_seconds` on `rate_limited`. A 200 that withheld something (Premium transcript text, the paid-versus-organic split, sponsors past the free slice) is a normal result carrying the same body under `access`. The full catalog is at https://arcmira.com/docs/errors.

Every result, gates included, carries the key's budget after the call under `_meta["arcmira.com/rate_limit"]` as `{ "limit": 20, "remaining": 17, "reset": 1788819360 }`, read from the API's RateLimit headers, and `_meta["arcmira.com/build"]`: `server`, `deploy`, `api` (the API build that answered) and `client` (the host's name from its handshake, forwarded to the API as `x-arcmira-client`).

## Upgrading from 0.6.0

The ten tools (`resolve_entities`, `search_transcripts`, `list_mentions`, `entity_momentum`, `count_occurrences`, `list_episodes`, `list_sponsors`, `list_recommendations`, `index_status`, `get_transcript`) are gone from `tools/list`. A host that cached the old list and calls one gets `tool_retired`, which names `describe`. Each old tool is one client method: `resolve_entities` is `arcmira.resolve`, `search_transcripts` is `arcmira.search`, `list_mentions` is `arcmira.mentions`, `entity_momentum` is `arcmira.momentum`, `count_occurrences` is `arcmira.occurrences`, `list_episodes` is `arcmira.episodes`, `list_sponsors` is `arcmira.sponsors`, `list_recommendations` is `arcmira.recommendations`, `index_status` is `arcmira.status`, `get_transcript` is `arcmira.transcript`. The `recency` shorthand became `arcmira.daysAgo(n)`.

## Plugin

`plugins/arcmira` bundles the MCP URL and one skill for Claude Code, Codex, Cursor, Agent Plugins hosts and Gemini CLI. The skill is generated from `src/reference.ts`, the same text `describe` serves, by `scripts/build-skill.ts`; CI fails when it drifts.

```bash
claude plugin marketplace add arcmira/mcp
claude plugin install arcmira@arcmira
```

## Develop

```bash
pnpm install
pnpm dev            # wrangler dev on :8790 with a local Worker Loader
pnpm test           # node:test, sandbox programs run under a fake loader
pnpm typecheck
pnpm manifest:check # every client call matches the live OpenAPI document
pnpm skill:check    # plugins/arcmira/skills/arcmira/SKILL.md matches src/reference.ts
pnpm sandbox:check  # src/sandbox/client-source.ts matches src/sandbox/client.js
ARCMIRA_KEY=arc_sk_... node --experimental-strip-types scripts/smoke.ts http://localhost:8790/mcp
```

`src/reference.ts` is the steering surface: the `describe` text, the server instructions and the plugin skill all come from it.

Copyright Arcmira. All rights reserved for the server (see `LICENSE`); `plugins/arcmira` is Apache-2.0.
