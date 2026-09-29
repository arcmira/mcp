# Changelog

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
