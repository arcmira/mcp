# Changelog

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
