/**
 * Static manifest check. Every call the sandbox client can make is replayed with a recording
 * fetch and matched to the live OpenAPI document, so a v1 rename breaks here before it breaks
 * in a host. Also lints the two tool definitions, the reference text, and server.json.
 *
 *   node --experimental-strip-types scripts/check-manifest.ts [openapi-url]
 */
import { z } from 'zod';
import { SRC } from '../src/api.ts';
import { METHODS, referenceText } from '../src/reference.ts';
import { READ_ONLY, SERVER_INSTRUCTIONS, TOOLS } from '../src/tools.ts';
import server from '../server.json' with { type: 'json' };

const openapiUrl = process.argv[2] ?? 'https://api.arcmira.com/v1/openapi.json';
/** Query params /v1 added for code mode on 2026-09-30; a warning, not a failure, while the OpenAPI document catches up. */
const PENDING_PARAMS = new Set(['about', 'by', 'kind']);
/** Operations that take no src: they are not entry points and mint no unlock links. */
const NO_SRC = new Set(['get_me']);
const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';
const MTS = 'UClWkDGXEzsh77GAhs90wpXw';

const failures: string[] = [];
function fail(message: string): void {
  failures.push(message);
}

/** The registry rejects longer descriptions with a 422 at publish time; catch it here first. */
if (server.description.length > 100) fail(`server.json description is ${server.description.length} characters; the registry allows 100.`);

interface Operation {
  operationId: string;
  parameters?: Array<{ name: string; in: string; schema?: { enum?: string[] } }>;
}
interface Document {
  paths: Record<string, Record<string, Operation>>;
}

const document = (await (await fetch(openapiUrl, { headers: { accept: 'application/json' } })).json()) as Document;
const operations: Array<{ path: string; method: string; operation: Operation }> = [];
for (const [path, methods] of Object.entries(document.paths)) {
  for (const [method, operation] of Object.entries(methods)) operations.push({ path, method, operation });
}

function pathMatches(template: string, actual: string): boolean {
  return new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(actual);
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
}
if (SERVER_INSTRUCTIONS.includes('—')) fail('server instructions: em dash');
const reference = referenceText();
if (reference.includes('—')) fail('reference: em dash');
for (const method of METHODS) {
  if (!reference.includes(`arcmira.${method.name}(`)) fail(`reference: method ${method.name} missing`);
}

/** Every method with every optional argument set, so every query key the client can send is exercised. */
type Arcmira = Record<string, (...args: unknown[]) => Promise<unknown>>;
const SAMPLE_CALLS: Record<string, (a: Arcmira) => Promise<unknown>> = {
  resolve: (a) => a.resolve('Ramp', { type: 'organization', limit: 8 }),
  search: (a) => a.search({ query: 'Ramp', channelIds: [TBPN], about: ['ent_14'], entityIds: ['ent_14'], speakerIds: ['ent_99'], kind: 'mention', after: '2026-01-01', before: '2026-09-01', source: 'creator_captions', limit: 5 }),
  mentions: (a) => a.mentions({ entityId: 'ent_14', channelId: TBPN, after: '2026-01-01', before: '2026-09-01', limit: 10, cursor: 'c' }),
  momentum: (a) => a.momentum('ent_14'),
  sponsors: (a) => a.sponsors(TBPN, { minAdReads: 3, status: 'active', limit: 10 }),
  recommendations: (a) => a.recommendations('ent_14', { kind: 'organic', channelId: TBPN, after: '2026-01-01', before: '2026-09-01', limit: 10, cursor: 'c' }),
  episodes: (a) => a.episodes(TBPN, { limit: 10, after: '2026-01-01', before: '2026-09-01' }),
  transcript: (a) => a.transcript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { quality: 'captions', language: 'en', timestamps: false, start: 0, end: 60 }),
  occurrences: (a) => a.occurrences({ channelIds: [TBPN, MTS], entityIds: ['ent_14'], videoIds: ['dQw4w9WgXcQ'], types: ['topic'], mode: 'mentions', after: '2026-01-01', before: '2026-09-01', limit: 20 }),
  status_channel: (a) => a.status({ channelId: MTS }),
  status_job: (a) => a.status({ jobId: '00000000-0000-4000-8000-000000000000' }),
  status_me: (a) => a.status({}),
};

const clientModule = (await import(new URL('../src/sandbox/client.js', import.meta.url).href)) as { createArcmira: (o: { base: string; fetch: unknown }) => { arcmira: Arcmira } };
for (const [name, call] of Object.entries(SAMPLE_CALLS)) {
  const label = `client ${name}`;
  const urls: URL[] = [];
  const recording = async (input: string) => {
    urls.push(new URL(input));
    return Response.json({ data: [], chunks: [], rows: [], sponsors: [], episodes: [], channel: {}, entity: {} });
  };
  await call(clientModule.createArcmira({ base: 'https://api.arcmira.com', fetch: recording }).arcmira);
  if (urls.length === 0) fail(`${label}: made no v1 call`);
  for (const url of urls) {
    const match = operations.find((entry) => entry.method === 'get' && pathMatches(entry.path, url.pathname));
    if (match === undefined) {
      fail(`${label}: GET ${url.pathname} matches no operation`);
      continue;
    }
    const documented = new Set((match.operation.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name));
    for (const key of url.searchParams.keys()) {
      if (documented.has(key)) continue;
      if (PENDING_PARAMS.has(key)) console.warn(`warning: ${label}: sends ${key} to ${match.operation.operationId}, which does not document it yet (pending K-API)`);
      else fail(`${label}: sends ${key} to ${match.operation.operationId}, which does not document it`);
    }
    const src = (match.operation.parameters ?? []).find((p) => p.name === 'src' && p.in === 'query');
    if (!NO_SRC.has(match.operation.operationId) && (src === undefined || !(src.schema?.enum ?? []).includes(SRC))) fail(`${label}: ${match.operation.operationId} does not accept src=${SRC}`);
  }
}

if (failures.length > 0) {
  console.error(`Manifest check against ${openapiUrl} failed:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`Manifest check against ${openapiUrl}: ${TOOLS.length} tools, ${Object.keys(SAMPLE_CALLS).length} client calls, every call matches a documented operation.`);
