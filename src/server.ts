import { McpServer } from '@modelcontextprotocol/server';
import pkg from '../package.json' with { type: 'json' };
import { noKeyError, type ApiClient } from './api.ts';
import { errorResult } from './result.ts';
import { READ_ONLY, SERVER_INSTRUCTIONS, TOOLS } from './tools.ts';

export const MCP_PATH = '/mcp';

/** One server per request. Tools close over the caller's key, so nothing about a caller outlives its request. */
export function createServer(api: ApiClient | null): McpServer {
  const server = new McpServer({ name: 'arcmira', version: pkg.version }, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema, annotations: READ_ONLY },
      async (input) => (api === null ? errorResult(noKeyError()) : tool.run(input, api)),
    );
  }
  return server;
}
