import { describe, it } from "node:test";
import assert from "node:assert/strict";
import contract from "./fixtures/transcription-contract.json" with { type: "json" };
import responses from "./fixtures/transcription-responses.json" with { type: "json" };
import worker from "../src/index.ts";
import pkg from "../package.json" with { type: "json" };
import {
  BUILD_META,
  RATE_LIMIT_META,
  okResult,
  withRateLimit,
} from "../src/result.ts";
import { METHODS } from "../src/reference.ts";
import { fakeLoader, fakeOutbound } from "./fake-loader.ts";

const RATE_LIMIT = { limit: 20, remaining: 17, reset: 1788819360 };

function withFetch<T>(
  handler: (url: URL, init?: RequestInit) => Response,
  body: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) =>
    handler(
      new URL(input instanceof Request ? input.url : String(input)),
      init,
    )) as typeof fetch;
  return body().finally(() => {
    globalThis.fetch = original;
  });
}

interface ToolReply {
  result: {
    content: Array<{ type: string; text: string }>;
    structuredContent?: unknown;
    isError?: boolean;
    _meta?: Record<string, unknown>;
  };
}

/** One tools/call through the Worker's fetch, the way a host sends it. The reply is one SSE message. */
async function callTool(
  name: string,
  args: Record<string, unknown>,
  upstream: (url: URL, init?: RequestInit) => Response,
  env: Record<string, unknown> = {},
) {
  const request = new Request("https://mcp.arcmira.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer arc_sk_fixture",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const outbound = fakeOutbound({ "/v1": (url) => upstream(url) });
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
    exports: { ApiOutbound: () => outbound },
  } as unknown as ExecutionContext;
  const response = await withFetch(upstream, () =>
    worker.fetch(request, env, ctx),
  );
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data:"));
  return JSON.parse(data ? data.slice(5) : text) as ToolReply;
}

const textOf = (reply: ToolReply) =>
  reply.result.content.map((c) => c.text).join("\n");

describe("withRateLimit", () => {
  it("adds the budget under the namespaced _meta key and leaves a result alone without one", () => {
    const plain = okResult({ a: 1 });
    assert.equal(withRateLimit(plain, null), plain);
    const carried = withRateLimit(
      { ...plain, _meta: { other: true } },
      RATE_LIMIT,
    );
    assert.deepEqual(carried._meta, {
      other: true,
      [RATE_LIMIT_META]: RATE_LIMIT,
    });
  });
});

describe("the two tools through the handler", () => {
  it("describe returns the reference as text with no structured copy, and names every method", async () => {
    const reply = await callTool("describe", {}, () => Response.json({}));
    assert.equal(reply.result.isError, undefined);
    assert.equal(reply.result.structuredContent, undefined);
    const text = textOf(reply);
    for (const method of METHODS)
      assert.ok(
        text.includes(`arcmira.${method.name}(`),
        `describe lacks ${method.name}`,
      );
    assert.match(text, /\n\narcmira client/);
    assert.deepEqual(reply.result._meta?.[BUILD_META], {
      server: pkg.version,
      deploy: null,
      api: null,
      client: null,
    });
  });

  it("describe opens with the server version and the update hint", async () => {
    const text = textOf(
      await callTool("describe", {}, () => Response.json({})),
    );
    assert.ok(
      text.startsWith(`arcmira MCP ${pkg.version}. `),
      text.slice(0, 120),
    );
    assert.match(text.split("\n")[0], /auto-update/);
  });

  it("describe with a topic keeps the id rule and narrows the methods", async () => {
    const text = textOf(
      await callTool("describe", { topic: "sponsors" }, () =>
        Response.json({}),
      ),
    );
    assert.match(text, /ID RULE/);
    assert.ok(text.includes("arcmira.sponsors("));
    assert.ok(text.includes("Recurring sponsors of one show"));
    assert.ok(
      text.includes("arcmira.momentum("),
      "every signature stays so no method is hidden",
    );
    assert.ok(
      !text.includes("The last 30 days against the prior 30"),
      "notes of other methods are dropped",
    );
  });

  it("execute runs a program in the loader, and the build names the API behind it", async () => {
    const headers = {
      "RateLimit-Limit": "20",
      "RateLimit-Remaining": "17",
      "RateLimit-Reset": "1788819360",
      "x-arcmira-build": "v-abc123",
    };
    const reply = await callTool(
      "execute",
      { code: 'const m = await arcmira.momentum("ent_14"); return m.verdict;' },
      () => Response.json({ verdict: "flat" }, { headers }),
      { LOADER: fakeLoader() },
    );
    assert.equal(reply.result.isError, undefined);
    assert.equal(JSON.parse(textOf(reply)).value, "flat");
    assert.equal(JSON.parse(textOf(reply)).api_build, "v-abc123");
    assert.deepEqual(reply.result._meta?.[RATE_LIMIT_META], RATE_LIMIT);
    assert.equal(
      (reply.result._meta?.[BUILD_META] as { api: string }).api,
      "v-abc123",
    );
    assert.deepEqual(reply.result._meta?.["arcmira.com/execution"], {
      calls: 1,
      api_build: "v-abc123",
      rate_limit: RATE_LIMIT,
      outcome_uncertain: false,
    });
  });

  it("execute without a loader binding is a server error that says to retry, not a silent miss", async () => {
    const reply = await callTool("execute", { code: "return 1;" }, () =>
      Response.json({}),
    );
    assert.equal(reply.result.isError, true);
    assert.match(textOf(reply), /"code":"sandbox_unavailable"/);
  });

  it("a 0.6.0 tool name answers tool_retired and points at describe", async () => {
    const reply = await callTool("resolve_entities", { q: "Ramp" }, () =>
      Response.json({}),
    );
    assert.equal(reply.result.isError, true);
    assert.match(textOf(reply), /"code":"tool_retired".*describe/);
  });
});

describe("bounded outcomes and explicit preparation over MCP", () => {
  it("preserves pending and quota recovery after 20001 log characters", async () => {
    for (const status of [200, 402, 503]) {
      const pending = responses.get_transcript.responses["202"].body;
      const error = {
        code: status === 402 ? "quota_exceeded" : "server_error",
        message: "recover me",
        retry_after_seconds: 7,
        request_id: "req-123",
        doc_url: "https://arcmira.com/docs/errors",
      };
      const reply = await callTool(
        "execute",
        {
          code: 'console.log("x".repeat(20001)); return await arcmira.transcript("dQw4w9WgXcQ", {quality:"premium"});',
        },
        () =>
          Response.json(status === 200 ? pending : { error }, {
            status,
            headers: {
              "x-arcmira-build": "fixture-build",
              "ratelimit-limit": "20",
              "ratelimit-remaining": "19",
              "ratelimit-reset": "5",
            },
          }),
        { LOADER: fakeLoader() },
      );
      const text = textOf(reply);
      const result = JSON.parse(text);
      assert.ok(text.length <= 20000);
      assert.equal(result.logs_truncated, true);
      assert.equal(result.calls, 1);
      assert.equal(result.api_build, "fixture-build");
      assert.deepEqual(result.rate_limit, {
        limit: 20,
        remaining: 19,
        reset: 5,
      });
      if (status === 200) assert.deepEqual(result.value, pending);
      else {
        assert.equal(reply.result.isError, true);
        assert.equal(result.error.code, error.code);
        assert.equal(result.error.request_id, "req-123");
        assert.equal(result.error.retry_after_seconds, 7);
      }
    }
  });
  it("keeps a continuation token while bounding a long successful page and raw fetch calls", async () => {
    const reply = await callTool(
      "execute",
      {
        code: 'return await (await fetch("https://api.arcmira.com/v1/mentions")).json();',
      },
      () =>
        Response.json({
          rows: Array.from({ length: 1000 }, () => ({
            text: "x".repeat(1000),
          })),
          next_cursor: "signed-next",
          has_more: true,
        }),
      { LOADER: fakeLoader() },
    );
    const result = JSON.parse(textOf(reply));
    assert.ok(textOf(reply).length <= 20000);
    assert.equal(result.value.next_cursor, "signed-next");
    assert.equal(result.value.has_more, true);
    assert.equal(result.truncated, true);
    assert.equal(result.calls, 1);
  });
  it("quotes with GET and prepares only the approved POST with a persisted intent and default zero money ceiling", async () => {
    const calls: Array<{
      path: string;
      method: string;
      body: unknown;
      key: string | null;
    }> = [];
    const upstream = (url: URL, init?: RequestInit) => {
      if (url.pathname !== "/v1/me")
        calls.push({
          path: url.pathname,
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
          key: new Headers(init?.headers).get("idempotency-key"),
        });
      const specPath = url.pathname.replace("dQw4w9WgXcQ", "{video_id}");
      const operation = Object.entries(contract.paths).find(
        ([path]) => path === specPath,
      )?.[1];
      if (url.pathname !== "/v1/me")
        assert.ok(
          operation && (init?.method?.toLowerCase() ?? "get") in operation,
          `Undocumented operation: ${url.pathname}`,
        );
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        const schema =
          contract.paths["/v1/transcriptions"].post.requestBody.content[
            "application/json"
          ].schema;
        for (const key of Object.keys(body))
          assert.ok(key in schema.properties, `Unknown request field ${key}`);
        for (const key of schema.required)
          assert.ok(key in body, `Missing required field ${key}`);
        assert.ok(body.videoId || body.url);
      }
      return Response.json(
        url.pathname.endsWith("/quote")
          ? responses.quote_transcription.body
          : { request: responses.get_transcription.body },
        { status: url.pathname === "/v1/transcriptions" ? 202 : 200 },
      );
    };
    await callTool("quote_transcript", { video_id: "dQw4w9WgXcQ" }, upstream);
    for (let replay = 0; replay < 2; replay++) {
      const result = await callTool(
        "prepare_transcript",
        {
          video_id: "dQw4w9WgXcQ",
          max_rows: 300,
          idempotency_key: "persisted-intent",
        },
        upstream,
      );
      assert.equal(result.result.isError, undefined);
    }
    assert.deepEqual(calls, [
      {
        path: "/v1/transcripts/dQw4w9WgXcQ/quote",
        method: "GET",
        body: null,
        key: null,
      },
      {
        path: "/v1/transcriptions",
        method: "POST",
        body: { videoId: "dQw4w9WgXcQ", max_rows: 300, max_on_demand_cents: 0 },
        key: "persisted-intent",
      },
      {
        path: "/v1/transcriptions",
        method: "POST",
        body: { videoId: "dQw4w9WgXcQ", max_rows: 300, max_on_demand_cents: 0 },
        key: "persisted-intent",
      },
    ]);
    const rejected = await callTool(
      "prepare_transcript",
      {
        video_id: "dQw4w9WgXcQ",
        max_rows: 300,
        idempotency_key: "x",
        path: "/v1/anything",
      },
      upstream,
    );
    assert.equal(rejected.result.isError, true);
    assert.equal(calls.length, 3);
  });
  it("a lost preparation response instructs exact replay without claiming no purchase occurred", async () => {
    const reply = await callTool(
      "prepare_transcript",
      {
        video_id: "dQw4w9WgXcQ",
        max_rows: 300,
        idempotency_key: "lost-intent",
      },
      (url) => {
        if (url.pathname === "/v1/me") return Response.json({ id: "caller" });
        throw new Error("lost acknowledgement");
      },
    );
    assert.equal(reply.result.isError, true);
    const body = JSON.parse(textOf(reply));
    assert.equal(body.error.code, "preparation_outcome_unknown");
    assert.match(body.error.message, /same idempotency_key/);
  });
});

it("preserves the actual data-heavy pending recovery shape and top-level refusal quote", async () => {
  const pending = responses.get_transcript.responses["202"].body;
  const reply = await callTool(
    "execute",
    {
      code: 'return await arcmira.transcript("dQw4w9WgXcQ",{quality:"premium"});',
    },
    () =>
      Response.json({ data: "x".repeat(20001), ...pending }, { status: 202 }),
    { LOADER: fakeLoader() },
  );
  const rendered = JSON.parse(textOf(reply));
  assert.equal(rendered.value.state, "pending");
  assert.equal(rendered.value.status_url, pending.status_url);
  assert.deepEqual(rendered.value.premium_job, pending.premium_job);
  const refusal = {
    error: {
      type: "quota_exceeded",
      code: "max_rows_exceeded",
      message: "Inspect the current quote",
      request_id: "r",
      doc_url: "https://arcmira.com/docs/errors",
    },
    quote: {
      quarters: 4,
      rows: 300,
      charge: { unit: "credits", amount: 1200 },
      max_on_demand_cents: 0,
    },
  };
  const prepared = await callTool(
    "prepare_transcript",
    { video_id: "dQw4w9WgXcQ", max_rows: 75, idempotency_key: "refused" },
    () => Response.json(refusal, { status: 402 }),
  );
  assert.deepEqual(JSON.parse(textOf(prepared)), refusal);
  const read = await callTool(
    "execute",
    {
      code: 'console.log("x".repeat(20001)); return await arcmira.transcript("dQw4w9WgXcQ",{quality:"premium"});',
    },
    () =>
      Response.json(
        {
          ...refusal,
          quote_url: "/v1/transcripts/dQw4w9WgXcQ/quote",
          prepare_url: "/v1/transcriptions",
        },
        { status: 402 },
      ),
    { LOADER: fakeLoader() },
  );
  const error = JSON.parse(textOf(read)).error;
  assert.deepEqual(error.quote, refusal.quote);
  assert.equal(error.quote_url, "/v1/transcripts/dQw4w9WgXcQ/quote");
  assert.equal(error.prepare_url, "/v1/transcriptions");
});

it("unreadable preparation acknowledgement requires same-key recovery", async () => {
  const reply = await callTool("prepare_transcript", {
    video_id: "dQw4w9WgXcQ", max_rows: 300, idempotency_key: "unreadable-intent",
  }, (url) => url.pathname === "/v1/me"
    ? Response.json({ id: "caller" })
    : new Response("truncated acknowledgement", { status: 202 }));
  const body = JSON.parse(textOf(reply));
  assert.equal(body.error.code, "preparation_outcome_unknown");
  assert.match(body.error.message, /same idempotency_key/);
});

it("quote transport failure returns a typed retryable result", async () => {
  const reply = await callTool("quote_transcript", { video_id: "dQw4w9WgXcQ" }, (url) => {
    if (url.pathname === "/v1/me") return Response.json({ id: "caller" });
    throw new Error("connection reset");
  });
  assert.equal(reply.result.isError, true);
  assert.equal(JSON.parse(textOf(reply)).error.code, "upstream_unavailable");
});
