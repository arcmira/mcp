import { createMcpHandler } from 'agents/mcp/server';
import pkg from '../package.json' with { type: 'json' };
import { apiKeyOf, createApiClient, type Env } from './api.ts';
import { MCP_PATH, createServer } from './server.ts';

// Only the default export: workerd reads every named export of the entry module as an entrypoint.

const BROWSER_ORIGINS = ['claude.ai', 'chatgpt.com', 'localhost', '127.0.0.1'];

function landing(): Response {
  return Response.json({
    name: 'Arcmira MCP',
    version: pkg.version,
    mcp: `https://mcp.arcmira.com${MCP_PATH}`,
    transport: 'streamable-http',
    auth: 'Authorization: Bearer <arc_sk_ account key or arc_tk_ trial key>',
    mint_trial_key: 'POST https://api.arcmira.com/v1/trial-keys?src=mcp-tool',
    docs: 'https://arcmira.com/docs',
    source: 'https://github.com/arcmira/mcp',
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === MCP_PATH) {
      const key = apiKeyOf(request);
      const api = key === null ? null : createApiClient(env, key);
      return createMcpHandler(() => createServer(api), {
        route: MCP_PATH,
        allowedOriginHostnames: BROWSER_ORIGINS,
      })(request, env, ctx);
    }
    if (url.pathname === '/' || url.pathname === '/health') return landing();
    return Response.json({ error: { code: 'not_found', message: `Nothing at ${url.pathname}. The MCP endpoint is ${MCP_PATH}.` } }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
