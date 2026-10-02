import { it } from "node:test";
import assert from "node:assert/strict";
import { ApiOutbound } from "../src/index.ts";

it("sandbox outbound rejects arbitrary POST and refuses authenticated redirects", async () => {
  const proxy = new ApiOutbound(
    {
      props: { key: "arc_sk_secret", client: null },
    } as unknown as ExecutionContext,
    {},
  );
  let requests = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    requests++;
    assert.equal(init?.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.invalid/stolen" },
    });
  };
  try {
    const refused = await proxy.fetch(
      new Request("https://api.arcmira.com/v1/transcriptions", {
        method: "POST",
        body: "{}",
      }),
    );
    assert.equal(refused.status, 403);
    assert.equal(requests, 0);
    const read = await proxy.fetch(
      new Request(
        "https://api.arcmira.com/v1/transcripts/dQw4w9WgXcQ?quality=premium",
      ),
    );
    assert.equal(read.status, 502);
    assert.equal(requests, 1);
    assert.equal(
      ((await read.json()) as { error: { code: string } }).error.code,
      "redirect_refused",
    );
  } finally {
    globalThis.fetch = original;
  }
});
