/**
 * Static manifest check. Every call the sandbox client can make is replayed with a recording
 * fetch and matched to the live OpenAPI document, so a v1 rename breaks here before it breaks
 * in a host. Also lints the tool definitions, the reference text, and server.json.
 *
 *   node --experimental-strip-types scripts/check-manifest.ts [openapi-url]
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { SRC } from '../src/api.ts';
import { METHODS, referenceText } from '../src/reference.ts';
import { FEEDBACK_CATEGORIES, READ_ONLY, SERVER_INSTRUCTIONS, TOOLS, feedbackBody } from '../src/tools.ts';
import server from '../server.json' with { type: 'json' };

const openapiUrl = process.argv[2] ?? 'https://api.arcmira.com/v1/openapi.json';
/** Query params /v1 added for code mode on 2026-09-30; a warning, not a failure, while the OpenAPI document catches up. */
const PENDING_PARAMS = new Set(['about', 'by', 'kind']);
/**
 * Operations that do not document src: they are not entry points that mint unlock links. The
 * outbound still appends src=mcp-tool to every sandbox request, and v1 ignores a query key a route
 * does not read (0.8 sent it on POST /v1/transcriptions).
 */
const NO_SRC = new Set([
  'get_me',
  'quote_transcription',
  'submit_transcription',
  'list_monitors',
  'list_monitor_trackers',
  'create_monitor',
  'update_monitor',
  'add_monitor_trackers',
  'add_monitor_entities',
  'list_slack_integrations',
]);
const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';
const MTS = 'UClWkDGXEzsh77GAhs90wpXw';

const failures: string[] = [];
function fail(message: string): void {
  if (!failures.includes(message)) failures.push(message);
}

/** The registry rejects longer descriptions with a 422 at publish time; catch it here first. */
if (server.description.length > 100) fail(`server.json description is ${server.description.length} characters; the registry allows 100.`);

interface Schema {
  $ref?: string;
  properties?: Record<string, Schema & { enum?: string[] }>;
  additionalProperties?: unknown;
}
interface Operation {
  operationId: string;
  parameters?: Array<{
    name: string;
    in: string;
    schema?: { enum?: string[] };
  }>;
  requestBody?: { content?: { 'application/json'?: { schema?: Schema } } };
}
interface Document {
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, Schema> };
}

const document = (
  openapiUrl.startsWith('file:')
    ? JSON.parse(await readFile(new URL(openapiUrl), 'utf8'))
    : await (await fetch(openapiUrl, { headers: { accept: 'application/json' } })).json()
) as Document;
const operations: Array<{
  path: string;
  method: string;
  operation: Operation;
}> = [];
for (const [path, methods] of Object.entries(document.paths)) {
  for (const [method, operation] of Object.entries(methods)) operations.push({ path, method, operation });
}

for (const [path, method] of [
  ['/v1/transcripts/{video_id}/quote', 'get'],
  ['/v1/transcriptions', 'post'],
  ['/v1/monitors', 'get'],
  ['/v1/monitors', 'post'],
  ['/v1/monitors/{id}', 'patch'],
  ['/v1/monitors/{id}/trackers', 'get'],
  ['/v1/monitors/{id}/entities', 'post'],
  ['/v1/monitors/{id}/trackers', 'post'],
  ['/v1/integrations/slack', 'get'],
  ['/v1/feedback', 'post'],
]) {
  if (!document.paths[path]?.[method]) fail(`Operation the client or arcmira_feedback calls is absent: ${method.toUpperCase()} ${path}`);
}

function resolveSchema(schema: Schema | undefined): Schema | undefined {
  if (!schema?.$ref) return schema;
  return resolveSchema(document.components?.schemas?.[schema.$ref.replace('#/components/schemas/', '')]);
}

/** Every body key must be a documented property, and every enum value it sends must be listed. */
function checkBody(label: string, operation: Operation, body: Record<string, unknown>): void {
  const schema = resolveSchema(operation.requestBody?.content?.['application/json']?.schema);
  if (!schema?.properties) {
    fail(`${label}: ${operation.operationId} documents no JSON body`);
    return;
  }
  for (const [key, value] of Object.entries(body)) {
    const property = resolveSchema(schema.properties[key]) as (Schema & { enum?: string[] }) | undefined;
    if (property === undefined) fail(`${label}: sends body field ${key} to ${operation.operationId}, which does not document it`);
    else if (property.enum && typeof value === 'string' && !property.enum.includes(value)) fail(`${label}: sends ${key} ${value} to ${operation.operationId}, whose enum is ${property.enum.join(', ')}`);
  }
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
  const schema = z.toJSONSchema(tool.inputSchema) as {
    properties?: Record<string, { description?: string }>;
  };
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (!property.description) fail(`${label}: input ${name} has no description`);
  }
  for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
    if ((tool.annotations ?? READ_ONLY)[hint] === undefined) fail(`${label}: annotation ${hint} missing`);
  }
  const hints = tool.annotations ?? READ_ONLY;
  if (hints.readOnlyHint !== (tool.name !== 'arcmira_execute_write')) fail(`${label}: readOnlyHint must be ${tool.name !== 'arcmira_execute_write'} (owner ruling 2026-10-02)`);
  if (hints.destructiveHint !== false) fail(`${label}: destructiveHint must be false; 0.9 deletes nothing`);
  if (!tool.name.startsWith('arcmira_')) fail(`${label}: tool names carry the arcmira_ prefix`);
}
if (/approved a cents amount|state the amount and ask/i.test(SERVER_INSTRUCTIONS + referenceText())) fail('instructions or reference ask the user for a cents amount');
if (SERVER_INSTRUCTIONS.includes('—')) fail('server instructions: em dash');
const reference = referenceText();
if (reference.includes('—')) fail('reference: em dash');
for (const method of METHODS) {
  if (!reference.includes(`arcmira.${method.name}(`)) fail(`reference: method ${method.name} missing`);
}

/** Every method with every optional argument set, so every query key the client can send is exercised. */
type Arcmira = Record<string, (...args: unknown[]) => Promise<unknown>>;
const SAMPLE_CALLS: Record<string, (a: Arcmira) => Promise<unknown>> = {
  resolve: (a) =>
    a.resolve('Ramp', {
      type: 'organization',
      context: 'the corporate card',
      limit: 8,
    }),
  search: (a) =>
    a.search({
      query: 'Ramp',
      channelIds: [TBPN],
      about: ['ent_14'],
      entityIds: ['ent_14'],
      speakerIds: ['ent_99'],
      kind: 'mention',
      after: '2026-01-01',
      before: '2026-09-01',
      source: 'creator_captions',
      limit: 5,
    }),
  mentions: (a) =>
    a.mentions({
      entityId: 'ent_14',
      channelId: TBPN,
      after: '2026-01-01',
      before: '2026-09-01',
      limit: 10,
      cursor: 'c',
    }),
  momentum: (a) => a.momentum('ent_14'),
  sponsors: (a) => a.sponsors(TBPN, { minAdReads: 3, status: 'active', limit: 10 }),
  recommendations: (a) =>
    a.recommendations('ent_14', {
      kind: 'organic',
      channelId: TBPN,
      after: '2026-01-01',
      before: '2026-09-01',
      limit: 10,
      cursor: 'c',
    }),
  episodes: (a) => a.episodes(TBPN, { limit: 10, after: '2026-01-01', before: '2026-09-01' }),
  transcript: (a) =>
    a.transcript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      quality: 'captions',
      language: 'en',
      timestamps: false,
      start: 0,
      end: 60,
    }),
  occurrences: (a) =>
    a.occurrences({
      channelIds: [TBPN, MTS],
      entityIds: ['ent_14'],
      videoIds: ['dQw4w9WgXcQ'],
      types: ['topic'],
      mode: 'mentions',
      after: '2026-01-01',
      before: '2026-09-01',
      limit: 20,
    }),
  status_channel: (a) => a.status({ channelId: MTS }),
  status_job: (a) => a.status({ jobId: '00000000-0000-4000-8000-000000000000' }),
  status_me: (a) => a.status({}),
  quote: (a) => a.quote('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
  prepare: (a) => a.prepare('dQw4w9WgXcQ'),
  wait: (a) => a.wait('00000000-0000-4000-8000-000000000000', { timeoutSeconds: 0 }),
  monitors_list: (a) => (a.monitors as unknown as Arcmira).list(),
  monitors_trackers: (a) => (a.monitors as unknown as Arcmira).trackers('mon_1'),
  monitors_create: (a) =>
    (a.monitors as unknown as Arcmira).create({
      name: 'Competitors',
      notifyFrequency: 'daily',
      notifyEmails: ['a@example.com'],
      notifySlack: true,
      slackIntegrationId: 'si_1',
      slackChannelId: 'C1',
      notifyWebhook: false,
      webhookUrl: 'https://example.com/hook',
      digestDay: 'monday',
      digestTime: '09:00',
    }),
  monitors_update: (a) => (a.monitors as unknown as Arcmira).update('mon_1', { isPaused: true, notifyFrequency: 'hourly', isCollapsed: false, sortOrder: 1 }),
  monitors_attachTrackers: (a) => (a.monitors as unknown as Arcmira).attachTrackers('mon_1', ['trk_1']),
  integrations_slack: (a) => (a.integrations as unknown as Arcmira).slack(),
  monitors_addEntities: (a) => (a.monitors as unknown as Arcmira).addEntities('mon_1', ['ent_14', 'ent_99'], { personMatchMode: 'both' }),
};

const clientModule = (await import(new URL('../src/sandbox/client.js', import.meta.url).href)) as { createArcmira: (o: { base: string; fetch: unknown; access: 'write' }) => { arcmira: Arcmira } };
for (const [name, call] of Object.entries(SAMPLE_CALLS)) {
  const label = `client ${name}`;
  const urls: Array<{ url: URL; method: string; body: Record<string, unknown> | null }> = [];
  const recording = async (input: string, init?: RequestInit) => {
    urls.push({ url: new URL(input), method: (init?.method ?? 'GET').toLowerCase(), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    return Response.json({
      quote: { rows: 300 },
      charge: { from: 'mixed' },
      max_on_demand_cents: 12,
      job: { id: 'j' },
      monitors: [],
      trackers: [],
      integrations: [],
      monitor: { id: 'mon_1' },
      data: [],
      chunks: [],
      rows: [],
      sponsors: [],
      episodes: [],
      channel: {},
      entity: {},
    });
  };
  await call(
    clientModule.createArcmira({
      base: 'https://api.arcmira.com',
      fetch: recording,
      access: 'write',
    }).arcmira,
  );
  if (urls.length === 0) fail(`${label}: made no v1 call`);
  for (const { url, method, body } of urls) {
    const match = operations.find((entry) => entry.method === method && pathMatches(entry.path, url.pathname));
    if (match === undefined) {
      fail(`${label}: ${method.toUpperCase()} ${url.pathname} matches no operation`);
      continue;
    }
    if (body !== null) checkBody(label, match.operation, body);
    const documented = new Set((match.operation.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name));
    for (const key of url.searchParams.keys()) {
      if (documented.has(key)) continue;
      if (PENDING_PARAMS.has(key))
        console.warn(
          `warning: ${label}: sends ${key} to ${match.operation.operationId}, which does not document it yet (pending K-API)`,
        );
      else fail(`${label}: sends ${key} to ${match.operation.operationId}, which does not document it`);
    }
    const src = (match.operation.parameters ?? []).find((p) => p.name === 'src' && p.in === 'query');
    if (!NO_SRC.has(match.operation.operationId) && (src === undefined || !(src.schema?.enum ?? []).includes(SRC)))
      fail(`${label}: ${match.operation.operationId} does not accept src=${SRC}`);
  }
}

const feedbackOperation = document.paths['/v1/feedback']?.post;
if (feedbackOperation)
  for (const category of FEEDBACK_CATEGORIES)
    checkBody('arcmira_feedback', feedbackOperation, feedbackBody({ category, note: 'n', request_id: 'req_1', call_id: `mcpc_${'0'.repeat(32)}` }));

if (failures.length > 0) {
  console.error(`Manifest check against ${openapiUrl} failed:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`Manifest check against ${openapiUrl}: ${TOOLS.length} tools, ${Object.keys(SAMPLE_CALLS).length} client calls, every call matches a documented operation.`);
