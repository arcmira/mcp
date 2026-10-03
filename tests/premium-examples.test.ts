import { it } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES } from "../src/reference.ts";
import { runProgram } from "../src/sandbox.ts";
import { fakeLoader, fakeOutbound } from "./fake-loader.ts";
import responses from "./fixtures/transcription-responses.json" with { type: "json" };

it("every Premium worked example reads lines only when ready, reads again after a pending read, and hands back refusals", async () => {
  const examples = EXAMPLES.filter((example) =>
    example.code.includes('quality: "premium"'),
  );
  assert.ok(examples.length > 0);
  const variants = [
    responses.get_transcript_premium_ready,
    responses.get_transcript_pending,
    responses.get_transcript_spend_limit_exceeded,
    responses.get_transcript_paid_plan_required,
  ];
  for (const example of examples)
    for (const variant of variants) {
      let reads = 0;
      const outbound = fakeOutbound({
        "/v1/transcripts": () => {
          const answer = reads++ === 0 ? variant : responses.get_transcript_premium_ready;
          return Response.json(answer.body, { status: answer.status, headers: { "retry-after": "0" } });
        },
      });
      const execution = await runProgram(
        { loader: fakeLoader(), outbound, apiBase: "https://api.arcmira.com", access: "read" },
        example.code,
      );
      if (variant.status >= 400) {
        assert.equal(execution.ok, false, example.title);
        if (!execution.ok) assert.equal(execution.error.code, (variant.body as { error: { code: string } }).error.code);
        assert.equal(outbound.urls.length, 1);
        continue;
      }
      assert.equal(execution.ok, true, example.title);
      if (!execution.ok) continue;
      assert.ok(Array.isArray(execution.value), example.title);
      assert.equal(outbound.urls.length, variant.status === 202 ? 2 : 1);
      assert.ok(outbound.urls.every((url) => url.pathname === "/v1/transcripts/cdLeJU_1UH8"));
    }
});
