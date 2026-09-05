/**
 * Static manifest check (SPEC-mcp-manifest section 7.1). Every call a tool makes is replayed
 * against a recording client and matched to the OpenAPI document, so a v1 rename breaks here
 * before it breaks in a directory.
 *
 *   node --experimental-strip-types scripts/check-manifest.ts [openapi-url]
 */
import { z } from 'zod';
import type { ApiClient, Query } from '../src/api.ts';
import { SRC } from '../src/api.ts';
import { READ_ONLY, SERVER_INSTRUCTIONS, TOOLS } from '../src/tools.ts';
import server from '../server.json' with { type: 'json' };

const openapiUrl = process.argv[2] ?? 'https://api.arcmira.com/v1/openapi.json';

/** The registry rejects longer descriptions with a 422 at publish time; catch it here first. */
if (server.description.length > 100) {
  console.error(`server.json description is ${server.description.length} characters; the registry allows 100.`);
  process.exit(1);
}
const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';
const MTS = 'UClWkDGXEzsh77GAhs90wpXw';

/** One representative call per tool, with every optional argument set so every query key is exercised. */
const SAMPLE_INPUTS: Record<string, Record<string, unknown>> = {
  search_transcripts: { query: 'Ramp', channelIds: [TBPN], entityIds: ['ent_14'], recency: 'recent', publishedBefore: '2026-09-01', source: 'creator_captions', maxResults: 5 },
  resolve_entities: { q: 'Ramp', type: 'organization', limit: 8 },
  list_mentions: { entityId: 'ent_14', channelId: TBPN, dateFrom: '2026-01-01', dateTo: '2026-09-01', limit: 10 },
  entity_momentum: { entityIds: ['ent_14'] },
  list_sponsors: { youtubeChannelId: TBPN, minAdReads: 3, status: 'active', limit: 10 },
  index_status: { youtubeChannelId: MTS, jobId: '00000000-0000-4000-8000-000000000000' },
  count_occurrences: { channelIds: [TBPN, MTS], entityIds: ['ent_14'], entityTypes: ['topic'], mode: 'mentions', recency: 'quarter', publishedBefore: '2026-09-01', limit: 20 },
  get_transcript: { video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', quality: 'captions', language: 'en', timestamps: true, range: { start: 0, end: 60 } },
};

interface Operation {
  operationId: string;
  parameters?: Array<{ name: string; in: string; schema?: { enum?: string[] } }>;
}
interface Document {
  paths: Record<string, Record<string, Operation>>;
}

const failures: string[] = [];
function fail(message: string): void {
  failures.push(message);
}

const document = (await (await fetch(openapiUrl, { headers: { accept: 'application/json' } })).json()) as Document;
const operations = new Map<string, { path: string; method: string; operation: Operation }>();
for (const [path, methods] of Object.entries(document.paths)) {
  for (const [method, operation] of Object.entries(methods)) operations.set(operation.operationId, { path, method, operation });
}

function pathMatches(template: string, actual: string): boolean {
  const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`);
  return pattern.test(actual);
}

function recorder(calls: Array<{ path: string; query: Query }>): ApiClient {
  return {
    async get(path, query = {}) {
      calls.push({ path, query });
      const body: Record<string, unknown> = { data: [], chunks: [], cards: [], sponsors: [], rows: [], channel: {}, entity: {}, meta: {}, note: 'x' };
      return { ok: true, status: 200, body } as never;
    },
  };
}

for (const tool of TOOLS) {
  const label = `tool ${tool.name}`;
  if (tool.title.length === 0 || tool.title.length >= 40) fail(`${label}: title missing or 40 characters or more`);
  if (/[—–-]/.test(tool.title)) fail(`${label}: dash in title`);
  if (tool.description.includes('—')) fail(`${label}: em dash in description`);
  if (tool.description.split(/\s+/).length >= 220) fail(`${label}: description is 220 words or more`);
  const schema = z.toJSONSchema(tool.inputSchema) as { properties?: Record<string, { description?: string }> };
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (!property.description) fail(`${label}: input ${name} has no description`);
  }
  for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
    if (READ_ONLY[hint] === undefined) fail(`${label}: annotation ${hint} missing`);
  }
  for (const operationId of tool.fronts) {
    if (!operations.has(operationId)) fail(`${label}: fronts ${operationId}, which is not in ${openapiUrl}`);
  }

  const parsed = tool.inputSchema.safeParse(SAMPLE_INPUTS[tool.name]);
  if (!parsed.success) {
    fail(`${label}: sample input does not parse: ${parsed.error.message}`);
    continue;
  }
  const calls: Array<{ path: string; query: Query }> = [];
  await tool.run(parsed.data, recorder(calls));
  if (calls.length === 0) fail(`${label}: made no v1 call`);
  for (const call of calls) {
    const match = [...operations.values()].find((entry) => entry.method === 'get' && pathMatches(entry.path, call.path));
    if (match === undefined) {
      fail(`${label}: GET ${call.path} matches no operation`);
      continue;
    }
    if (!tool.fronts.includes(match.operation.operationId)) {
      fail(`${label}: calls ${match.operation.operationId}, which fronts does not name`);
    }
    const documented = new Set((match.operation.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name));
    for (const [key, value] of Object.entries(call.query)) {
      if (value === undefined || value === null) continue;
      if (!documented.has(key)) fail(`${label}: sends ${key} to ${match.operation.operationId}, which does not document it`);
    }
    const src = (match.operation.parameters ?? []).find((p) => p.name === 'src' && p.in === 'query');
    if (src === undefined || !(src.schema?.enum ?? []).includes(SRC)) {
      fail(`${label}: ${match.operation.operationId} does not accept src=${SRC}`);
    }
  }
}

if (SERVER_INSTRUCTIONS.includes('—')) fail('server instructions: em dash');

if (failures.length > 0) {
  console.error(`Manifest check against ${openapiUrl} failed:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`Manifest check against ${openapiUrl}: ${TOOLS.length} tools, every call matches a documented operation.`);
