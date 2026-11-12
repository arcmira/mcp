import worker from '../src/index.ts';
import type { Env } from '../src/api.ts';
import { forward, type OutboundProps } from '../src/outbound.ts';
import { TOOL_CALLS_PATH } from '../src/telemetry.ts';

export function withFetch<T>(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>, body: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(new URL(input instanceof Request ? input.url : String(input)), init)) as typeof fetch;
  return body().finally(() => {
    globalThis.fetch = original;
  });
}

export interface ToolReply {
  result: { content: Array<{ type: string; text: string }>; structuredContent?: unknown; isError?: boolean; _meta?: Record<string, unknown> };
}

/** One tools/call through the Worker's fetch, the way a host sends it. The reply is one SSE message. */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  upstream: (url: URL, init?: RequestInit) => Response | Promise<Response>,
  env: Record<string, unknown> = {},
  path = '/mcp',
) {
  return (await callTools([{ name, arguments: args }], upstream, env, path))[0]!;
}

/** Several tools/call messages in one HTTP request, as a JSON-RPC batch, through the Worker's fetch. The replies come back in the order of the calls. */
export async function callTools(
  calls: Array<{ name: string; arguments: Record<string, unknown> }>,
  upstream: (url: URL, init?: RequestInit) => Response | Promise<Response>,
  env: Record<string, unknown> = {},
  path = '/mcp',
) {
  const messages = calls.map((params, index) => ({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params }));
  const request = new Request(`https://mcp.arcmira.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer arc_sk_fixture',
    },
    body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
  });
  const deferred: Promise<unknown>[] = [];
  /**
   * The Worker's own outbound for the access the tool asked for, with the test's upstream in place of
   * global fetch. In node the sandbox shares the parent's global fetch, so ApiOutbound's upstream call
   * would be metered as a second program call.
   */
  const outboundFor = ({ props }: { props: OutboundProps }) => ({
    fetch: (request: Request) => forward(request, env as Env, props, async (url, init) => upstream(url, init)),
  });
  const ctx = {
    waitUntil: (p: Promise<unknown>) => deferred.push(p),
    passThroughOnException() {},
    props: {},
    exports: { ApiOutbound: outboundFor },
  } as unknown as ExecutionContext;
  // Tool-call telemetry posts land here, never on the network or the test's upstream.
  const handler = (url: URL, init?: RequestInit) => (url.pathname === TOOL_CALLS_PATH ? new Response(null, { status: 202 }) : upstream(url, init));
  const text = await withFetch(handler, async () => {
    const response = await worker.fetch(request, env, ctx);
    const body = await response.text();
    await Promise.all(deferred);
    return body;
  });
  const data = text.split('\n').filter((line) => line.startsWith('data:'));
  const replies = (data.length > 0 ? data.map((line) => JSON.parse(line.slice(5))) : [JSON.parse(text)]) as Array<ToolReply & { id: number }>;
  return replies.sort((a, b) => a.id - b.id);
}

export const textOf = (reply: ToolReply) => reply.result.content.map((c) => c.text).join('\n');

export interface ListedTool {
  name: string;
  annotations: Record<string, unknown>;
  inputSchema: { properties: Record<string, unknown> };
  _meta?: Record<string, unknown>;
}

/** One tools/list through the Worker's fetch, the way a host sends it. */
export async function listTools(path = '/mcp'): Promise<ListedTool[]> {
  const request = new Request(`https://mcp.arcmira.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer arc_sk_fixture' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const text = await withFetch(() => Response.json({ id: 'caller' }), async () => (await worker.fetch(request, {}, ctx)).text());
  const data = text.split('\n').find((line) => line.startsWith('data:'));
  return (JSON.parse(data ? data.slice(5) : text) as { result: { tools: ListedTool[] } }).result.tools;
}
