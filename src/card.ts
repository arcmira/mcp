import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import server from '../server.json' with { type: 'json' };
import { DEFAULT_API_BASE, SRC } from './api.ts';
import { PROTECTED_RESOURCE_PATH } from './auth.ts';
import { READ_ONLY, TOOLS } from './tools.ts';

/**
 * The static server card, for directory scanners that cannot enumerate tools behind the 401
 * (Smithery, mcp.so) and for hosts that discover servers through .well-known. The first path
 * is the one those scanners read today; the second is the path the MCP server-card extension
 * (SEP-2127) names. Both serve one document, built from the same tool table tools/list serves.
 */
export const SERVER_CARD_PATHS: ReadonlySet<string> = new Set(['/.well-known/mcp/server-card.json', '/.well-known/mcp-server-card']);

/** Served by the Workers assets binding from public/; the square icon every directory asks for. */
export const ICON_PATH = '/icon.png';

export function serverCard(origin: string): Record<string, unknown> {
  return {
    $schema: server.$schema,
    name: server.name,
    title: 'Arcmira',
    description: server.description,
    version: server.version,
    websiteUrl: server.websiteUrl,
    repository: server.repository,
    icons: [{ src: `${origin}${ICON_PATH}`, mimeType: 'image/png', sizes: ['512x512'] }],
    remotes: server.remotes.map((remote) => ({ ...remote, supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS })),
    serverInfo: { name: 'arcmira', version: pkg.version },
    authentication: {
      required: true,
      schemes: ['oauth2', 'bearer'],
      oauth2: { protectedResourceMetadata: `${origin}${PROTECTED_RESOURCE_PATH}` },
      bearer: { header: 'Authorization', description: server.remotes[0].headers[0].description },
      trialKey: { method: 'POST', url: `${DEFAULT_API_BASE}/v1/trial-keys?src=${SRC}`, description: 'Mints a free trial key with no login. It reads what a free account reads for seven days.' },
    },
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.inputSchema),
      annotations: READ_ONLY,
    })),
  };
}

export function serverCardResponse(origin: string): Response {
  return Response.json(serverCard(origin), {
    headers: {
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET',
    },
  });
}
