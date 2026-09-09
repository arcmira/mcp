import type { ApiErrorBody, ClientInfo, RateLimit } from './api.ts';

/** The _meta key the budget rides under. Namespaced per the MCP spec; hosts pass _meta through and show none of it. */
export const RATE_LIMIT_META = 'arcmira.com/rate_limit';
/** The _meta key the build rides under: which server, which deploy, which API build, and which host asked. */
export const BUILD_META = 'arcmira.com/build';

export interface BuildMeta {
  /** This server's package version. */
  server: string;
  /** This server's Worker deploy id, null under local dev. */
  deploy: string | null;
  /** The API build behind the answer, from v1's X-Arcmira-Build, null when no upstream call was made. */
  api: string | null;
  /** The host that asked, as its initialize handshake named it, null when it named nothing. */
  client: string | null;
}

export function clientLabel(info: ClientInfo | undefined): string | null {
  return info?.name ? `${info.name}${info.version ? `/${info.version}` : ''}` : null;
}

/**
 * The build behind every result, gates included, so a transcript a host keeps can be joined to
 * the exact server and API code that produced it. The HTTP response cannot carry it for the same
 * reason the budget rides here: the reply streams and its headers leave before the tool runs.
 */
export function withBuild(result: ToolResult, build: BuildMeta): ToolResult {
  return { ...result, _meta: { ...result._meta, [BUILD_META]: build } };
}

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
