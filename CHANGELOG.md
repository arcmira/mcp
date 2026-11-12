# Changelog

## 0.10.20: the read tools send the read-only mark

A host may run a tool annotated read-only without asking first. Every API request a read-only tool's call sends now carries `x-arcmira-read-only: 1`. The API refuses a marked request that would use credits beyond the read itself or record a new job. This follows the API change of 2026-11-12 that refuses marked requests.

- `arcmira_execute_read` is annotated read-only (`readOnlyHint: true`). The outbound marks every request its program sends, from a client method or a raw `fetch()`. A program's access comes from its tool's annotation, so a program in `arcmira_execute_read` always runs with read access. When the API refuses a Premium read that would start a transcript or translation, the program reads `write_tool_required` with "This read would start a Premium transcript or translation, and arcmira_execute_read only reads, so nothing was charged. Run it in arcmira_execute_write. It uses credits from your plan, then your on-demand budget." Any other refusal of a marked request reaches the program as the API sent it.
- `arcmira_execute_write` starts Premium transcripts and translations, and its requests carry no mark. Its title is "Monitors and Premium transcripts".
- A program in `arcmira_execute_read` that runs past 30 seconds no longer reads that a Premium transcription or monitor change it started may have gone through. A program in `arcmira_execute_write` still does. A call to the retired name `execute` now points to `arcmira_execute_write` for monitor changes and Premium transcripts.
- `arcmira_youtube_search` and `arcmira_youtube_transcript` send the mark on `/mcp` and on `/mcp/apps`. `arcmira_describe` reads nothing from the API. Like every tool call, it sends one record of the call, and that record carries the mark. `arcmira_feedback` sends no mark.
- The record the server posts after each tool call carries that call's mark. Two requests can go out before any tool runs, the key check for an account key and the sign-in session check for a sign-in. They are the same for every tool and carry no mark.
- A marked read still uses what the read uses. A search and a captions read use credits as before, and a transcript the account owns is still served.
- The reference, the server instructions, the `arcmira`, `find-quotes` and `youtube-transcript-search` skills, both READMEs and `llms.txt` say that `arcmira_execute_read` only reads. The routing sentence in the server instructions now ends "or arcmira_execute_write for monitor changes and Premium transcripts." The instructions are 1,938 of 2,000 characters.
- On `/mcp`, an account whose default is Premium may read its Premium transcript in a language it has not been translated into. The note on that captions read now ends "These are captions because the account's Premium transcript of this video has not been translated into Japanese.", with the language named. The API's advice to pass `quality=premium` with the language, and the translation's cost, are left out, since `arcmira_youtube_transcript` takes no `quality`. `/mcp/apps` already left those sentences out. When YouTube offers no captions in the language asked for, the tool's 400 keeps the API's first sentence and leaves out the `quality=premium` advice. A program's read keeps the API's words.
- A test ties each tool's annotation to the mark on both endpoints. A tool annotated read-only that sends a request without `x-arcmira-read-only: 1` fails it, and so does any other tool that sends the header. The test harness now runs the outbound's own code, and the test sees every request a call sends, its record included. Each tool call has its own API client, so a second call in the same HTTP request cannot change the first call's headers. The test sends a read call and a feedback call in one request.
- There are still six tools.

## 0.10.19: /mcp/apps asks for read access only

- `/mcp/apps` asks for `read` and `offline_access` at sign-in. Its protected-resource document lists only those two, and its 401 names them in `scope`. Its search, transcript and feedback tools need nothing more. The consent screen no longer asks to manage monitors and trackers or to read the profile and email address.
- `/mcp` keeps every scope, including the write scopes `arcmira_execute_write` needs.
- Tools and results are unchanged.

## 0.10.18: OpenAI's domain check

- `GET /.well-known/openai-apps-challenge` answers the token OpenAI's publisher portal issued for mcp.arcmira.com, as the whole plain-text body, with no credential. OpenAI's app directory reads it to confirm the domain before it reviews the `/mcp/apps` app.
- Tools, results and `/mcp` are unchanged.

## 0.10.17: mentions name their id and link, and /mcp/apps keeps entity names

- `arcmira_describe` lists each mention row's `id` and `media.url`, which `arcmira.mentions` already returned. A program can key a row on the mention id and link the video without building the URL.
- On `/mcp/apps`, the names in `resolved` and `options` stay as written. They are data, like a result title, so a show or company such as "The Free Press" keeps its name. A sentence beside them that names a plan is still removed.
- On `/mcp/apps`, each refusal detail keeps one shape: `options` as `{id, label}`, `languages` as `{code, name, generated}`, `resolved` as `{filter, name, matched, id, assumed}`, and `reason`, `state` and `call_id` as strings. A field the API adds later is left out.
- On `/mcp/apps`, discounts, coupons, promo codes and a percent off count as offers, so a sentence that names one is removed.
- On `/mcp/apps`, a watch link is left out when a parameter other than its first video and second names an offer, holds another link, or does not decode. A link whose other parameters name none, such as `src`, stays. A YouTube watch link inside a sentence or a parameter is checked the same way.
- `/mcp` is unchanged.
- The apps test exempts only those name fields, and keeps a case that proves a plan word beside them still fails.

## 0.10.16: /mcp/apps names no plan, and monitors.alerts

`/mcp/apps` is the surface app stores list, so its results name no plan, price, offer or upgrade link.

- A refusal there says what happened in a plan-free sentence.
  - A search filter the account can't use gets "The before filter isn't available here. Search again without it."
  - Dates past the account's newest get "Results here cover videos published up to 2026-10-11. Set after to 2026-10-11 or earlier."
  - Used-up credits get "This account is out of Arcmira credits for now."
  - A video with no caption lines gets "This video has no caption track Arcmira can read, so there are no lines to return."
  - A transcript Arcmira is still preparing gets "Arcmira is still preparing this transcript. Read it again in a minute." Any other transcript that isn't ready gets "Arcmira can't return this here."
  - Other refusals keep only their sentences that name no plan, price, offer or link.
- A refusal's code names no plan there: `filter_requires_paid` reads `filter_unavailable`, `freshness_requires_paid` reads `outside_date_range`, and any other code that names a plan reads `not_available`.
- Asking for a credential there names no sign-up offer or link: "No credential was sent. Sign in through the host, or send Authorization: Bearer with an account key." A refused key gets "The key sent has been revoked." or "The key sent is not a live account key."
- A video YouTube has no record of gets the API's own sentence, "YouTube has no video with this id. It may have been removed or the link may be mistyped.", with no caption note, on both paths.
- A search whose results stop before today says which dates it covers: "These results cover videos published from 2026-08-12 to 2026-10-11."
- Results there carry no `unlock`, `freshness`, `access`, gate or doc link. Answers keep only the fields the tools know: a search's `window` keeps `after` and `before`, its `search_index` keeps `state` and `missing_before`, and feedback keeps `feedback_id`.
- A result's `watch_url` there is a YouTube or Arcmira watch link, or is left out. A refusal's other fields drop any value that names a plan, a price or another link. The feedback tool's description there leaves out "Costs nothing."
- A tool name `/mcp` retired is an unknown tool on `/mcp/apps`, which never served it.
- `/mcp` keeps the API's words, codes, unlocks and field order unchanged.
- A test sends every refusal and note through each `/mcp/apps` route and fails on a plan name, also inside a snake_case code, on a gate field, or on a link other than a YouTube watch link. The transcript kind `arcmira_premium` passes only as a `source` filter value or a result's `source`.

The program client gains `arcmira.monitors.alerts(monitorId, { limit? })`, a read of `GET /v1/monitors/{id}/alerts`: the alerts a monitor sent, newest first, each with the `video_id` that `transcript(video)` reads. An agent with the MCP server can now act on a monitor's alerts without an API key.

## 0.10.15: six weekly-job prompts on /mcp

`/mcp` now serves six MCP prompts: `weekly-brand-watch`, `weekly-competitor-reads`, `weekly-person-tracker`, `weekly-sponsor-scout`, `weekly-show-digest` and `weekly-monitor-roundup`. Picking one runs the job once now. Then it gives back the job with the names filled in, and the steps to run it every week as a scheduled task.

- Each prompt takes one optional argument. With no names, or names that look cut off, the message asks for them first. Claude Code splits prompt arguments on whitespace, so a long list can arrive cut off.
- When a plan can't read the newest dates, the job says so in one line and runs the same search over the newest 7 days it can read.
- `/mcp/apps` serves no prompts. `tools/list` is unchanged on both paths.

## 0.10.14: Claude Code loads the reference, the program runner and feedback upfront

The server instructions tell an agent to call `arcmira_describe` before writing a program, but in Claude Code's default view `arcmira_describe` waited behind tool search, and so did `arcmira_feedback`. This release loads both upfront beside `arcmira_execute_read`, and routes the instructions to programs.

- `_meta: { "anthropic/alwaysLoad": true }` moves from `arcmira_youtube_search` and `arcmira_youtube_transcript` to `arcmira_describe` and `arcmira_feedback`. `arcmira_execute_read` keeps it. The two plain read tools stay on `/mcp` behind tool search, and on `/mcp/apps` as before.
- What Claude Code loads upfront from `/mcp`, server instructions included, falls from 9,325 to 6,754 characters, about 2,330 to 1,690 tokens.
- The routing sentence is now "Call arcmira_describe once, then write one program per question for arcmira_execute_read, or arcmira_execute_write for monitor changes. One video needs no reference: return await arcmira.transcript(url, { start, end }); read a long one in start and end windows, one call each." The name sentence is now "Resolve a name with arcmira.resolve when it becomes a filter; filters take ids only." The instructions are 1,914 of 2,000 characters.
- In a blind tool-choice test of this text, with 3 Haiku and 3 Sonnet runs, every Arcmira request went to an Arcmira tool and every control avoided Arcmira. Keeping 0.10.13's routing with the new upfront set did worse: 4 misses in 6 runs, and agents still loaded the plain tools through tool search. Without the long-video clause, 1 run in 6 sent a complete 3-hour transcript to another server's transcript tool, citing the 12,000-character output cap. With it, all 6 read it in windows.
- The `category` and `call_id` descriptions in `arcmira_feedback` are shorter. The enum and the pattern already carry the rest.

## 0.10.13: the plain tools in Claude Code's first view, and arcmira.price

A blind tool-choice test on 0.10.11 found that in Claude Code's default view the two plain tools almost never got picked: 0 to 2 of 24 per run. Only `arcmira_execute_read` loaded upfront, and the server instructions sent one-video reads to it. With every description visible, the plain tools took 82% to 85% of picks. This release makes that the default.

- `arcmira_youtube_search` and `arcmira_youtube_transcript` carry `_meta: { "anthropic/alwaysLoad": true }` in tools/list and the server card, beside `arcmira_execute_read`. Claude Code shows all three in full before any tool search.
- The server instructions route by task. "One video, read whole: arcmira_youtube_transcript. A quote or topic across videos: arcmira_youtube_search." replaces "One video: arcmira_execute_read with return await arcmira.transcript(url, { start, end }) needs no reference." In a pilot of that sentence, pasted-link reads went to `arcmira_youtube_transcript` 54 of 54 times, up from 3. Both whole-transcript misses, which blamed the program tool's 12,000-character cap, went away.
- The name sentence now says "arcmira_youtube_search takes a show, speaker or subject by name. In a program, resolve a name with arcmira.resolve when it becomes a filter; filters there take ids only." In a pilot of both sentences, cross-video asks went to `arcmira_youtube_search` 30 of 45 times for Sonnet, up from 2, and 32 of 45 for Haiku. Every request and control still scored right. The hint to pass the user's words as context stays in the describe reference's ID rule. The instructions are 1,980 of 2,000 characters.
- The `arcmira_youtube_search` description adds "who sponsors a channel, or which creators recommend a product". `/mcp/apps` has no server instructions, and a sponsor question there once went to web search.
- The price check in code mode is now `arcmira.price(video)`: the credits a Premium read of the whole video would use, and how much would come from the on-demand budget. It uses no credits. Everywhere else in Arcmira, "quote" means a spoken quote, and agents mixed the two up. `arcmira.quote(video)` still works as the old name until the release after this one. The reference, both skills and the README name only `price`. The API route and its `quote` field keep their names.

## 0.10.12: the /mcp/apps caption note says there is no Premium transcript

On `/mcp/apps`, when an account whose default transcript quality is Premium owns no Premium transcript of a video, the caption read's note now opens with "This account has no Premium transcript of this video, so these are the video's own captions." The API's own opening sentence, which says the same thing about the caption track, is dropped, and the rest of its note follows as sent. The note names no price, credits, quality argument or other tool. 0.10.11 had removed the sentence, and this brings back the fact in the order a reader needs it. `/mcp` is unchanged.

## 0.10.11: no tier named in the /mcp/apps caption note

On `/mcp/apps`, a default-Premium account's caption read now keeps only the API's caption note, which says the transcript is the video's own caption track. 0.10.10 added "These are captions because this account has no Premium transcript of this video." there, and directory rules read a paid tier named in a tool answer as promotion. `/mcp` is unchanged.

## 0.10.10: transcript notes without a quality argument

`arcmira_youtube_transcript` no longer passes on advice to use an argument it doesn't take.

- For an account whose default transcript quality is Premium and that owns no Premium transcript of the video, the API serves captions with a note that ends "Pass quality=premium to start one … or quality=captions to drop this note." The tool sends no `quality` and takes none, so the tool now replaces that ending. On `/mcp` the note says "These are captions because this account has no Premium transcript of this video." and then that `arcmira_execute_read` starts one with `arcmira.transcript(video, { quality: "premium" })`, which uses credits. On `/mcp/apps` it keeps only the first sentence, so it names no other tool and no credits. The rest of the API's note, and every other note, is passed on as sent.

## 0.10.9: plain YouTube read tools

Two read-only tools take typed arguments and run no program: `arcmira_youtube_search` and `arcmira_youtube_transcript`. They sit beside code mode, so `/mcp` lists six tools. The four code-mode tools, their annotations and the server instructions are unchanged.

- `arcmira_youtube_search` is one `GET /v1/search`. It takes `query`, `channel`, `about`, `by`, `kind`, `after`, `before`, `source` and `limit`. `channel`, `about` and `by` take names as the user wrote them or ids. Each name is resolved first with one `GET /v1/entities/resolve`, the answer's `resolved` list says what each name matched, and a name with no single match stops the call with `name_not_resolved` and the options. Each result is a passage: its `lines` with the speaker labels the API put on them, the video title, channel, publish date, `start_seconds`, `watch_url`, `video_id`, `channel_id`, `source`, and its `speakers` and `about` entities as ids with names. The answer keeps the API's `window`, `as_of` and `note`, and `search_index`, `freshness`, `access` and `unlock` when the API sends them. With neither `after` nor `before` it covers the last 90 days, the default window the server instructions state.
- `arcmira_youtube_transcript` reads one video's whole transcript in windows, from the 11-character id or any youtube.com or youtu.be link. Each result is a JSON block with the video's title, channel, publish date and `duration_seconds`, `start`, `next_start`, `line_count`, `source`, `language`, `speakers` and `rows_billed`, and then the window's lines as `[second] Speaker: words`. The two blocks stay within the 12,000-character output budget together. A line belongs to the second it starts in, and a window never ends inside a second. So reading on from `next_start` covers the whole video with no gap and no repeated line, and `next_start` is `null` after the last line. A whole-transcript read is no longer cut at 12,000 characters.
- Neither tool starts a Premium transcription. `arcmira_youtube_transcript` sends no `quality`, so the read uses the account's default, and a Premium default reads only transcripts the account already owns. It never sends `retry`, `start` or `end` upstream. A `202 pending` answer or a missing caption track ends the call with `transcript_unavailable` and a note that `arcmira_execute_read` starts a Premium transcription with `arcmira.transcript(video, { quality: "premium" })`, which uses credits.
- What they use: a search uses what any search uses, 4 credits per passage past the first 5. The transcript tool reads the whole video on every call and cuts the window itself. The first call is a captions read of the whole video, 4 credits per started 15 minutes, or nothing for a transcript the account owns. Each later window of the same video and language repeats that read inside the API's seven-day dedupe and uses no credits.
- Both tools are annotated `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: true`. Their titles are "Search what's said on YouTube" and "Read a YouTube transcript", from the listing copy of 2026-11-07. Neither carries `anthropic/alwaysLoad`, since their names say YouTube.
- `/mcp/apps` is a second MCP path on the same OAuth for directories that refuse a program runner. It serves only `arcmira_youtube_search`, `arcmira_youtube_transcript` and `arcmira_feedback`, with no server instructions, and its transcript note names no tool it doesn't serve. Its 401 points at `/.well-known/oauth-protected-resource/mcp/apps`, whose `resource` is `https://mcp.arcmira.com/mcp/apps`. `/mcp` and its metadata are unchanged.
- A gate, a refused credential, a missing video and `freshness_requires_paid` come back as the API sent them, with `isError` and the result's `call_id`. An empty search names its `call_id` too.
- `manifest:check` holds every tool's four hints in one table. It replays both plain tools through the server's own API client against the OpenAPI document, and it fails a plain tool's title, description or input text that has a pricing, plan or trial word or names another tool. `tool_retired` lists the tools from the tool table.
- These are the separate operation tools an OpenAI directory listing needs, and `/mcp/apps` serves them without the program tools.

## 0.10.8: YouTube transcript search

Listings lead with the title "Arcmira: YouTube Transcript Search", and five task skills answer what people search for. The server instructions and tool text lead with YouTube, and `arcmira_execute_read` loads upfront in Claude Code.

- Every manifest that carries a description says "YouTube transcript search and monitoring for your AI: exact quotes, full transcripts and speakers.": `server.json`, `package.json`, both Gemini extensions, the Claude and Cursor marketplaces and the plugin manifests. The Codex plugin and the Agent Plugins marketplace show the display name "Arcmira: YouTube Transcript Search". The server card takes its title from `server.json`.
- Five new task skills: `youtube-transcript-search`, `podcast-transcript-search`, `brand-mention-monitoring`, `what-did-they-say` and `youtube-clip-finder`. Each is generated from `src/skills.ts` like the others, and `examples:check` runs their programs.
- `youtube-clip-finder` gives a YouTube link that opens at the start second, the start and end seconds, and an embed. When the user wants the file, it first says "You need the rights to download, cut or reuse this video. Arcmira finds the moment and gives you the link and the seconds. It grants no rights to the video.", then gives a `yt-dlp --download-sections` command. It never adds cookies or a login and never works around a video's restrictions. A test holds the line word for word and before the command.
- `brand-mention-monitoring` treats an ad-read label as a Pro+ read: `recommendations` can return `recommendations_not_enabled`, and the skill explains the limit and the tier the API reports in `unlock`.
- The server instructions open with what Arcmira does for a YouTube question: any video's transcript from its URL, the exact quote with a timestamped watch link, often who said it, clips, mentions, sponsors and ad reads, and monitors. The second sentence says when to use it: the user shares a youtube.com or youtu.be link to summarize, quote or check, asks what a YouTube video or podcast said, wants a quote or a clip, or asks what YouTube is saying about someone or something, even if the agent thinks it knows, and whenever the user writes "use arcmira". One video needs no reference: `arcmira_execute_read` with `return await arcmira.transcript(url, { start, end })`. The resolve sentence keeps "Pass the user's words about it as context." The instructions are 1,987 characters, under the 2,000 cap, and a test holds the trigger in their second sentence. Every skill's "When to use" section opens with "Use Arcmira when the user asks:".
- Every skill description says "Use Arcmira" and when. The task skills open with it ("Use Arcmira for sponsor research on YouTube, podcasts included: ..."), and the `arcmira` skill says "Use Arcmira when asked what a YouTube video or podcast said, or when the user writes "use arcmira"". It used to trigger only on the Arcmira name. The repo README is titled "Arcmira MCP: YouTube Transcript Search". Both READMEs add "Add "use arcmira" to any question to send it to Arcmira first." under their lead, and their example prompts and the Codex plugin's starter prompts are one approved set.
- The six existing skill descriptions name what people search for, and say "podcasts on YouTube" where they name podcasts. Their names are unchanged, so install counts carry over. Every task skill description stays at 160 characters or under.
- The server instructions state usage in a short form, `BUDGET_SUMMARY`: metered reads use credits from the account's plan, then the on-demand budget Arcmira enforces; no tool takes a spending amount; a blocked read throws `ArcmiraError` with a code, a message naming the limit and `unlock`; and describe has the codes and prices. describe and the `arcmira` skill keep the full `BUDGET_RULE`. Each surface still states one usage rule, once.
- The tool titles are "YouTube research reference" (`arcmira_describe`), "YouTube transcripts and quotes" (`arcmira_execute_read`) and "YouTube mention monitors" (`arcmira_execute_write`). The tool names are unchanged, so permission allowlists and rules that name `arcmira_*` tools still match.
- The tool descriptions state what each tool does, and `arcmira_execute_read` also says when to call it. It opens with "YouTube video and podcast transcripts for questions about what was said", lists summarizing a video from its URL, exact quotes with a timestamped watch link, clips, mentions, sponsors and ad reads, and says next "Use Arcmira when the user shares a youtube.com or youtu.be link, or asks what a YouTube video or podcast said." It shows the one-line programs for one video and for a phrase. `arcmira_describe` names the methods it documents, and `arcmira_execute_write` says monitors alert by email, Slack or webhook. "Even if you think you know" is in the server instructions only; a test keeps it out of every tool description.
- `arcmira_execute_read` carries `_meta: { "anthropic/alwaysLoad": true }` in tools/list and in the server card, so Claude Code loads it at session start instead of behind tool search. A user's Claude Code configuration can override it. No other tool carries it, and a test reads a real tools/list response for that. Its description is 1,201 characters, under the 4,096 that Claude Code keeps of an upfront tool's description.
- No SKILL.md is over 7,900 bytes, since a host may cut a long one (one report puts Codex at 8,000 bytes). The skill build fails a SKILL.md over the cap, and a test measures the files. The `arcmira` skill drops from 9,902 to 6,713 bytes: its monitor line and feedback line move up under "When to use", and its monitor rule, ID rule and doc links move to `references/monitors.md`, `references/id-rule.md` and `references/docs.md`. `company-watch` drops from 12,144 to 7,324 bytes: it keeps the research program, and the monitor rule and the follow and save programs move to `references/monitor.md`. Each SKILL.md links each moved part in one line. `skill:check` compares the references files like the SKILL.md files and fails on a file in the skills folder the build does not write. The method test checks both moved programs, and `examples:check` still runs the moved read program.
- Claude Code cuts server instructions at 4,096 characters, and cut them at 2,048 before v2.1.296. The cap stays at 2,000 characters for those versions and for other hosts.
- The server, plugin and skills are Apache-2.0. The root `LICENSE` is the Apache License 2.0 text the plugin already carried, a root `NOTICE` names the copyright, and `package.json` says `Apache-2.0` like the plugin manifests. A test holds `LICENSE`, `NOTICE` and every manifest license field.
- The `arcmira` skill ships `references/rule.md`, a versioned rule (`<!-- arcmira rule v1 -->`) a user can paste into CLAUDE.md or AGENTS.md to make Arcmira their default for spoken questions. Its "After the answer" section says where the rule is. Anthropic's Software Directory Policy bars software that changes Claude's behavior across sessions or has it pull behavioral instructions from external sources, so no skill, reference file, tool description or the server instructions offers to write the rule or points the agent at instructions to fetch. The skill build and a test refuse that wording (`RULE_PUSH`).
- The README gives the Claude Code install command under its lead ("Claude Code: `claude mcp add --transport http --scope user arcmira https://mcp.arcmira.com/mcp`, then `/mcp` to sign in."), and "Connect Arcmira" ends with "Make it your default. Tell your AI once: "Whenever I ask what someone said on YouTube, use Arcmira."" Both come from the listing copy, like the title, lead and example prompts.
- The Codex plugin's long description and the `youtube-transcript-search` skill description follow the listing copy of 2026-11-07. The skill now says "Use Arcmira to read or summarize a YouTube video from its link, or to search YouTube transcripts across channels: the exact quote and the second."

## 0.10.7: Clear language

The agent text states facts once, matches the API, and fits where hosts read it. Prompted by the Anthropic directory review (2026-10-11) and an audit of every surface the agent reads.

- Usage is stated as facts, not as instructions on what to ask or say. The server instructions, the reference, the `arcmira_execute_read` description, the README and every skill drop "never ask for cents", "do not ask", "without another confirmation" and the scripted replies to a blocked read. Metered reads use credits from the account's plan, then the on-demand budget Arcmira enforces; a search uses 4 credits per passage it returns past the first 5; a Premium read that starts a transcription reports its `charge`; a blocked read fails with the API's `code`, `message` and, when one exists, `unlock`. `manifest:check`, the skill build and the tests refuse the old wording on every surface (`SCRIPTED_SPEND`).
- Each rule has one copy. The usage rule appears once in describe (the Premium note no longer embeds it), once in the server instructions and once in the `arcmira` skill. The monitor procedure is one constant, `MONITOR_RULE`, carried by describe, the `arcmira` skill and `company-watch`; the `arcmira_execute_write` description points at it. The id rule, the captions rule, the coverage note and the feedback line each have one copy per surface. Task skills keep three pick lines and the pick block in each program, and drop the shared boilerplate.
- The server instructions fit Claude Code's 2,048-character cut: 1,995 characters, down from 4,132, which Claude Code cut mid-sentence. `manifest:check` and a test hold them to 2,000. describe drops from 25,161 to 23,124 characters.
- The default window is the last 90 days unless the user names one, narrowed when a name returns more than the answer needs. Describe and every worked example use it. On a plan with a delay, `arcmira.status()` reports `freshness { delay_days, served_through }`, and reads the delay cut say where results stop.
- `arcmira.momentum(entityId, { days })` takes a window from 7 to 365 days (default 30); the verdict and top shows cover it, and each call uses 10 credits at any window. The resolve rules in describe are the 0.10.6 wording again, and the server instructions return `ask.options` for the user to pick: the shorter wording lost names-only eval tasks. describe adds that a name may already be followed by a monitor.
- A blocked read keeps the API's `details.limit` (`kind`, `amount`, `used`, `unit`, `resets_at`) as `ArcmiraError.limit`, and output capping keeps `limit` and `freshness`.
- Claims now match the API: `recommendations` takes `limit` 1..100 (default 10); a captions read uses 4 credits per started 15 minutes of its window; `sponsors` takes `minAdReads`, `status` (`active`, `lapsed`, `ended` or `uncertain`) and `limit` on Pro+ only, and other plans throw `filter_requires_paid`; the error list gains `freshness_requires_paid`, `pagination_gated`, `transcript_unavailable` and `transcript_fetching` and loses the unreachable `tracker_create_retired`; and credits come from the account's plan, not the user's.
- `arcmira.quote(video)` is described as a price check, not a spoken quote, and uses no credits.
- Monitors are offered as one fact: monitors can follow the entities a research turn found, and each alert uses 25 credits from the account's plan, then its on-demand budget. The scripted delivery dialog and "(default daily)" are gone; the API's default frequency is realtime, and `monitors.create` still requires `notify_frequency`.
- Tool results carry facts, not instructions. An empty, error, truncated or ask result names its `call_id` instead of a feedback sentence. A pending Premium read says the same read returns the lines once ready. A failed one says `retry: true` uses credits again and is sent only when the user asks for another attempt.
- A Premium read that finishes within the client's wait keeps the `charge` of the transcription it started.
- describe opens with the version alone. Speaker-coverage examples that would go stale are gone. Upgrade notes moved from the README to this changelog.
- Annotations are unchanged: `arcmira_execute_read` has been `readOnlyHint: false` since 0.10.4.

## 0.10.6

Follows the `402 on_demand_paused` refusal added to `/v1` on 2026-10-08.

- The budget rule and the error list name `on_demand_paused`: the account's included credits are used and on-demand usage is paused after a declined payment. It carries no unlock and no upgrade. An agent tells the user that an admin of the account must update the card at https://arcmira.com/dashboard/billing, and that on-demand usage resumes once the invoice is paid.
- OpenAPI fixture refreshed.

## 0.10.5

Follows the team account changes to `/v1` (2026-10-08).

- `arcmira.status()` documents `account` (`id`, `name`, `kind` `personal` or `team`, `plan`) and `role` (`owner`, `admin` or `member`): whose plan and credits the key spends, and the user's role there. `email_masked` is the user, not the account.
- The reference names `member_limit` and `fair_use_cap`, two 402 refusals with no unlock. For `member_limit` an agent tells the user to ask a team admin, and offers no upgrade. For `fair_use_cap` an admin turns on or raises on-demand usage, or the hours reset with the month.
- `tracker_create_retired`: `POST /v1/trackers` is gone. `arcmira.monitors.addName` already follows a name inside a monitor.
- `arcmira_execute_write` no longer reaches `POST` under `/v1/trackers`. `PATCH /v1/trackers/{id}` stays.
- OpenAPI fixture refreshed.

## 0.10.4

`arcmira_execute_read` is no longer marked destructive. A Premium read can start a transcription that uses credits, so the tool is still not read-only, but it only adds. `arcmira_execute_write` stays destructive, since it changes monitors you already have.

## 0.10.3

The reference prices a Premium transcript at 300 credits per 15-minute quarter, and alerts use credits from your plan, then your on-demand budget.

## 0.10.2

Paid reads, Premium transcripts included, use credits from your plan, then your on-demand budget. You set that budget in the dashboard, and it is the approval, so an agent never asks you for a cents amount.

- A Premium read of a video not transcribed yet starts transcribing it and uses credits for the whole video. Reading it again while it is pending never uses credits twice. A retry after a failed transcription uses credits again, and an agent sends one only when you ask.
- A program that runs past 30 seconds may still have started a Premium transcription or a monitor change. Running the same Premium read again never uses credits twice; check `arcmira.monitors.list()` before repeating a monitor change.
- Correct the portable Agent Plugins MCP configuration to declare its schema and use `streamable-http`. Cursor continues using the existing host-specific `.mcp.json`; the remote server and other host configurations are unchanged. Kiro client validation and catalog submission remain pending.

## 0.10.1

- Tool annotations now describe effects across every operation a tool can execute. Only reference lookup is read-only. Both program tools can start Premium work and spend account budget; the write tool can also overwrite monitor settings and pause monitors. Both carry destructive and open-world hints. Feedback is an additive, non-idempotent write. Clients may ask for confirmation based on these corrected hints.
- Every tool must declare all four effect hints. The server card, MCP tools/list, manifest checks and smoke checks use these declarations.
- API documentation and OpenAPI links appear near the top of both READMEs. Package homepages and the registry website point to API docs. Codex metadata declares both Read and Write.
- These corrections do not establish OpenAI Directory compatibility. Separate operation tools, entitlement handling and telemetry review remain required before submission.

## 0.10.0

The client follows the cleaned-up v1 API. Ship it right after that backend deploy: the 0.9 reference and skills read response fields the API no longer sends.

- A Premium transcript is one `GET /v1/transcripts/{video_id}?quality=premium`. The API buys inside the read and answers `202` with the job and `Retry-After`; the client reads again at `Retry-After` until 22 seconds into the program, one budget for every Premium read in it, and skips the last read when under 5 seconds remain. It no longer sends `POST /v1/transcriptions` or polls `GET /v1/transcriptions/{id}`, and `arcmira_execute_read` no longer reaches `POST /v1/transcriptions`. Still pending after the wait, the result carries `eta_seconds` and a note with the minutes left. A failed purchase is terminal: `state` `failed` or `refunded` with `job.error` or `last_attempt`, and `{ retry: true }` buys again on the user's ask. A plan without Premium throws `paid_plan_required`. A refusal's quote comes from `error.details.quote`.
- `arcmira.search` calls `GET /v1/search`, and `arcmira.recommendations` calls `GET /v1/recommendations?entity_id=`.
- `after` and `before` go to the API as written, a date or a datetime with offset. `before` is now the first day left out, as on the API (it was the last day counted). Every dated result echoes `window: { after, before }`.
- Response fields are the API's: `mentions().mentions` and `recommendations().recommendations` (was `data`), a recommendation's `class` `sponsored | organic | mention` (was `mention_class`), and snake_case search chunks (`video_id`, `video_title`, `published_at`, `start_seconds`, `watch_url`, `cite_line`).
- Search `kind` is `sponsored`, `organic` or `mention`, or an array of them.
- Monitor fields are snake_case both ways: `create({ name, notify_frequency, ... })`, `update(id, { paused })`, and `monitors.list()` returns `paused`, `notify_frequency`, `tracker_count`. `attachTrackers` sends `tracker_ids`.
- `arcmira.monitors.addName(monitorId, [{ name, type, personMatchMode? }])` follows exact names before they are indexed (`org` for organization; a show by its UC id) through `POST /v1/monitors/{id}/entities` with `names`, one result per name.
- `arcmira.status({ jobId })` is gone; a pending Premium read returns its own job.
- `pnpm manifest:check <file>` checks the client against an OpenAPI file, and `pnpm examples:spec` runs every worked program against the committed document with no key.

## 0.9.1

A Premium transcript is one read. `arcmira.transcript(video, { quality: "premium" })` returns the lines; when the video is not transcribed yet, the same call buys it at its quote (included credits, then on-demand within the account's budget), waits up to 25 seconds and reads again. Still pending after that: run the same read again, which never buys twice. `arcmira.prepare` and `arcmira.wait` are gone and throw `method_retired` naming the read; `prepare_transcript` now points at it too. `arcmira.quote` still reads the price for free.

## 0.9.0

Four tools with the `arcmira_` prefix, monitors from the agent, and one rule for money.

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

Eval (five name-only tasks with ambiguous names: Mercury, Linear, Chamath, "Sam, the CEO of OpenAI", "All In"): the plugin before this release (arcmira skill only) against this one, one run each on the live 0.7.3 server. Sonnet 5 of 5 in both arms, with 44% fewer input tokens with the task skills. Haiku 1 of 5 without them and 4 of 5 with them, with 63% fewer input tokens; the one miss was a judge error (the quote is verbatim in the transcript lines the run returned). No run picked the wrong entity in either arm.

## 0.7.3

The reference matches the live response shapes. `search` chunks are camelCase on the wire (`videoId`, `videoTitle`, `publishedAt`, `startSeconds`, `channelId`, `channelName`, `watchUrl`), and the 0.7.0 to 0.7.2 reference named them `video_id`, `title`, `published_at`, `start_seconds`, so the first worked example returned undefined for the title and the date. `sponsors` rows carry `sponsor_status.status`, not `status`; `transcript` premium lines carry `speaker` as an id into `speakers[{id, name}]`, and the speaker example maps it to the name. The plugin skill is regenerated.

New: `pnpm examples:check` (`scripts/check-examples.ts`) runs every worked example against production through the sandbox client with `ARCMIRA_KEY` and fails on a thrown error, an empty result, or any undefined leaf in what the program returns. Eight examples, twenty calls. Run it before a release; the shapes come from the API, not from this repo, so no test here can stand in for it.

## 0.7.2

The short description is the 0.6.0 text again in `server.json`, the server card and `package.json`: "Search YouTube and podcast transcripts. Mentions, momentum, sponsors, and organic recommendations." Code mode stays in the long description and the README.

`describe` is shorter and never hides a method. The 0.7.0 bake-off over the remote surface scored 55 to 56 of 60 against 59 for the prototype. The transcripts traced the misses to two things: a reference three times the prototype's length, and `topic`, which dropped every method whose notes did not mention the word, so an agent that asked for `mentions` never saw `occurrences` or `status` and counted mention rows to size a show or a month. The reference now carries one note per method and eight worked examples (the show example returns `status().channel.searchable_videos` beside the latest episode; the month example returns its window so the answer states it), the `search` note says a topic word goes in `query` and a filtered search that finds nothing is rerun without the filter, the `mentions` note says counting episodes is `occurrences`, and `topic` keeps every signature while narrowing the notes and examples to the method named. The tool descriptions and the plugin skill follow.

Two client changes. A string where the options object belongs (`arcmira.search("stablecoins", {...})`) throws `invalid_request` naming the signature instead of `invalid_query`. `before` is the last day counted on every method, the way "the 1st through the 31st" reads: the client sends `published_before` as the next day (v1 treats it as exclusive) and `date_to` as given (v1 treats it as inclusive), so a month is `after: "2026-08-01", before: "2026-08-31"` everywhere.

Bake-off on the local build: shorter reference alone, haiku 16 of 20; plus the topic and client changes, haiku 19 of 20; the full matrix 57 of 60 (opus 20, sonnet 19, haiku 18); with `before` inclusive, 60 of 60 with no wrong-entity answer. Same 20 tasks, gold and judge as the 2026-09-29 bake-off.

## 0.7.1

`arcmira.search` takes `about` (up to 8 entity ids the passage is about), the filter /v1 added for code mode the same night, beside `speakerIds` (`by`) and `kind`. Chunks carry `about[]` and `speakers_by[]` as `{ id, name, type }` where the passage has tags. The reference and the plugin skill name it.

## 0.7.0

Code mode. The ten tools are replaced by two. `describe` returns the reference for a typed JavaScript client whose methods mirror the arcmira CLI commands (`resolve`, `search`, `mentions`, `momentum`, `sponsors`, `recommendations`, `episodes`, `transcript`, `occurrences`, `status`, plus `today()` and `daysAgo(n)`): the id rule first, every method with its arguments and return fields, ten worked example programs, the quirks that cost answers, error codes and doc links; `topic` narrows it. `execute` runs a program against that client in a fresh Dynamic Worker isolate whose only network is `GET api.arcmira.com/v1/*` through the parent's proxy, which adds the caller's credential, so the program never sees the key. Limits: 30 seconds, 5 seconds of CPU, 40 API calls (`call_budget`), 20,000 characters of output. Filters accept verbatim ids only; a name throws `id_required` naming `arcmira.resolve`. A gate throws with the API's code and `unlock`, and `execute` returns it as `ERROR` with `isError: true`. The result is one text block (`console.log` lines, then `RETURN` or `ERROR`) and no `structuredContent`; `_meta["arcmira.com/execution"]` carries the call count and API build; the rate-limit and build `_meta` keys are unchanged.

Why: on 20 tasks and three models, code mode answered 59 of 60 against 56 of 60 for the ten tools, with 1,123 tokens of definitions instead of 8,163 and a median 10,671 input tokens per task instead of 27,191.

The old tool names are retired, not hidden: a `tools/call` for one answers `tool_retired` with the two tools named, so a host with a cached list learns the change. The server instructions, landing document and server card describe the two tools; the card carries `instructions`. `search` sends the new `by` (speaker ids) and `kind` filters, which /v1 is adding; the manifest check warns on them until the OpenAPI document names them.

New: `plugins/arcmira`, an Apache-2.0 plugin with manifests for Claude Code, Codex, Cursor, Agent Plugins and Gemini, bundling the MCP URL and one skill generated from `src/reference.ts` (`pnpm skill:build`; CI checks drift). Marketplace manifests at the repo root make `claude plugin marketplace add arcmira/mcp` work. `scripts/check-manifest.ts` now replays every client method against the live OpenAPI document; `scripts/smoke.ts` runs 22 probes through the two tools. `wrangler.jsonc` gains the `worker_loaders` binding `LOADER`.

Each old tool is one client method: `resolve_entities` is `arcmira.resolve`, `search_transcripts` is `arcmira.search`, `list_mentions` is `arcmira.mentions`, `entity_momentum` is `arcmira.momentum`, `count_occurrences` is `arcmira.occurrences`, `list_episodes` is `arcmira.episodes`, `list_sponsors` is `arcmira.sponsors`, `list_recommendations` is `arcmira.recommendations`, `index_status` is `arcmira.status`, `get_transcript` is `arcmira.transcript`. The `recency` shorthand became `arcmira.daysAgo(n)`.

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
