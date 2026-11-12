import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiOutbound } from "../src/index.ts";
import { outboundAllowed, type Access } from "../src/sandbox.ts";
import { READ_ONLY_MESSAGES, readOnlyRefusal } from "./read-only-refusal.ts";

interface Sent {
  url: URL;
  method: string;
  body: string | null;
  headers: Headers;
}

/** One request through the outbound with a recording upstream; returns the response and what went upstream. */
async function through(access: Access | undefined, request: Request, upstream: () => Response = () => Response.json({ ok: true })) {
  const proxy = new ApiOutbound({ props: { key: "arc_sk_secret", client: null, ...(access ? { access } : {}) } } as unknown as ExecutionContext, {});
  const sent: Sent[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.redirect, "manual");
    sent.push({ url: new URL(String(input)), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null, headers: new Headers(init?.headers) });
    return upstream();
  }) as typeof fetch;
  try {
    const response = await proxy.fetch(request);
    return { response, sent, body: (await response.json()) as { error?: { code: string; message: string } } };
  } finally {
    globalThis.fetch = original;
  }
}

const post = (path: string, body = "{}", method = "POST") =>
  new Request(`https://api.arcmira.com${path}`, { method, body, headers: { "content-type": "application/json", "idempotency-key": "key-1" } });

describe("the sandbox outbound allowlists", () => {
  it("read allows any GET under /v1, nothing else", () => {
    for (const [method, path, allowed] of [
      ["GET", "/v1/monitors", true],
      ["GET", "/v1/transcripts/dQw4w9WgXcQ", true],
      ["POST", "/v1/transcriptions", false],
      ["POST", "/v1/monitors", false],
      ["PATCH", "/v1/monitors/mon_1", false],
      ["POST", "/v1/monitors/mon_1/entities", false],
      ["POST", "/v1/trackers", false],
      ["POST", "/v1/feedback", false],
      ["DELETE", "/v1/monitors/mon_1", false],
      ["GET", "/api/auth/mcp/tool-calls", false],
      ["GET", "/v1/monitors%2F..%2Fadmin", false],
    ] as const)
      assert.equal(outboundAllowed("read", method, path), allowed, `read ${method} ${path}`);
  });

  it("write adds POST and PATCH under /v1/monitors and PATCH under /v1/trackers, never DELETE or the webhook secret", () => {
    for (const [method, path, allowed] of [
      ["GET", "/v1/me", true],
      ["POST", "/v1/transcriptions", false],
      ["POST", "/v1/monitors", true],
      ["PATCH", "/v1/monitors/mon_1", true],
      ["POST", "/v1/monitors/mon_1/entities", true],
      ["POST", "/v1/monitors/mon_1/trackers", true],
      ["POST", "/v1/trackers", false],
      ["PATCH", "/v1/trackers/trk_1", true],
      ["DELETE", "/v1/monitors/mon_1", false],
      ["DELETE", "/v1/trackers/trk_1", false],
      ["PUT", "/v1/monitors/mon_1", false],
      ["POST", "/v1/monitors/mon_1/webhook-secret/rotate", false],
      ["POST", "/v1/monitorsx", false],
      ["POST", "/v1/feedback", false],
      ["POST", "/v1/keys", false],
      ["PATCH", "/v1/me/settings", false],
    ] as const)
      assert.equal(outboundAllowed("write", method, path), allowed, `write ${method} ${path}`);
  });

  it("a read sandbox refuses a monitor write before any request, and names the write tool", async () => {
    for (const access of [undefined, "read"] as const) {
      const { response, sent, body } = await through(access, post("/v1/monitors"));
      assert.equal(response.status, 403);
      assert.equal(sent.length, 0);
      assert.equal(body.error?.code, "outbound_refused");
      assert.match(body.error?.message ?? "", /arcmira_execute_write/);
    }
  });

  it("a write sandbox refuses DELETE and arbitrary POST with no request", async () => {
    for (const request of [post("/v1/monitors/mon_1", "", "DELETE"), post("/v1/keys"), post("/v1/monitors/mon_1/webhook-secret/rotate")]) {
      const { response, sent, body } = await through("write", request);
      assert.equal(response.status, 403, request.method + " " + request.url);
      assert.equal(sent.length, 0);
      assert.equal(body.error?.code, "outbound_refused");
    }
  });

  it("forwards an allowed POST with its JSON body, Idempotency-Key and the credential the program never holds", async () => {
    const { response, sent } = await through("write", post("/v1/monitors/mon_1/entities", '{"entity_ids":["ent_14"]}'));
    assert.equal(response.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, "POST");
    assert.equal(sent[0].body, '{"entity_ids":["ent_14"]}');
    assert.equal(sent[0].headers.get("idempotency-key"), "key-1");
    assert.equal(sent[0].headers.get("content-type"), "application/json");
    assert.equal(sent[0].headers.get("authorization"), "Bearer arc_sk_secret");
    assert.equal(sent[0].url.searchParams.get("src"), "mcp-tool");
    const read = await through("read", post("/v1/transcriptions", '{"video_id":"dQw4w9WgXcQ"}'));
    assert.equal(read.response.status, 403);
    assert.equal(read.sent.length, 0);
  });

  it("marks every request outside the write tool read-only, never a write tool request, and a program cannot unmark one", async () => {
    const premium = "https://api.arcmira.com/v1/transcripts/dQw4w9WgXcQ?quality=premium";
    for (const access of [undefined, "read"] as const) {
      const { sent } = await through(access, new Request(premium, { headers: { "x-arcmira-read-only": "0" } }));
      assert.equal(sent[0].headers.get("x-arcmira-read-only"), "1", `access ${access}`);
    }
    for (const request of [new Request(premium), post("/v1/monitors")]) {
      const { sent } = await through("write", request);
      assert.equal(sent[0].headers.get("x-arcmira-read-only"), null, request.method + " " + request.url);
    }
  });

  it("answers the API's Premium read_only_request as write_tool_required in the approved words, and any other refusal as the API sent it", async () => {
    const request = () => new Request("https://api.arcmira.com/v1/transcripts/dQw4w9WgXcQ?quality=premium&language=ja");
    const refused = await through("read", request(), () => Response.json(readOnlyRefusal(READ_ONLY_MESSAGES.premium, "req_1"), { status: 403, headers: { "ratelimit-remaining": "3" } }));
    assert.equal(refused.response.status, 403);
    assert.equal(refused.response.headers.get("ratelimit-remaining"), "3");
    assert.deepEqual(refused.body.error, {
      type: "permission_error",
      code: "write_tool_required",
      message:
        "This read would start a Premium transcript or translation, and arcmira_execute_read only reads, so nothing was charged. Run it in arcmira_execute_write. It uses credits from your plan, then your on-demand budget.",
      doc_url: "https://arcmira.com/docs/errors#read_only_request",
      request_id: "req_1",
    });
    const gated = await through("read", request(), () =>
      Response.json({ error: { type: "permission_error", code: "paid_plan_required", message: "paid_plan_required fixture", doc_url: "x", request_id: "req_1" } }, { status: 403 }),
    );
    assert.equal(gated.body.error?.code, "paid_plan_required");
    assert.equal(gated.body.error?.message, "paid_plan_required fixture");
  });

  it("passes any other read_only_request through as the API sent it, code and message, with nothing added", async () => {
    const request = () => new Request("https://api.arcmira.com/v1/channels/UC-DRzaGnL_vtBUpCFH5M0tg/sponsors");
    const reworded = "This request is marked read-only and would have started a Premium transcript, so nothing was charged.";
    for (const message of [READ_ONLY_MESSAGES.sponsors, READ_ONLY_MESSAGES.receipts, READ_ONLY_MESSAGES.owned("dQw4w9WgXcQ"), reworded, undefined]) {
      const sent = readOnlyRefusal(message as string);
      const { body } = await through("read", request(), () => Response.json(sent, { status: 403 }));
      assert.deepEqual(body, JSON.parse(JSON.stringify(sent)), String(message));
    }
  });

  it("refuses a body over the cap, and an authenticated redirect", async () => {
    const big = await through("write", post("/v1/monitors", JSON.stringify({ name: "x".repeat(20_000) })));
    assert.equal(big.response.status, 403);
    assert.equal(big.sent.length, 0);
    const redirected = await through(
      "read",
      new Request("https://api.arcmira.com/v1/transcripts/dQw4w9WgXcQ?quality=premium"),
      () => new Response(null, { status: 302, headers: { location: "https://evil.invalid/stolen" } }),
    );
    assert.equal(redirected.response.status, 502);
    assert.equal(redirected.body.error?.code, "redirect_refused");
  });
});
