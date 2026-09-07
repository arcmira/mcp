# Changelog

## 0.4.0

`get_transcript` now returns the transcript as text in the content block instead of serializing it into the content block and `structuredContent` both. The structured content keeps the video, quality, source, language, and row count, and says under `transcript_in_content` where the lines went. On the wire a 40 minute talk measured 192.1 KiB and a 2h29m podcast 466.1 KiB, each carrying its transcript twice; now it rides once. Errors, the caption-track fallback, and the other seven tools are unchanged.

## 0.3.0

The published baseline: eight read-only tools over the v1 API, sign-in through the host over OAuth or a bearer key, and `get_transcript` for the full transcript of one video.
