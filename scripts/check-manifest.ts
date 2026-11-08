/**
 * Static manifest check. Every call the sandbox client can make is replayed with a recording
 * fetch and matched to the live OpenAPI document, so a v1 rename breaks here before it breaks
 * in a host. Also lints the tool definitions, the reference text, and server.json.
 *
 *   node --experimental-strip-types scripts/check-manifest.ts [openapi-url-or-file]
 *
 * A file path (or file: URL) checks a document before it is live, such as the spec of an
 * unreleased backend change: pnpm manifest:check <path to the OpenAPI document>
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { SRC, createApiClient } from '../src/api.ts';
import { MAX_INSTRUCTIONS, METHODS, SCRIPTED_SPEND, referenceText } from '../src/reference.ts';
import { FEEDBACK_CATEGORIES, SERVER_INSTRUCTIONS, TOOLS, TOOL_NAMES, feedbackBody, type ToolName } from '../src/tools.ts';
import { youtubeSearchTool, youtubeTranscriptTool } from '../src/read-tools.ts';
import server from '../server.json' with { type: 'json' };

const arg = process.argv[2] ?? 'https://api.arcmira.com/v1/openapi.json';
const openapiUrl = /^(https?|file):/.test(arg) ? arg : pathToFileURL(arg).href;
/**
 * Operations that do not document src: they are not entry points that mint unlock links. The
 * outbound still appends src=mcp-tool to every sandbox request, and v1 ignores a query key a route
 * does not read.
 */
const NO_SRC = new Set([
  'get_me',
  'quote_transcription',
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
  ['/v1/transcripts/{video_id}', 'get'],
  ['/v1/transcripts/{video_id}/quote', 'get'],
  ['/v1/search', 'get'],
  ['/v1/recommendations', 'get'],
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

/** Each tool's effect hints, readOnly, destructive, idempotent and openWorld, and why. */
const HINTS: Record<ToolName, { hints: readonly [boolean, boolean, boolean, boolean]; why: string }> = {
  arcmira_describe: { hints: [true, false, true, false], why: 'reference lookup reads no indexed content and starts nothing' },
  arcmira_execute_read: { hints: [false, false, false, true], why: 'a Premium read can start a transcription that uses credits; it only adds' },
  arcmira_execute_write: { hints: [false, true, false, true], why: 'it changes existing monitors' },
  arcmira_youtube_search: { hints: [true, false, true, true], why: 'one search read over public videos' },
  arcmira_youtube_transcript: { hints: [true, false, true, true], why: 'it reads captions or a transcript the account owns and never starts a transcription' },
  arcmira_feedback: { hints: [false, false, false, false], why: 'each call stores a new feedback record' },
};

/** OpenAI's directory reads the plain tools' text: no pricing, plan or trial words, and no line about another tool. */
const DIRECTORY_WORDS = /\b(plans?|pric(e|es|ing)|trials?|subscri\w*|upgrade\w*|paid|credits?|free|costs?)\b/i;

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
    if (typeof tool.annotations[hint] !== 'boolean') fail(`${label}: annotation ${hint} must be a boolean`);
  }
  const { readOnlyHint, destructiveHint, idempotentHint, openWorldHint } = tool.annotations;
  const expected = HINTS[tool.name];
  if ([readOnlyHint, destructiveHint, idempotentHint, openWorldHint].join() !== expected.hints.join())
    fail(`${label}: readOnly, destructive, idempotent and openWorld hints must be ${expected.hints.join(', ')}: ${expected.why}`);
  if (!tool.name.startsWith('arcmira_')) fail(`${label}: tool names carry the arcmira_ prefix`);
}
for (const tool of [youtubeSearchTool, youtubeTranscriptTool]) {
  const inputs = Object.entries((z.toJSONSchema(tool.inputSchema) as { properties?: Record<string, { description?: string }> }).properties ?? {});
  for (const [where, text] of [['title', tool.title], ['description', tool.description], ...inputs.map(([name, p]) => [`input ${name}`, p.description ?? ''])]) {
    const word = DIRECTORY_WORDS.exec(text)?.[0];
    if (word) fail(`tool ${tool.name} ${where}: "${word}" is a pricing, plan or trial word, which OpenAI's directory does not allow`);
    for (const other of TOOL_NAMES) if (other !== tool.name && text.includes(other)) fail(`tool ${tool.name} ${where}: names ${other}; a plain tool says what it does, not what another tool does`);
  }
}
for (const [where, text] of [['server instructions', SERVER_INSTRUCTIONS], ['reference', referenceText()], ...TOOLS.map((t) => [t.name, t.description])]) {
  if (SCRIPTED_SPEND.test(text)) fail(`${where}: scripts what to ask or say about spend (${text.match(SCRIPTED_SPEND)![0]})`);
}
if (SERVER_INSTRUCTIONS.includes('—')) fail('server instructions: em dash');
if (SERVER_INSTRUCTIONS.length > MAX_INSTRUCTIONS) fail(`server instructions: ${SERVER_INSTRUCTIONS.length} characters, limit ${MAX_INSTRUCTIONS} (Claude Code cuts at 4,096, and at 2,048 before v2.1.296)`);
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
      kind: ['sponsored', 'mention'],
      after: '2026-01-01',
      before: '2026-09-01',
      source: 'creator_captions',
      limit: 5,
    }),
  mentions: (a) =>
    a.mentions({
      entityId: 'ent_14',
      channelId: TBPN,
      mode: 'appearances',
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
  status_me: (a) => a.status({}),
  quote: (a) => a.quote('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
  transcript_premium: (a) => a.transcript('dQw4w9WgXcQ', { quality: 'premium', retry: true }),
  monitors_list: (a) => (a.monitors as unknown as Arcmira).list(),
  monitors_trackers: (a) => (a.monitors as unknown as Arcmira).trackers('mon_1'),
  monitors_create: (a) =>
    (a.monitors as unknown as Arcmira).create({
      name: 'Competitors',
      notify_frequency: 'daily',
      notify_emails: ['a@example.com'],
      notify_slack: true,
      slack_integration_id: 'si_1',
      slack_channel_id: 'C1',
      notify_webhook: false,
      webhook_url: 'https://example.com/hook',
      digest_day: 'monday',
      digest_time: '09:00',
    }),
  monitors_update: (a) => (a.monitors as unknown as Arcmira).update('mon_1', { paused: true, notify_frequency: 'hourly' }),
  monitors_addName: (a) =>
    (a.monitors as unknown as Arcmira).addName('mon_1', [
      { name: 'Acme Robotics', type: 'org' },
      { name: 'Jensen Huang', type: 'person', personMatchMode: 'both' },
      { name: TBPN, type: 'channel' },
    ]),
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
      state: 'ready',
      monitors: [],
      tracker: { id: 'trk_1' },
      trackers: [],
      integrations: [],
      monitor: { id: 'mon_1' },
      mentions: [],
      recommendations: [],
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
  checkRequests(label, urls);
}

/** The plain tools call v1 through the server's own ApiClient; replay each with every input set, through a recording fetch. */
const PLAIN_CALLS = [
  { tool: youtubeSearchTool, input: { query: 'Ramp', channel: [TBPN], about: ['ent_14'], by: ['ent_99'], kind: ['sponsored', 'mention'], after: '2026-01-01', before: '2026-09-01', source: 'creator_captions', limit: 5 } },
  { tool: youtubeTranscriptTool, input: { video: 'https://youtu.be/dQw4w9WgXcQ', start: 60, language: 'de,en' } },
] as const;
const realFetch = globalThis.fetch;
for (const { tool, input } of PLAIN_CALLS) {
  const urls: Array<{ url: URL; method: string; body: Record<string, unknown> | null }> = [];
  globalThis.fetch = (async (target: string | URL | Request, init?: RequestInit) => {
    urls.push({ url: new URL(String(target)), method: (init?.method ?? 'GET').toLowerCase(), body: null });
    return Response.json({ chunks: [], state: 'ready', video: { id: 'dQw4w9WgXcQ' }, lines: [] });
  }) as typeof fetch;
  try {
    const parsed = (tool.inputSchema as z.ZodType).parse(input) as never;
    await tool.run(parsed, { api: createApiClient({}, 'arc_sk_manifest_check'), call: { id: 'mcpc_check', tool: tool.name }, sandbox: null });
  } finally {
    globalThis.fetch = realFetch;
  }
  checkRequests(`tool ${tool.name}`, urls);
}

function checkRequests(label: string, urls: Array<{ url: URL; method: string; body: Record<string, unknown> | null }>): void {
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
      if (!documented.has(key)) fail(`${label}: sends ${key} to ${match.operation.operationId}, which does not document it`);
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
console.log(`Manifest check against ${openapiUrl}: ${TOOLS.length} tools, ${Object.keys(SAMPLE_CALLS).length} client calls and ${PLAIN_CALLS.length} plain tool calls, every call matches a documented operation.`);
