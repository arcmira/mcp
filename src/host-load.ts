import type { Owner } from './auth.ts';
import { clientLabel } from './result.ts';

/**
 * The two requests a host sends before it can call a tool. A tool call has its own record; these two have none, so a
 * host that connects, reads the tool list and never calls leaves no trace without them.
 */
const EVENTS = { initialize: 'mcp_host_initialize', 'tools/list': 'mcp_host_tools_list' } as const;

/** One log line: who loaded the server, with which host, on which release. */
export interface HostLoadLine extends Owner {
  event: (typeof EVENTS)[keyof typeof EVENTS];
  /** The host as `name/version`: its clientInfo on initialize, the x-arcmira-client header on any other request. */
  client: string | null;
  /** The first product token of the request's user agent. Both lines of one host carry the same one. */
  agent: string | null;
  release: string;
  deploy: string | null;
  path: string;
  /** The source tag on the address the host connected to. */
  listing: string | null;
}

export type HostLoadContext = Omit<HostLoadLine, 'event'>;

/** The host's name is the caller's own text, from clientInfo or a header, so a line keeps this much of it. */
const CLIENT_MAX = 120;

function clientOf(params: unknown): string | null {
  const info = typeof params === 'object' && params !== null ? (params as { clientInfo?: unknown }).clientInfo : null;
  if (typeof info !== 'object' || info === null) return null;
  const { name, version } = info as { name?: unknown; version?: unknown };
  if (typeof name !== 'string' || name === '') return null;
  return clientLabel({ name, ...(typeof version === 'string' ? { version } : {}) });
}

/** A line for each initialize and tools/list message in a request body, a JSON-RPC batch included. None for any other body. */
export function hostLoadLines(body: unknown, context: HostLoadContext): HostLoadLine[] {
  const lines: HostLoadLine[] = [];
  for (const message of Array.isArray(body) ? body : [body]) {
    if (typeof message !== 'object' || message === null) continue;
    const { method, params } = message as { method?: unknown; params?: unknown };
    if (typeof method !== 'string' || !Object.hasOwn(EVENTS, method)) continue;
    lines.push({ event: EVENTS[method as keyof typeof EVENTS], ...context, client: (clientOf(params) ?? context.client)?.slice(0, CLIENT_MAX) ?? null });
  }
  return lines;
}
