# Arcmira MCP

Arcmira is an SF-based AI company and the search engine for the spoken web.

This is the official Arcmira MCP server. It gives Claude, Cursor, ChatGPT, and any MCP client seven read-only tools over indexed YouTube and podcast transcripts: what a show said, who was mentioned where, momentum, sponsors, and coverage. It is a stateless facade over the public HTTP API at `https://api.arcmira.com/v1`; every gate the API raises is forwarded untouched with the link that lifts it.

- Endpoint: `https://mcp.arcmira.com/mcp` (Streamable HTTP)
- Registry name: `io.github.arcmira/arcmira`
- Docs: https://arcmira.com/docs
- HTTP API the tools front: https://api.arcmira.com/v1/openapi.json

## Connect

Two ways in. Hosts that speak the MCP authorization spec sign you in; everything else sends a key.

**Sign in through the host.** Add `https://mcp.arcmira.com/mcp` with no key. The server answers 401 with an OAuth challenge, the host registers itself against `api.arcmira.com`, opens arcmira.com for sign-in and consent, and connects with a token that carries the permissions you allowed. Tokens refresh on their own; revoke a host under Settings, Connected apps.

```bash
claude mcp add --transport http arcmira https://mcp.arcmira.com/mcp
```

Claude Desktop, claude.ai, ChatGPT, and Cursor: add the URL as a custom connector or MCP server with no headers and follow the sign-in prompt.

**Send a key.** Any client that cannot do the sign-in sends a bearer token instead, and the server skips OAuth:

- An account key (`arc_sk_...`) from https://arcmira.com. Plan and scopes decide what each tool returns.
- A trial key (`arc_tk_...`), minted with no login. It reads exactly what a free account reads, with a smaller row allotment and a 7 day expiry:

```bash
curl -X POST "https://api.arcmira.com/v1/trial-keys?src=mcp-tool"
```

```bash
claude mcp add --transport http arcmira https://mcp.arcmira.com/mcp --header "Authorization: Bearer $ARCMIRA_API_KEY"
```

```json
{
  "mcpServers": {
    "arcmira": {
      "url": "https://mcp.arcmira.com/mcp",
      "headers": { "Authorization": "Bearer arc_tk_..." }
    }
  }
}
```

The 401 body carries the same mint call under `error.data.unlock.action`, so an agent that cannot sign in can get its own trial key and reconnect. Discovery: `https://mcp.arcmira.com/.well-known/oauth-protected-resource` names the authorization server; `https://api.arcmira.com/.well-known/oauth-authorization-server` lists its endpoints.

## Tools

| Tool | Use it for | Fronts |
|---|---|---|
| `resolve_entities` | Turn a name, `@handle`, YouTube URL, or `UC` id into typed `ent_` rows | `GET /v1/entities/search` |
| `search_transcripts` | Short spoken slices for one topic, with watch links and dates | `GET /v1/transcripts/search` |
| `list_mentions` | Has X mentioned Y yet, first seen, last seen | `GET /v1/mentions` |
| `entity_momentum` | Mentions in the last 7 and 30 days against the prior 30, with a verdict | `GET /v1/entities/{id}/momentum` |
| `count_occurrences` | What a set of shows talks about, and what they share | `GET /v1/mentions/counts` |
| `list_sponsors` | Recurring sponsors of a channel from the ad-read rollup | `GET /v1/channels/{id}/sponsors` |
| `index_status` | What the index holds for a channel, or one transcription job | `GET /v1/channels/{id}/coverage`, `GET /v1/transcriptions/{id}` |

Every tool declares `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`. Every result carries `as_of` where a date applies and a one-sentence `note`.

Good first calls: TBPN is channel `UC-DRzaGnL_vtBUpCFH5M0tg`, Moment of Truth is `UClWkDGXEzsh77GAhs90wpXw`, Ramp is `ent_14`.

## Gates

A gate is an MCP tool result with `isError: true` whose content is the API's error envelope:

```json
{
  "error": {
    "type": "permission_error",
    "code": "filter_requires_paid",
    "message": "The source filter needs Hobby.",
    "param": "source",
    "gate": "plan",
    "unlock": { "tier": "hobby", "url": "https://arcmira.com/pricing?src=mcp-tool", "offer": null },
    "doc_url": "https://arcmira.com/docs/errors#filter_requires_paid",
    "request_id": "req_..."
  }
}
```

Switch on `error.code`, relay `error.unlock.url` to the human, and honor `retry_after_seconds` on `rate_limited`. A 200 that withheld something (Premium transcript text, the paid-versus-organic split, sponsors past the free slice) is a normal result carrying the same body under `access`. The full catalog is at https://arcmira.com/docs/errors.

## Develop

```bash
pnpm install
pnpm dev            # wrangler dev on :8790, API base from .dev.vars
pnpm test           # node:test
pnpm typecheck
pnpm manifest:check # every tool call matches the live OpenAPI document
ARCMIRA_KEY=arc_tk_... node --experimental-strip-types scripts/smoke.ts http://localhost:8790/mcp
```

The tool descriptions are loaded context and are the steering surface. They are maintained in Arcmira's manifest spec first and copied here verbatim; revise there before here.

Copyright Arcmira. All rights reserved. See `LICENSE`.
