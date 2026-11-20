import { WorkerEntrypoint } from 'cloudflare:workers';
import { createMcpHandler } from 'agents/mcp/server';
import pkg from '../package.json' with { type: 'json' };
import { CLIENT_HEADER, DEFAULT_API_BASE, apiKeyOf, createApiClient, listingOf, type Env as ApiEnv } from './api.ts';
import {
  AuthUnavailable,
  AUTHORIZATION_SERVER_PATH,
  PROTECTED_RESOURCE_PATH,
  authorizationServerMetadata,
  challenge,
  isOAuthBearer,
  keyFailure,
  ownerOf,
  protectedResourceMetadata,
  tokenIsLive,
} from './auth.ts';
import { counted, declaresTooLarge, tooLarge } from './body-limit.ts';
import { ICON_PATH, SERVER_CARD_PATHS, serverCardResponse } from './card.ts';
import { hostLoadLines } from './host-load.ts';
import { OPENAI_APPS_CHALLENGE, OPENAI_APPS_CHALLENGE_PATH } from './openai-challenge.ts';
import { APPS_PATH, MCP_PATH, SURFACES, createServer, isRetiredTool, retiredToolResult, type CallTag } from './server.ts';
import { forward, type OutboundProps } from './outbound.ts';
import type { Access, SandboxHost } from './sandbox.ts';
import { agentToken, toolCallRecorder } from './telemetry.ts';
import { TOOL_NAMES } from './tools.ts';

// Every named export of the entry module is an entrypoint to workerd: keep it to the default handler and ApiOutbound.

export interface Env extends ApiEnv {
  /** The Worker Loader the execute sandbox runs in. Absent when the binding is not configured. */
  LOADER?: WorkerLoader;
}

const BROWSER_ORIGINS = ['claude.ai', 'chatgpt.com', 'localhost', '127.0.0.1'];

/**
 * The only network a sandbox program has. Every fetch() inside the isolate lands here; anything
 * not under the Arcmira API is refused, and an API call goes upstream with this caller's
 * credential, which the program never sees.
 */
export class ApiOutbound extends WorkerEntrypoint<Env, OutboundProps> {
  async fetch(request: Request): Promise<Response> {
    return forward(request, this.env, this.ctx.props, (url, init) => fetch(url, init));
  }
}

function landing(): Response {
  return Response.json({
    name: 'Arcmira MCP',
    version: pkg.version,
    mcp: `https://mcp.arcmira.com${MCP_PATH}`,
    transport: 'streamable-http',
    tools: TOOL_NAMES,
    auth: 'OAuth through the host (sign in at arcmira.com), or Authorization: Bearer <arc_sk_ account key>',
    oauth: `https://mcp.arcmira.com${PROTECTED_RESOURCE_PATH}`,
    sign_up:
      'POST https://api.arcmira.com/v1/signups?src=mcp-tool with {"email"}, then /v1/signups/verify with the code',
    server_card: `https://mcp.arcmira.com${[...SERVER_CARD_PATHS][0]}`,
    icon: `https://mcp.arcmira.com${ICON_PATH}`,
    docs: 'https://arcmira.com/docs/mcp-server',
    plugin: 'https://github.com/arcmira/mcp/tree/master/plugins/arcmira',
    source: 'https://github.com/arcmira/mcp',
  });
}

/** The JSON body of a POST, read from a copy so the MCP handler still gets the request whole. Null for any other request. */
async function bodyOf(request: Request): Promise<unknown> {
  if (request.method !== 'POST') return null;
  return request
    .clone()
    .json()
    .catch(() => null);
}

/** A tools/call for a retired tool name, so a host with a cached tool list learns the current tools instead of "not found". */
function retiredCall(message: unknown): Response | null {
  const body = message as {
    id?: unknown;
    method?: string;
    params?: { name?: string };
  } | null;
  const name = body?.params?.name;
  if (body?.method !== 'tools/call' || typeof name !== 'string' || !isRetiredTool(name)) return null;
  return Response.json({
    jsonrpc: '2.0',
    id: body.id ?? null,
    result: retiredToolResult(name),
  });
}

/** One sandbox per tool call, so the outbound tags each upstream request with that call. */
function sandboxFor(env: Env, ctx: ExecutionContext, key: string, inboundClient: string | null, listing: string | null): ((call: CallTag, access: Access) => SandboxHost) | null {
  const loader = env.LOADER;
  if (!loader) return null;
  const { exports } = ctx as unknown as {
    exports: { ApiOutbound: (options: { props: OutboundProps }) => Fetcher };
  };
  return (call, access) => ({
    loader,
    outbound: exports.ApiOutbound({ props: { key, client: call.client ?? inboundClient, listing, call: { id: call.id, tool: call.tool }, access } }),
    apiBase: env.ARCMIRA_API_BASE ?? DEFAULT_API_BASE,
    access,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const surface = SURFACES.get(url.pathname);
    if (surface !== undefined) {
      const key = apiKeyOf(request);
      // The source tag on a listing's copy of the address. It rides to the API on every call and back to the host in the sign-in challenge.
      const listing = listingOf(url);
      if (key === null) return challenge(url.origin, 'no_credential', surface.path, listing);
      let failure;
      try {
        failure = isOAuthBearer(key) ? ((await tokenIsLive(key, env)) ? null : 'invalid') : await keyFailure(key, env);
      } catch (error) {
        if (!(error instanceof AuthUnavailable)) throw error;
        return Response.json(
          {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32000,
              message: error.message,
              data: {
                code: error.status === 429 ? 'rate_limited' : 'auth_upstream_unavailable',
              },
            },
          },
          {
            status: error.status,
            headers: error.retryAfter ? { 'retry-after': error.retryAfter } : {},
          },
        );
      }
      if (failure !== null) return challenge(url.origin, failure, surface.path, listing);
      // A POST that states a length over the limit is refused before any of its body is read. Every other POST body is read through a counter.
      if (request.method === 'POST' && declaresTooLarge(request)) return tooLarge();
      const { request: inbound, over } = request.method === 'POST' ? counted(request) : { request, over: () => false };
      // Read from a copy and not awaited here: the MCP handler answers a request it refuses, a forbidden Origin for one, before its body ends.
      const message = bodyOf(inbound);
      // The retired names were /mcp tools; /mcp/apps never served them.
      const retired = surface.path === MCP_PATH ? retiredCall(await message) : null;
      if (retired !== null) return retired;
      const client = request.headers.get(CLIENT_HEADER);
      const deploy = env.CF_VERSION_METADATA?.id ?? null;
      const record = toolCallRecorder(env, ctx, request, key);
      const response = await createMcpHandler(() => createServer({ api: (call) => createApiClient(env, key, call, listing), sandbox: sandboxFor(env, ctx, key, client, listing), record }, deploy, surface), {
        route: surface.path,
        allowedOriginHostnames: BROWSER_ORIGINS,
      })(inbound, env, ctx);
      // The handler read a body that the counter ended. Its own answer would call the cut body bad JSON.
      if (over()) return tooLarge();
      // A host-load line is written after the handler accepted the request, and never delays or changes the answer.
      if (response.ok) {
        try {
          const owner = ownerOf(key) ?? { account_id: null, user_id: null, oauth_client_id: null };
          const context = { ...owner, client, agent: agentToken(request.headers.get('user-agent')), release: pkg.version, deploy, path: surface.path, listing };
          ctx.waitUntil(
            message
              .then((body) => {
                for (const line of hostLoadLines(body, context)) console.log(JSON.stringify(line));
              })
              .catch(() => undefined),
          );
        } catch {
          // A log line never changes what the host gets.
        }
      }
      return response;
    }
    if (url.pathname === PROTECTED_RESOURCE_PATH || url.pathname === `${PROTECTED_RESOURCE_PATH}${MCP_PATH}`) {
      return Response.json(protectedResourceMetadata(url.origin, env, MCP_PATH, listingOf(url)), { headers: { 'cache-control': 'public, max-age=300' } });
    }
    if (url.pathname === `${PROTECTED_RESOURCE_PATH}${APPS_PATH}`) {
      return Response.json(protectedResourceMetadata(url.origin, env, APPS_PATH), { headers: { 'cache-control': 'public, max-age=300' } });
    }
    if (url.pathname === AUTHORIZATION_SERVER_PATH) return authorizationServerMetadata(env);
    if (SERVER_CARD_PATHS.has(url.pathname)) return serverCardResponse(url.origin);
    if (url.pathname === OPENAI_APPS_CHALLENGE_PATH) {
      return new Response(OPENAI_APPS_CHALLENGE, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/' || url.pathname === '/health') return landing();
    return Response.json(
      {
        error: {
          code: 'not_found',
          message: `Nothing at ${url.pathname}. The MCP endpoint is ${MCP_PATH}.`,
        },
      },
      { status: 404 },
    );
  },
} satisfies ExportedHandler<Env>;
