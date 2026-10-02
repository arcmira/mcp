import { z } from 'zod';
import { DEFAULT_API_BASE, USER_AGENT, type Env } from './api.ts';
import type { ToolResult } from './result.ts';

/**
 * Where a tool call's record goes: the API, under the MCP prefix the edge already admits for
 * machine callers. The API resolves the account from the same credential v1 reads, applies the
 * analytics privacy boundary (credential redaction, length caps) and sends one PostHog span.
 */
export const TOOL_CALLS_PATH = '/api/auth/mcp/tool-calls';

export const INTENT_MAX = 300;
/** Input strings ride capped; the API caps program text at 4,000 characters again after redaction. */
const INPUT_STRING_MAX = 4_000;

/** The optional parameter every tool takes. The server never sees the user's prompt, so the agent may say it. */
export const intentParam = z
  .string()
  .max(INTENT_MAX)
  .optional()
  .describe("Optional: the user's request in a few words. Logged with this call to improve Arcmira.");

/** What a call came to, without the result body. */
export interface Outline {
  ok: boolean;
  error_code: string | null;
  truncated: boolean;
  result_chars: number;
  calls: number | null;
}

/** One tool call as the API receives it. */
export interface ToolCallRecord {
  call_id: string;
  tool: string;
  intent: string | null;
  input: Record<string, unknown>;
  outline: Outline;
  /** `METHOD /v1/path` for each upstream request, in order. The API reduces each to its route template. */
  api_calls: string[];
  latency_ms: number;
  /** The host, as its handshake named it; null when the request carried no clientInfo. */
  client: string | null;
  server_version: string;
  deploy: string | null;
}

export type Recorder = (record: ToolCallRecord) => void;

export function callId(): string {
  return `mcpc_${crypto.randomUUID().replaceAll('-', '')}`;
}

/** The tool input as it is logged: long strings capped, nothing else changed. Redaction happens in the API. */
export function inputState(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, INPUT_STRING_MAX) : value]),
  );
}

/** The outcome, read from the result the host gets: ok or the error code, size, truncation and call count. */
export function outline(result: ToolResult): Outline {
  const text = result.content.map((block) => block.text).join('');
  let body: unknown = result.structuredContent;
  if (body === undefined) {
    try {
      body = JSON.parse(result.content[0]?.text ?? '');
    } catch {
      body = null;
    }
  }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const error = typeof record.error === 'object' && record.error !== null ? (record.error as Record<string, unknown>) : {};
  const execution = result._meta?.['arcmira.com/execution'] as { calls?: unknown } | undefined;
  return {
    ok: result.isError !== true,
    error_code: result.isError && typeof error.code === 'string' ? error.code : null,
    truncated: record.truncated === true,
    result_chars: text.length,
    calls: typeof execution?.calls === 'number' ? execution.calls : null,
  };
}

const OPAQUE = /^[A-Za-z0-9_.:/+@-]{1,120}$/;

/**
 * The trace a call belongs to. The server is stateless, so there is no session to name unless the
 * host sends Mcp-Session-Id. Otherwise the trace is one credential, one host and one UTC hour: close
 * to an agent session, and the hash keeps the credential out of it.
 */
export async function traceId(sessionHeader: string | null, key: string, host: string | null, now = Date.now()): Promise<string> {
  if (sessionHeader && OPAQUE.test(sessionHeader)) return sessionHeader;
  const hour = Math.floor(now / 3_600_000);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${key}|${host ?? ''}|${hour}`));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `mcpt_${hex.slice(0, 24)}`;
}

/** The first product token of a user agent, `claude-code/2.1.4` from `claude-code/2.1.4 (darwin)`. */
export function agentToken(userAgent: string | null): string | null {
  const token = userAgent?.trim().split(/\s+/)[0] ?? '';
  return OPAQUE.test(token) ? token : null;
}

/**
 * The recorder for one request. Each record is posted after the result is built, inside waitUntil,
 * with the caller's own credential. Nothing here can delay, change or fail a tool result: the post
 * is not awaited by the tool, every error is swallowed, and a failed post is dropped.
 */
export function toolCallRecorder(env: Env, ctx: ExecutionContext, request: Request, key: string): Recorder {
  const base = (env.ARCMIRA_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const session = request.headers.get('mcp-session-id');
  const agent = agentToken(request.headers.get('user-agent'));
  return (record) => {
    const send = async () => {
      const client = record.client ?? agent;
      const trace_id = await traceId(session, key, client);
      const response = await fetch(`${base}${TOOL_CALLS_PATH}`, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({ ...record, client, trace_id }),
      });
      await response.body?.cancel();
    };
    ctx.waitUntil(send().catch(() => undefined));
  };
}
