import { it } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES } from "../src/reference.ts";
import { runProgram } from "../src/sandbox.ts";
import { fakeLoader, fakeOutbound } from "./fake-loader.ts";
import responses from "./fixtures/transcription-responses.json" with { type: "json" };

it("every Premium worked example handles ready, pending, purchase required and quota without reading absent lines", async () => {
  const examples = EXAMPLES.filter((example) =>
    example.code.includes('quality: "premium"'),
  );
  assert.ok(examples.length > 0);
  const variants = [
    {
      status: 200,
      body: {
        ...responses.get_transcript.body,
        quality: "premium",
        speakers: [],
      },
    },
    responses.get_transcript.responses["202"],
    {
      status: 403,
      body: {
        error: {
          code: "purchase_required",
          message: "Prepare explicitly",
          quote_url: "/v1/transcripts/dQw4w9WgXcQ/quote",
          prepare_url: "/v1/transcriptions",
        },
      },
    },
    {
      status: 402,
      body: {
        error: {
          code: "quota_exceeded",
          message: "No rows available",
          request_id: "req-quota",
        },
      },
    },
  ];
  for (const example of examples)
    for (const variant of variants) {
      const outbound = fakeOutbound({
        "/v1/channels": () =>
          Response.json({
            episodes: [{ video_id: "dQw4w9WgXcQ", title: "Fixture episode" }],
          }),
        "/v1/transcripts": () =>
          Response.json(variant.body, { status: variant.status }),
      });
      const execution = await runProgram(
        { loader: fakeLoader(), outbound, apiBase: "https://api.arcmira.com" },
        example.code,
      );
      assert.equal(execution.ok, true, example.title);
      if (!execution.ok) continue;
      const result = JSON.parse(JSON.stringify(execution.value));
      if (variant.status === 202) assert.deepEqual(result, variant.body);
      if (variant.status >= 400)
        assert.equal(
          result.error.code,
          "error" in variant.body ? variant.body.error?.code : "unreachable",
        );
      assert.equal(outbound.urls.length, 2);
    }
});
