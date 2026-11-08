import worker from '../src/index.ts';
import { outboundAllowed, type Access } from '../src/sandbox.ts';
import { TOOL_CALLS_PATH } from '../src/telemetry.ts';

export function withFetch<T>(handler: (url: URL, init?: RequestInit) => Response, body: () => Promise<T>): Promise<T> {
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
  upstream: (url: URL, init?: RequestInit) => Response,
  env: Record<string, unknown> = {},
  path = '/mcp',
) {
  const request = new Request(`https://mcp.arcmira.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer arc_sk_fixture',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const deferred: Promise<unknown>[] = [];
  /**
   * The outbound for the access the tool asked for, applying the Worker's allowlist (tests/outbound.test.ts
   * covers ApiOutbound itself). In node the sandbox shares the parent's global fetch, so the real
   * outbound's upstream call would be metered as a second program call.
   */
  const outboundFor = ({ props }: { props: { access?: Access } }) => ({
    async fetch(request: Request) {
      const url = new URL(request.url);
      if (!outboundAllowed(props.access ?? 'read', request.method, url.pathname))
        return Response.json({ error: { type: 'invalid_request_error', code: 'outbound_refused', message: 'refused' } }, { status: 403 });
      return upstream(url, { method: request.method, headers: request.headers, body: request.method === 'GET' ? undefined : await request.text() });
    },
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
  const data = text.split('\n').find((line) => line.startsWith('data:'));
  return JSON.parse(data ? data.slice(5) : text) as ToolReply;
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
