import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import pkg from '../package.json' with { type: 'json' };
import { noKeyError, type ApiCall, type ApiClient } from './api.ts';
import { clientLabel, errorResult, withBuild, withRateLimit } from './result.ts';
import type { Access, SandboxHost } from './sandbox.ts';
import { callId, inputState, outline, type Recorder } from './telemetry.ts';
import { APPS_TOOLS, RETIRED_TOOLS, SERVER_INSTRUCTIONS, TOOLS, retiredToolResult, type AnyToolSpec } from './tools.ts';
import { registerWeeklyJobs } from './prompts.ts';

export const MCP_PATH = '/mcp';
export const APPS_PATH = '/mcp/apps';

/** What one MCP path serves. `/mcp/apps` has no instructions: the approved ones name the program tools it leaves out. */
export interface Surface {
  path: string;
  tools: readonly AnyToolSpec[];
  instructions?: string;
}

export const SURFACES: ReadonlyMap<string, Surface> = new Map([
  [MCP_PATH, { path: MCP_PATH, tools: TOOLS, instructions: SERVER_INSTRUCTIONS }],
  [APPS_PATH, { path: APPS_PATH, tools: APPS_TOOLS }],
]);

export interface Caller {
  /** A v1 client bound to one tool call, for the plain tools and the rate-limit meta. Null with no credential. */
  api: ((call: ApiCall) => ApiClient) | null;
  /**
   * The sandbox one tool call's program runs in; its outbound tags every upstream request with the
   * call and refuses every route outside the access allowlist. Null under a deployment without a
   * Worker Loader binding.
   */
  sandbox: ((call: CallTag, access: Access) => SandboxHost) | null;
  /** Takes each finished call's record. Never awaited, and a throw is ignored. */
  record?: Recorder;
}

/** The tool call an upstream request belongs to, and the host that made it. */
export interface CallTag {
  id: string;
  tool: string;
  client: string | null;
}

/**
 * One server per request. Tools close over the caller's credential, so nothing about a caller
 * outlives its request. `deploy` is this Worker's version id, null under local dev.
 */
export function createServer(caller: Caller, deploy: string | null = null, surface: Surface = SURFACES.get(MCP_PATH)!): McpServer {
  const server = new McpServer({ name: 'arcmira', version: pkg.version }, surface.instructions ? { instructions: surface.instructions } : {});
  const build = (result: Parameters<typeof withBuild>[0], api: ApiClient | null) => {
    const execution = z.object({ api_build: z.string().nullable() }).safeParse(result._meta?.['arcmira.com/execution']);
    return withBuild(result, {
      server: pkg.version,
      deploy,
      api: execution.success ? execution.data.api_build : (api?.upstreamBuild() ?? null),
      client: clientLabel(server.server.getClientVersion()),
    });
  };
  for (const tool of surface.tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { ...tool.annotations, title: tool.title },
        _meta: tool._meta,
      },
      async ({ intent, ...input }) => {
        const started = Date.now();
        const call: CallTag = { id: callId(), tool: tool.name, client: clientLabel(server.server.getClientVersion()) };
        // The handshake has completed by the time a tool runs, so the host's name is known here.
        const api = caller.api?.({ ...call, readOnly: tool.annotations.readOnlyHint }) ?? null;
        const sandbox = caller.sandbox;
        const result = build(
          api === null
            ? errorResult(noKeyError())
            : withRateLimit(await tool.run(input, { call, api, sandbox: sandbox ? (access) => sandbox(call, access) : null }), api.rateLimit()),
          api,
        );
        try {
          const execution = result._meta?.['arcmira.com/execution'] as { routes?: string[] } | undefined;
          caller.record?.({
            call_id: call.id,
            tool: tool.name,
            intent: typeof intent === 'string' && intent.trim() ? intent.trim() : null,
            input: inputState(input),
            outline: outline(result),
            api_calls: [...(api?.routes() ?? []), ...(execution?.routes ?? [])],
            latency_ms: Date.now() - started,
            client: call.client,
            server_version: pkg.version,
            deploy,
          });
        } catch {
          // Telemetry never changes what the host gets.
        }
        return result;
      },
    );
  }
  if (surface.path === MCP_PATH) registerWeeklyJobs(server);
  return server;
}

export function isRetiredTool(name: string): boolean {
  return Object.hasOwn(RETIRED_TOOLS, name);
}

export { retiredToolResult };
