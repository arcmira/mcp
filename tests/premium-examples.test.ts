import { it } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES } from "../src/reference.ts";
import { runProgram } from "../src/sandbox.ts";
import { fakeLoader, fakeOutbound } from "./fake-loader.ts";
import responses from "./fixtures/transcription-responses.json" with { type: "json" };

it("every Premium worked example reads lines only when ready, waits on a pending job, and hands back preparation_required and quota", async () => {
  const examples = EXAMPLES.filter((example) =>
    example.code.includes('quality: "premium"'),
  );
  assert.ok(examples.length > 0);
  const variants = [
    {
      status: 200,
      body: {
        ...responses.get_transcript_ready.body,
        quality: "premium",
        speakers: [],
      },
    },
    responses.get_transcript_pending,
    responses.get_transcript_preparation_required,
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
        "/v1/transcriptions": () => Response.json(responses.get_transcription_ready.body),
        "/v1/transcripts": () =>
          Response.json(variant.body, { status: variant.status }),
      });
      const execution = await runProgram(
        { loader: fakeLoader(), outbound, apiBase: "https://api.arcmira.com" },
        example.code,
      );
      if (variant.status >= 400) {
        assert.equal(execution.ok, false, example.title);
        if (!execution.ok) assert.equal(execution.error.code, "quota_exceeded");
        continue;
      }
      assert.equal(execution.ok, true, example.title);
      if (!execution.ok) continue;
      const result = JSON.parse(JSON.stringify(execution.value));
      const state = "state" in variant.body ? variant.body.state : null;
      if (state !== "ready") assert.deepEqual(result, variant.body);
      assert.equal(outbound.urls.length, state === "pending" ? 3 : 1);
    }
});
