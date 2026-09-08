import type { ApiErrorBody, RateLimit } from './api.ts';

/** The _meta key the budget rides under. Namespaced per the MCP spec; hosts pass _meta through and show none of it. */
export const RATE_LIMIT_META = 'arcmira.com/rate_limit';

/** A type alias, not an interface: the SDK's result type carries an index signature. */
export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

/**
 * The key's budget after this call, from the latest v1 answer behind it, so a client that watches its
 * spend sees it on every result including a gate. The HTTP response cannot carry it: the handler streams
 * the reply, and its headers leave before the tool runs. Unchanged when no upstream answer carried one.
 */
export function withRateLimit(result: ToolResult, rateLimit: RateLimit | null): ToolResult {
  if (rateLimit === null) return result;
  return { ...result, _meta: { ...result._meta, [RATE_LIMIT_META]: rateLimit } };
}

/** A usable answer, including a 200 that carries an access block for what was withheld. */
export function okResult(body: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
}

/**
 * An answer whose text block is written for the model rather than serialized from the body. The
 * transcript would otherwise ride twice, once as text and once as structured content. The spec's
 * serialized-JSON rule is a SHOULD, and no tool here declares an outputSchema, so nothing
 * validates the text against the body.
 */
export function renderedResult(text: string, structuredContent: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}

/**
 * A gate or failure. The catalog body rides as both the text and the structured content, so an
 * agent that reads either sees the same code, gate, and unlock.
 */
export function errorResult(error: ApiErrorBody): ToolResult {
  const body = { error };
  return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body, isError: true };
}
