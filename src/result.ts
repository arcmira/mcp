import type { ApiErrorBody } from './api.ts';

/** A type alias, not an interface: the SDK's result type carries an index signature. */
export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

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
