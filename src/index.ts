import { createMcpHandler } from 'agents/mcp/server';
import pkg from '../package.json' with { type: 'json' };
import { apiKeyOf, createApiClient, type Env } from './api.ts';
import { AUTHORIZATION_SERVER_PATH, PROTECTED_RESOURCE_PATH, authorizationServerMetadata, challenge, isOAuthBearer, protectedResourceMetadata, tokenIsLive } from './auth.ts';
import { ICON_PATH, SERVER_CARD_PATHS, serverCardResponse } from './card.ts';
import { MCP_PATH, createServer } from './server.ts';

// Only the default export: workerd reads every named export of the entry module as an entrypoint.

const BROWSER_ORIGINS = ['claude.ai', 'chatgpt.com', 'localhost', '127.0.0.1'];

function landing(): Response {
  return Response.json({
    name: 'Arcmira MCP',
    version: pkg.version,
    mcp: `https://mcp.arcmira.com${MCP_PATH}`,
    transport: 'streamable-http',
    auth: 'OAuth through the host (sign in at arcmira.com), or Authorization: Bearer <arc_sk_ account key or arc_tk_ trial key>',
    oauth: `https://mcp.arcmira.com${PROTECTED_RESOURCE_PATH}`,
    mint_trial_key: 'POST https://api.arcmira.com/v1/trial-keys?src=mcp-tool',
    server_card: `https://mcp.arcmira.com${[...SERVER_CARD_PATHS][0]}`,
    icon: `https://mcp.arcmira.com${ICON_PATH}`,
    docs: 'https://arcmira.com/docs/mcp',
    source: 'https://github.com/arcmira/mcp',
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === MCP_PATH) {
      const key = apiKeyOf(request);
      if (key === null) return challenge(url.origin);
      if (isOAuthBearer(key) && !(await tokenIsLive(key, env))) return challenge(url.origin);
      const api = createApiClient(env, key);
      return createMcpHandler(() => createServer(api), {
        route: MCP_PATH,
        allowedOriginHostnames: BROWSER_ORIGINS,
      })(request, env, ctx);
    }
    if (url.pathname === PROTECTED_RESOURCE_PATH || url.pathname === `${PROTECTED_RESOURCE_PATH}${MCP_PATH}`) {
      return Response.json(protectedResourceMetadata(url.origin, env), { headers: { 'cache-control': 'public, max-age=300' } });
    }
    if (url.pathname === AUTHORIZATION_SERVER_PATH) return authorizationServerMetadata(env);
    if (SERVER_CARD_PATHS.has(url.pathname)) return serverCardResponse(url.origin);
    if (url.pathname === '/' || url.pathname === '/health') return landing();
    return Response.json({ error: { code: 'not_found', message: `Nothing at ${url.pathname}. The MCP endpoint is ${MCP_PATH}.` } }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
