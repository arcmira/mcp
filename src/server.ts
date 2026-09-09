import { McpServer } from '@modelcontextprotocol/server';
import pkg from '../package.json' with { type: 'json' };
import { noKeyError, type ApiClient } from './api.ts';
import { clientLabel, errorResult, withBuild, withRateLimit } from './result.ts';
import { READ_ONLY, SERVER_INSTRUCTIONS, TOOLS } from './tools.ts';

export const MCP_PATH = '/mcp';

/**
 * One server per request. Tools close over the caller's key, so nothing about a caller outlives
 * its request. `deploy` is this Worker's version id, null under local dev.
 */
export function createServer(api: ApiClient | null, deploy: string | null = null): McpServer {
  const server = new McpServer({ name: 'arcmira', version: pkg.version }, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: READ_ONLY },
      async (input) => {
        // The handshake has completed by the time a tool runs, so the host's name is known here.
        const host = server.server.getClientVersion();
        api?.setClient(host);
        const result = api === null ? errorResult(noKeyError()) : withRateLimit(await tool.run(input, api), api.rateLimit());
        return withBuild(result, { server: pkg.version, deploy, api: api?.upstreamBuild() ?? null, client: clientLabel(host) });
      },
    );
  }
  return server;
}
