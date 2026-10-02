import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import pkg from '../package.json' with { type: 'json' };
import { noKeyError, type ApiClient } from './api.ts';
import { clientLabel, errorResult, withBuild, withRateLimit } from './result.ts';
import type { SandboxHost } from './sandbox.ts';
import { READ_ONLY, RETIRED_TOOLS, SERVER_INSTRUCTIONS, TOOLS, retiredToolResult } from './tools.ts';

export const MCP_PATH = '/mcp';

export interface Caller {
  /** The v1 client for this caller, used for the handshake key check and the rate-limit meta. Null with no credential. */
  api: ApiClient | null;
  /** The sandbox this caller's programs run in. Null under a deployment without a Worker Loader binding. */
  sandbox: SandboxHost | null;
}

/**
 * One server per request. Tools close over the caller's credential, so nothing about a caller
 * outlives its request. `deploy` is this Worker's version id, null under local dev.
 */
export function createServer(caller: Caller, deploy: string | null = null): McpServer {
  const server = new McpServer({ name: 'arcmira', version: pkg.version }, { instructions: SERVER_INSTRUCTIONS });
  const build = (result: Parameters<typeof withBuild>[0]) => {
    const execution = z.object({ api_build: z.string().nullable() }).safeParse(result._meta?.['arcmira.com/execution']);
    return withBuild(result, {
      server: pkg.version,
      deploy,
      api: execution.success ? execution.data.api_build : (caller.api?.upstreamBuild() ?? null),
      client: clientLabel(server.server.getClientVersion()),
    });
  };
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { ...(tool.annotations ?? READ_ONLY), title: tool.title },
      },
      async (input) => {
        // The handshake has completed by the time a tool runs, so the host's name is known here.
        caller.api?.setClient(server.server.getClientVersion());
        const result =
          caller.api === null
            ? errorResult(noKeyError())
            : withRateLimit(await tool.run(input, caller.sandbox, caller.api), caller.api.rateLimit());
        return build(result);
      },
    );
  }
  return server;
}

export function isRetiredTool(name: string): boolean {
  return (RETIRED_TOOLS as readonly string[]).includes(name);
}

export { retiredToolResult };
