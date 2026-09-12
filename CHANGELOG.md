# Changelog

## 0.5.0

Trial keys are gone. A connection with no credential still answers the same `WWW-Authenticate` challenge, so a host that speaks the MCP authorization spec signs in exactly as it did before; the body under that challenge now names the sign-up instead of a mint. `error.data.unlock.action` is `{"kind": "send_signup_code", "method": "POST", "url": "https://api.arcmira.com/v1/signups?src=mcp-tool"}` and `error.data.unlock.url` is the docs section that walks the two calls. An `arc_tk_` key sent as the bearer is no longer a credential, and v1 answers it `401 invalid_api_key`. The server instructions, the landing document, the server card, and the README say one thing now: sign in through the host, send an account key, or create an account from an email address with `POST /v1/signups` and `POST /v1/signups/verify`. The nine tools and every forwarded gate are unchanged. The account key is checked against `GET /v1/me` when the connection opens and the verdict cached for five minutes, so a stale or mistyped key meets that same `WWW-Authenticate` challenge at the handshake instead of on its first tool call.

## 0.4.0

`get_transcript` returns the transcript once instead of serializing it into the content block and `structuredContent` both. The text block carries a header and then one `[start] text` line per caption line, or the paragraphs when the caller passed `timestamps: false`. The structured content keeps the video, quality, source, language, and row count, and says under `transcript_in_content` where the rows went. Measured on the wire with `scripts/measure-transcript-bytes.ts`: a 40 minute talk falls from 192.1 KiB to 54.5 KiB, a 2h29m podcast from 466.1 KiB to 159.7 KiB. Errors, the caption-track fallback, and the other seven tools are unchanged.

## 0.3.0

The published baseline: eight read-only tools over the v1 API, sign-in through the host over OAuth or a bearer key, and `get_transcript` for the full transcript of one video.
