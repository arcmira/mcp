# Changelog

## 0.9.2

A Premium read still transcribing after its 25-second wait returns `eta_seconds` beside the job, and its note says about how many minutes are left, so the agent can tell the user when to come back.

## 0.9.1

A Premium transcript is one read. `arcmira.transcript(video, { quality: "premium" })` returns the lines; when the video is not transcribed yet, the same call buys it at its quote (included credits, then on-demand within the account's budget), waits up to 25 seconds and reads again. Still pending after that: run the same read again, which never buys twice. `arcmira.prepare` and `arcmira.wait` are gone and throw `method_retired` naming the read; `prepare_transcript` now points at it too. `arcmira.quote` still reads the price for free.

## 0.9.0

Four tools with the `arcmira_` prefix, monitors from the agent, and one rule for money. Owner rulings of 2026-10-02.

- `arcmira_describe` (was `describe`) and `arcmira_execute_read` (was `execute`) are read-only. `arcmira_execute_write` runs the same client with the account writes added: `arcmira.monitors.create`, `arcmira.monitors.update` (including `isPaused`), `arcmira.monitors.addEntities` and `arcmira.monitors.attachTrackers`. It is not read-only and not destructive: nothing is deleted. `arcmira_feedback` takes `category` (`wrong_entity`, `bad_data`, `missing`, `slow`, `confusing`, `other`), `note`, `request_id?` and `call_id?`, and posts one `experience` row to `POST /v1/feedback`. Every tool takes `intent`.
- `prepare_transcript` is gone. `arcmira.prepare(video)` runs inside `arcmira_execute_read`: it reads the quote and sends `POST /v1/transcriptions` with `max_rows` the quoted rows, `max_on_demand_cents` the quoted on-demand cents (0 when included credits cover it) and an Idempotency-Key, and returns the Job for `arcmira.wait`. A Premium read, preparation and the second read now fit in one program.
- The account's on-demand budget is the approval. No surface asks the user for a cents amount any more. When a budget or plan blocks a purchase, the agent tells the user to raise the on-demand budget at https://arcmira.com/dashboard/spending or upgrade at https://arcmira.com/pricing, and links the refusal's `unlock.url`.
- The sandbox outbound enforces an allowlist per tool in the Worker, for client methods and raw `fetch()` alike. Read: `GET /v1/*` and `POST /v1/transcriptions`. Write: the read set plus `POST` and `PATCH` under `/v1/monitors` and `/v1/trackers`, never `DELETE` or the webhook secret rotation. A write method called from the read tool throws `write_tool_required` before any request.
- Reads gain `arcmira.monitors.list()`, `arcmira.monitors.trackers(id)` and `arcmira.integrations.slack()` (the connected workspaces, each with its default channel). Writes also gain `arcmira.monitors.attachTrackers(id, trackerIds)`, which moves a tracker another monitor holds. An `addEntities` result that did not attach carries `reason` (`entity_not_found`, `entity_type_not_trackable`, `tracker_limit_reached`, or `tracked_in_another_monitor` with `current_monitor_id`), and a merged id carries `canonical_entity_id`. `arcmira.status()` with no argument reports the key, plan, credits and on-demand budget.
- A result that is empty, an error, truncated or a resolve `ask` ends with one `feedback` line naming its `call_id`.
- `describe`, `execute` and `prepare_transcript` answer `tool_retired` naming the replacement, like the 0.6.0 names.
- `company-watch` is now the monitor setup skill: it resolves the entities and every spelling of a topic, lists the user's monitors before suggesting one, asks how updates should arrive one question at a time with a default (email or Slack; as it happens, hourly or daily), delivers to a connected Slack workspace or links the connection page and uses email until then, and explains every id that did not attach, asking before it moves a tracker from another monitor. Every skill ends by offering to save what it found to a monitor and with the feedback line.
- `company-watch` answers what was said about a company before it offers the monitor, so "what is being said about Linear" still loads it. With no window from the user, every skill and the server instructions use the last 30 days.
- The protected-resource metadata lists `monitors:write` and `trackers:write`, so Claude, ChatGPT and Claude Code ask for them at sign-in. A connection made before 0.9.0 holds read scopes only: reconnect Arcmira to allow monitor changes.
- Every options object is checked against the method's signature: an unknown key such as `publishedAfter` throws `invalid_request` naming the signature instead of silently dropping a date window. `arcmira.resolve` also takes `{ name, context }`, and a multi-word name with no context that finds nothing says to move the description into `context`.
- Tool definitions plus instructions grow from 2,193 to 2,750 tokens. Skills A/B against 0.8.2 (36 runs each, Sonnet and Haiku): 35/36 correct against 32/36, monitor setup on a read-only key 4/4 against 2/4.

## 0.8.2

Each tool call is logged to Arcmira's product analytics with the account that made it: the tool, the host, the input (the `execute` program up to 4,000 characters, the `describe` topic, the `prepare_transcript` arguments), the outcome without the result body, the API routes the call made, and the latency. The API redacts credentials and email addresses before storing it. The README's [What we log](README.md#what-we-log) section has the whole list.

- Every tool takes an optional `intent` string (at most 300 characters), the user's request in a few words. It is logged with the call and never sent to v1. Hosts that omit it see no change.
- Each upstream v1 request a call makes carries `x-arcmira-mcp-call` (the call's id) and `x-arcmira-mcp-tool`, so the API's request events join the call. Sandbox requests now also carry the host's handshake name as `x-arcmira-client`.
- `_meta["arcmira.com/execution"]` gains `routes`: `METHOD /v1/path` for each API call the program started.
- The record is posted after the result is built, inside `waitUntil`. A failed, slow or refused post is dropped and never changes or delays a result.

## 0.8.1

The `arcmira` skill no longer copies the method reference. It keeps the procedure, the id rule, the Premium step and the access rules, says to call `describe` once before the first `execute` (or `arcmira <command> --help` from the CLI), and lists which task skill fits which ask. It drops from about 7,600 tokens to about 2,400, which Gemini CLI saves on every session because it loads this skill as context. In an A/B on the live server (seven questions, Sonnet and Haiku, two runs each) the new skills scored the same as 0.8.0, 26 of 28, with 8% fewer input tokens. The task skills point at `describe` for the reference. No server behavior changed; the version moves so plugin hosts pick up the new skills.

## 0.8.0

- Preserve bounded execution outcomes and recovery fields ahead of logs. Report actual execution calls, rate limits and API build; mark timeout counts unknown.
- Add `prepare_transcript`, the one tool that spends: it takes `{ video_id }`, prepares Premium from included credits, and returns the Job. Money needs `max_on_demand_cents` above 0, which the user approves in the conversation. Premium GET remains a read and answers `state: preparation_required` with the quote and the action.
- Add `arcmira.quote(video)` for the free whole-video quote and `arcmira.wait(jobOrId)`, which polls a preparation Job for up to 25 seconds inside one `execute`.
- Keep OAuth upstream throttling/outages distinct from invalid credentials; refuse authenticated redirects.

## 0.7.11

- A revoked key's 401 body says to create a new key at https://arcmira.com/dashboard/api and send it with `Authorization: Bearer`. It no longer points at `unlock.url`, which is the sign-up page. The `unlock` object is unchanged.
- In `execute`, an API error whose `param` is `date_from` or `published_after` now names `after`, and one whose `param` is `date_to` or `published_before` names `before`, in both `param` and the message. A program reads "set after to 2026-09-01 or earlier", the option it wrote. Other params are unchanged.
- The README's `claude mcp add` lines pass `--scope user`, so the server works outside the directory it was added in.

## 0.7.10

The Codex `shortDescription` reads "Search YouTube transcripts" (26 characters), inside the OpenAI plugin directory's 30-character subtitle limit. No other text and no server behavior changed; the version moves so plugin hosts pick up the new text.

## 0.7.9

The plugin manifests (Claude, Codex, Cursor, Gemini and the generic `plugin.json`), the Claude and Cursor marketplace entries and `package.json` carry the server card text as their description: "Search YouTube and podcast transcripts. Mentions, momentum, sponsors, and organic recommendations." `server.json` and the server card are unchanged. The Codex `shortDescription` stays "Search YouTube and podcast transcripts": the card text is 99 characters, and the OpenAI plugin directory takes a subtitle of 30 characters or fewer. No server behavior changed; the version moves so plugin hosts pick up the new text.

## 0.7.8

`context` on `arcmira.resolve` holds only words from the user's message. In the 0.7.7 bake-off, several agents asked about "Theo's channel" filled in their own guess ("Theo Von" with context "comedian", or context "Theo Browne channel"). The resolver then confirmed that guess, and those agents answered for one Theo without saying another exists. `describe`, the tool notes and every plugin skill now say so: a bare "Theo" is `resolve("Theo")` with no context, and its ask goes back to the user.

The server side shipped at the same time and needs no client change. A person and the channel named after them no longer compete (`John Coogan` is `best`, the person), and rows with no appearances are never `ask` options.

## 0.7.7

`arcmira.resolve` calls `GET /v1/entities/resolve` and returns the server's answer as it comes: `{ query, context, confidence, best, suggested, ask, candidates, note }`. The client no longer picks a row itself; `pickResolved` and the `/v1/entities/search` call are gone. `resolve(q, { type, context, limit })` takes `context`, the user's own words about the name ("Sam" with "the My First Million co-host").

Every answer is one of three. `best` is the row the name means. `suggested` is the row that stands out when none is certain, with `reason` (`dominant`, `only_word_match`, `context`, `acronym` or `spelling`), `evidence` and `assumed: true`. `ask` holds a question and options when several rows fit and none stands out. Candidates carry `match` (`exact`, `word`, `substring`, `acronym` or `spelling`) and no longer carry a `suggested` flag. The server now handles first names ("Sam" suggests Sam Altman), a name next to a better-known person or show ("Jordan" asks, "Lex" suggests Lex Fridman), show initials ("MFM"), misspellings ("Jensen Hwang") and context ("Mercury" with "the Queen frontman").

The resolve rule in `describe`, the tool description, the server instructions and every plugin skill is rewritten around the three answers. Use `best` and name it. Use `suggested` and tell the user you assumed it, quoting the evidence. Return `ask.options` for the user to pick, or check every option id against the data in one program and answer per row. Pass `context` whenever the user said something about the name. The rules the server now enforces (never take `best` for a one-word person query; `best` can be the wrong row) are gone. Every example program opens with `const e = r.best ?? r.suggested; if (!e) return { ask: r.ask };` and returns `assumed` and `why` beside the entity name. The task skills set `CONTEXT` in their pick block and return `ask` in place of the old `choose` list; for a show, each option carries its `channel_id`.

`search` with `speakerIds` is documented as the backend now serves it: only passages where that person says the query words, each line of `chunk.text` starting with "Name: ", and a `note` on an empty result that says whether the person has labeled lines. A worked example quotes John Coogan's own lines.

## 0.7.6

The five task skills carry the homonym rule too: before asserting a mention, read its description or passage and say which sense of the name it is (Mercury the bank, not the element). 0.7.5 put it in `describe` and the `arcmira` skill only.

## 0.7.5

Answer rules from the 2026-09-30 eval audit, in `describe`, the tool descriptions, the server instructions and every plugin skill:

- A name that resolves to nothing, or only to a different name (another show with a similar name), is not in the index. Say so and offer the nearest names; never answer for a partial-name match without saying so.
- A bare first name ("Sam") is ambiguous. List the people it could be with their appearance counts, or ask with those options; never take `best` for a one-word person query. `resolve` candidates may carry a short `description` to tell them apart.
- Before asserting a mention, read its description or passage and say which sense of the name it is (Mercury the bank, not the element).
- Both tool descriptions and the skill say this server holds the transcript data, and to prefer it over web search for anything said on a show.
- The "say which entity you used" rule stays. A question to the user is a short option list (name, type, appearances), not a generic "which one?".

## 0.7.4

Five task skills ship in the plugin beside `arcmira`: `sponsor-research`, `company-watch`, `find-quotes`, `person-research` and `compare-shows`, picked from what people ask the site chat and the API. Each is generated from `src/skills.ts` by `scripts/build-skill.ts` against the same method table as the reference, so a method or field cannot drift. Every one starts from a name, never an id: it resolves the name, returns a short choose list when candidates are close (name, type, appearances), and states the entity it used. A test fails when a program calls a method the reference does not have, and `pnpm examples:check` now runs the skill programs too (14 programs, all ok against production on 2026-09-30).

The reference gains the fields the programs read (`momentum` `volume.mentions_7d`, `mentions` rows `is_appearance` and `description`, `recommendations` `media.channel_id` and `next_cursor`), and the id rule says `best` can be the wrong person when a close candidate has far more appearances (a bare "Sam" row outranks Sam Altman) and that the answer names the entity it used.

`describe` opens with one line: the server version, that the reference is sent fresh on every call, and that plugin and skill copies should stay on auto-update. No client sends a plugin or skill version, so there is no "update your plugin" hint. Every plugin manifest carries the package version, and a test keeps them equal, so a release reaches plugin users. The README has a Stay up to date section with the command for each host.

Eval (monorepo `scripts/mcp-code-mode-bakeoff/skills-ab.mjs`, five name-only tasks with ambiguous names: Mercury, Linear, Chamath, "Sam, the CEO of OpenAI", "All In"): the plugin before this release (arcmira skill only) against this one, one run each on the live 0.7.3 server. Sonnet 5 of 5 in both arms, with 44% fewer input tokens with the task skills. Haiku 1 of 5 without them and 4 of 5 with them, with 63% fewer input tokens; the one miss was a judge error (the quote is verbatim in the transcript lines the run returned). No run picked the wrong entity in either arm.

## 0.7.3

The reference matches the live response shapes. `search` chunks are camelCase on the wire (`videoId`, `videoTitle`, `publishedAt`, `startSeconds`, `channelId`, `channelName`, `watchUrl`), and the 0.7.0 to 0.7.2 reference named them `video_id`, `title`, `published_at`, `start_seconds`, so the first worked example returned undefined for the title and the date. `sponsors` rows carry `sponsor_status.status`, not `status`; `transcript` premium lines carry `speaker` as an id into `speakers[{id, name}]`, and the speaker example maps it to the name. The plugin skill is regenerated.

New: `pnpm examples:check` (`scripts/check-examples.ts`) runs every worked example against production through the sandbox client with `ARCMIRA_KEY` and fails on a thrown error, an empty result, or any undefined leaf in what the program returns. Eight examples, twenty calls. Run it before a release; the shapes come from the API, not from this repo, so no test here can stand in for it.

## 0.7.2

The short description is the 0.6.0 text again in `server.json`, the server card and `package.json`: "Search YouTube and podcast transcripts. Mentions, momentum, sponsors, and organic recommendations." Code mode stays in the long description and the README.

`describe` is shorter and never hides a method. The 0.7.0 bake-off over the remote surface scored 55 to 56 of 60 against 59 for the prototype. The transcripts traced the misses to two things: a reference three times the prototype's length, and `topic`, which dropped every method whose notes did not mention the word, so an agent that asked for `mentions` never saw `occurrences` or `status` and counted mention rows to size a show or a month. The reference now carries one note per method and eight worked examples (the show example returns `status().channel.searchable_videos` beside the latest episode; the month example returns its window so the answer states it), the `search` note says a topic word goes in `query` and a filtered search that finds nothing is rerun without the filter, the `mentions` note says counting episodes is `occurrences`, and `topic` keeps every signature while narrowing the notes and examples to the method named. The tool descriptions and the plugin skill follow.

Two client changes. A string where the options object belongs (`arcmira.search("stablecoins", {...})`) throws `invalid_request` naming the signature instead of `invalid_query`. `before` is the last day counted on every method, the way "the 1st through the 31st" reads: the client sends `published_before` as the next day (v1 treats it as exclusive) and `date_to` as given (v1 treats it as inclusive), so a month is `after: "2026-08-01", before: "2026-08-31"` everywhere.

Bake-off on the local build (reports/mcp-code-mode-0.7.2-2026-09-30 in the monorepo): shorter reference alone, haiku 16 of 20; plus the topic and client changes, haiku 19 of 20; the full matrix 57 of 60 (opus 20, sonnet 19, haiku 18); with `before` inclusive, 60 of 60 with no wrong-entity answer. Same 20 tasks, gold and judge as the 2026-09-29 bake-off.

## 0.7.1

`arcmira.search` takes `about` (up to 8 entity ids the passage is about), the filter /v1 added for code mode the same night, beside `speakerIds` (`by`) and `kind`. Chunks carry `about[]` and `speakers_by[]` as `{ id, name, type }` where the passage has tags. The reference and the plugin skill name it.

## 0.7.0

Code mode. The ten tools are replaced by two. `describe` returns the reference for a typed JavaScript client whose methods mirror the arcmira CLI commands (`resolve`, `search`, `mentions`, `momentum`, `sponsors`, `recommendations`, `episodes`, `transcript`, `occurrences`, `status`, plus `today()` and `daysAgo(n)`): the id rule first, every method with its arguments and return fields, ten worked example programs, the quirks that cost answers, error codes and doc links; `topic` narrows it. `execute` runs a program against that client in a fresh Dynamic Worker isolate whose only network is `GET api.arcmira.com/v1/*` through the parent's proxy, which adds the caller's credential, so the program never sees the key. Limits: 30 seconds, 5 seconds of CPU, 40 API calls (`call_budget`), 20,000 characters of output. Filters accept verbatim ids only; a name throws `id_required` naming `arcmira.resolve`. A gate throws with the API's code and `unlock`, and `execute` returns it as `ERROR` with `isError: true`. The result is one text block (`console.log` lines, then `RETURN` or `ERROR`) and no `structuredContent`; `_meta["arcmira.com/execution"]` carries the call count and API build; the rate-limit and build `_meta` keys are unchanged.

Why: on 20 tasks and three models, code mode answered 59 of 60 against 56 of 60 for the ten tools, with 1,123 tokens of definitions instead of 8,163 and a median 10,671 input tokens per task instead of 27,191 (`reports/mcp-code-mode-bakeoff-2026-09-29` in the Arcmira monorepo).

The old tool names are retired, not hidden: a `tools/call` for one answers `tool_retired` with the two tools named, so a host with a cached list learns the change. The server instructions, landing document and server card describe the two tools; the card carries `instructions`. `search` sends the new `by` (speaker ids) and `kind` filters, which /v1 is adding; the manifest check warns on them until the OpenAPI document names them.

New: `plugins/arcmira`, an Apache-2.0 plugin with manifests for Claude Code, Codex, Cursor, Agent Plugins and Gemini, bundling the MCP URL and one skill generated from `src/reference.ts` (`pnpm skill:build`; CI checks drift). Marketplace manifests at the repo root make `claude plugin marketplace add arcmira/mcp` work. `scripts/check-manifest.ts` now replays every client method against the live OpenAPI document; `scripts/smoke.ts` runs 22 probes through the two tools. `wrangler.jsonc` gains the `worker_loaders` binding `LOADER`.

## 0.6.0

`list_recommendations`, the tenth tool, lists who recommends one entity on air. Each row is one spoken recommendation with its show, video, `start_seconds`, `watch_url`, verbatim `quote`, `speaker_role`, `promo_code`, `offer`, `confidence`, and `kind`. `sponsored` is a paid ad read. `organic` is a recommendation nobody paid for. `kind` on the input keeps one side, `channelId` checks one show and fills `indexed_through`, and `dateFrom`, `dateTo`, and `limit` (1 to 50) narrow it. It fronts `GET /v1/entities/{id}/recommendations`, needs a Pro plan, and forwards `recommendations_not_enabled` with its unlock link to a free key. The result is JSON in both the text block and `structuredContent`. `list_sponsors` is unchanged and its description now points to the new tool for one brand across every show. The server instructions name the new tool and what sponsored and organic mean.

## 0.5.3

Premium lines name their speaker again. v1 sends each premium line's `speaker` as the diarization id from `speakers[]`, and the renderer only printed a speaker that arrived as a string, so since 0.4.0 every premium line rendered with no speaker. Each line now reads `[start] Name: text`, with the name taken from `speakers[]` and `Speaker <id>` when the list does not name that id. Premium paragraphs from `timestamps: false` carry the same prefix.

## 0.5.2

`get_transcript` shows the lines again in hosts that read `structuredContent`. Since 0.4.0 the lines rode only in the text block while `structuredContent` carried the metadata, and Claude Code shows the model `structuredContent` alone when a result has both, so every call there came back as metadata with no transcript. The result is now two text blocks and no `structuredContent`: the rendered lines first, then the rest of the body as JSON with the video, quality, source, speakers, languages, revision, range, and rows billed. `transcript_in_content` is gone. A body with no transcript, such as a pending premium job, and every gate still answer JSON in both places. `scripts/smoke.ts` fails any result whose `structuredContent` holds less than its text blocks.

## 0.5.1

The 401 says why. `error.data.reason` is `no_credential` when nothing was sent, `invalid` when the key is unknown, `revoked` when v1 says so, with a message for each, so a host holding a stale key mints a new one instead of re-reading its config; the header and the sign-up action are unchanged. The install guide moved to `https://arcmira.com/docs/mcp-server`, since Mintlify serves its docs MCP endpoint at the old path.

## 0.5.0

Trial keys are gone. A connection with no credential still answers the same `WWW-Authenticate` challenge, so a host that speaks the MCP authorization spec signs in exactly as it did before; the body under that challenge now names the sign-up instead of a mint. `error.data.unlock.action` is `{"kind": "send_signup_code", "method": "POST", "url": "https://api.arcmira.com/v1/signups?src=mcp-tool"}` and `error.data.unlock.url` is the docs section that walks the two calls. An `arc_tk_` key sent as the bearer is no longer a credential, and v1 answers it `401 invalid_api_key`. The server instructions, the landing document, the server card, and the README say one thing now: sign in through the host, send an account key, or create an account from an email address with `POST /v1/signups` and `POST /v1/signups/verify`. The nine tools and every forwarded gate are unchanged. The account key is checked against `GET /v1/me` when the connection opens and the verdict cached for five minutes, so a stale or mistyped key meets that same `WWW-Authenticate` challenge at the handshake instead of on its first tool call.

## 0.4.0

`get_transcript` returns the transcript once instead of serializing it into the content block and `structuredContent` both. The text block carries a header and then one `[start] text` line per caption line, or the paragraphs when the caller passed `timestamps: false`. The structured content keeps the video, quality, source, language, and row count, and says under `transcript_in_content` where the rows went. Measured on the wire with `scripts/measure-transcript-bytes.ts`: a 40 minute talk falls from 192.1 KiB to 54.5 KiB, a 2h29m podcast from 466.1 KiB to 159.7 KiB. Errors, the caption-track fallback, and the other seven tools are unchanged.

## 0.3.0

The published baseline: eight read-only tools over the v1 API, sign-in through the host over OAuth or a bearer key, and `get_transcript` for the full transcript of one video.
