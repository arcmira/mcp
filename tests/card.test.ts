import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ICON_PATH, SERVER_CARD_PATHS, serverCard, serverCardResponse } from '../src/card.ts';
import { TOOLS } from '../src/tools.ts';
import server from '../server.json' with { type: 'json' };

const ORIGIN = 'https://mcp.arcmira.com';

describe('the server card', () => {
  it('is served on the scanner path and the SEP-2127 path', () => {
    assert.ok(SERVER_CARD_PATHS.has('/.well-known/mcp/server-card.json'));
    assert.ok(SERVER_CARD_PATHS.has('/.well-known/mcp-server-card'));
  });

  it('carries the registry record, the auth routes, and every tool with its title', () => {
    const card = serverCard(ORIGIN) as { name: string; version: string; websiteUrl: string; serverInfo: { name: string; version: string }; authentication: { required: boolean; schemes: string[]; oauth2: { protectedResourceMetadata: string } }; icons: Array<{ src: string }>; remotes: Array<{ url: string; supportedProtocolVersions: string[] }>; tools: Array<{ name: string; title: string; description: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }> };
    assert.equal(card.name, server.name);
    assert.equal(card.version, server.version);
    assert.equal(card.websiteUrl, server.websiteUrl);
    assert.deepEqual(card.serverInfo, { name: 'arcmira', version: server.version });
    assert.equal(card.authentication.required, true);
    assert.deepEqual(card.authentication.schemes, ['oauth2', 'bearer']);
    assert.equal(card.authentication.oauth2.protectedResourceMetadata, `${ORIGIN}/.well-known/oauth-protected-resource`);
    assert.equal(card.icons[0]?.src, `${ORIGIN}${ICON_PATH}`);
    assert.equal(card.remotes[0]?.url, `${ORIGIN}/mcp`);
    assert.ok(card.remotes[0]?.supportedProtocolVersions.includes('2025-06-18'));
    assert.deepEqual(card.tools.map((tool) => tool.name), TOOLS.map((tool) => tool.name));
    for (const tool of card.tools) {
      assert.ok(tool.title.length > 0, `${tool.name} has no title`);
      assert.equal(tool.inputSchema.type, 'object');
      assert.equal(tool.annotations.readOnlyHint, true);
    }
    assert.equal(card.tools.length, 8);
  });

  it('answers as JSON, cacheable for an hour, readable cross-origin', async () => {
    const response = serverCardResponse(ORIGIN);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const body = (await response.json()) as { tools: unknown[] };
    assert.equal(body.tools.length, 8);
  });
});
