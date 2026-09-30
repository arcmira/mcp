import { WorkerEntrypoint } from 'cloudflare:workers';
import { createMcpHandler } from 'agents/mcp/server';
import pkg from '../package.json' with { type: 'json' };
import { CLIENT_HEADER, DEFAULT_API_BASE, SRC, USER_AGENT, apiKeyOf, createApiClient, type Env as ApiEnv } from './api.ts';
import { AUTHORIZATION_SERVER_PATH, PROTECTED_RESOURCE_PATH, authorizationServerMetadata, challenge, isOAuthBearer, keyFailure, protectedResourceMetadata, tokenIsLive } from './auth.ts';
import { ICON_PATH, SERVER_CARD_PATHS, serverCardResponse } from './card.ts';
import { MCP_PATH, createServer, isRetiredTool, retiredToolResult } from './server.ts';
import type { SandboxHost } from './sandbox.ts';

// Every named export of the entry module is an entrypoint to workerd: keep it to the default handler and ApiOutbound.

export interface Env extends ApiEnv {
  /** The Worker Loader the execute sandbox runs in. Absent when the binding is not configured. */
  LOADER?: WorkerLoader;
}

interface OutboundProps {
  key: string;
  client: string | null;
}

const BROWSER_ORIGINS = ['claude.ai', 'chatgpt.com', 'localhost', '127.0.0.1'];

/**
 * The only network a sandbox program has. Every fetch() inside the isolate lands here; anything
 * not under the Arcmira API is refused, and an API call goes upstream with this caller's
 * credential, which the program never sees.
 */
export class ApiOutbound extends WorkerEntrypoint<Env, OutboundProps> {
  async fetch(request: Request): Promise<Response> {
    const base = new URL(this.env.ARCMIRA_API_BASE ?? DEFAULT_API_BASE);
    const url = new URL(request.url);
    if (url.origin !== base.origin || !url.pathname.startsWith('/v1/') || request.method !== 'GET') {
      return Response.json(
        { error: { type: 'invalid_request_error', code: 'outbound_refused', message: `The sandbox reaches only GET ${base.origin}/v1/*. Use the arcmira client methods; there is no other network.`, doc_url: 'https://arcmira.com/docs/mcp-server', request_id: `mcp_${crypto.randomUUID()}` } },
        { status: 403 },
      );
    }
    url.searchParams.set('src', SRC);
    const headers = new Headers({ authorization: `Bearer ${this.ctx.props.key}`, accept: 'application/json', 'user-agent': USER_AGENT });
    if (this.ctx.props.client) headers.set(CLIENT_HEADER, this.ctx.props.client);
    return fetch(url, { method: 'GET', headers });
  }
}

function landing(): Response {
  return Response.json({
    name: 'Arcmira MCP',
    version: pkg.version,
    mcp: `https://mcp.arcmira.com${MCP_PATH}`,
    transport: 'streamable-http',
    tools: ['describe', 'execute'],
    auth: 'OAuth through the host (sign in at arcmira.com), or Authorization: Bearer <arc_sk_ account key>',
    oauth: `https://mcp.arcmira.com${PROTECTED_RESOURCE_PATH}`,
    sign_up: 'POST https://api.arcmira.com/v1/signups?src=mcp-tool with {"email"}, then /v1/signups/verify with the code',
    server_card: `https://mcp.arcmira.com${[...SERVER_CARD_PATHS][0]}`,
    icon: `https://mcp.arcmira.com${ICON_PATH}`,
    docs: 'https://arcmira.com/docs/mcp-server',
    plugin: 'https://github.com/arcmira/mcp/tree/master/plugins/arcmira',
    source: 'https://github.com/arcmira/mcp',
  });
}

/** A tools/call for a 0.6.0 tool name, so a host with a cached tool list learns the two tools instead of "not found". */
async function retiredCall(request: Request): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const body = (await request.clone().json().catch(() => null)) as { id?: unknown; method?: string; params?: { name?: string } } | null;
  const name = body?.params?.name;
  if (body?.method !== 'tools/call' || typeof name !== 'string' || !isRetiredTool(name)) return null;
  return Response.json({ jsonrpc: '2.0', id: body.id ?? null, result: retiredToolResult(name) });
}

function sandboxFor(env: Env, ctx: ExecutionContext, props: OutboundProps): SandboxHost | null {
  if (!env.LOADER) return null;
  const { exports } = ctx as unknown as { exports: { ApiOutbound: (options: { props: OutboundProps }) => Fetcher } };
  return { loader: env.LOADER, outbound: exports.ApiOutbound({ props }), apiBase: env.ARCMIRA_API_BASE ?? DEFAULT_API_BASE };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === MCP_PATH) {
      const key = apiKeyOf(request);
      if (key === null) return challenge(url.origin);
      const failure = isOAuthBearer(key) ? ((await tokenIsLive(key, env)) ? null : 'invalid') : await keyFailure(key, env);
      if (failure !== null) return challenge(url.origin, failure);
      const retired = await retiredCall(request);
      if (retired !== null) return retired;
      const api = createApiClient(env, key);
      const client = request.headers.get(CLIENT_HEADER);
      return createMcpHandler(() => createServer({ api, sandbox: sandboxFor(env, ctx, { key, client }) }, env.CF_VERSION_METADATA?.id ?? null), {
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
