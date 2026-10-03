/**
 * Runs every worked example in src/reference.ts and every task skill program in src/skills.ts against production through the sandbox client and
 * fails when a program throws, returns nothing, or reads a field the API does not send (an undefined
 * leaf in the returned value). This is how the reference is kept true to the live response shapes.
 *
 *   ARCMIRA_KEY=arc_sk_... node --experimental-strip-types scripts/check-examples.ts
 *
 * About a dozen calls, a few rows each. Pass --base to point at another API. A program marked
 * arcmira_execute_write changes the account, so it is listed and skipped, never run.
 *
 * Before a backend change is live, --spec <openapi.json> answers every call with a body built from that
 * document's 2xx response schema (every documented property set, one row per array) and needs no key:
 * a program that reads a field the document does not define still leaves an undefined leaf.
 */
import { readFileSync } from 'node:fs';
import { EXAMPLES } from '../src/reference.ts';
import { TASK_SKILLS } from '../src/skills.ts';

type Client = {
  createArcmira(o: { base: string; fetch: typeof fetch }): { arcmira: object; meter: { calls: number } };
  ArcmiraError: unknown;
};
const { createArcmira, ArcmiraError } = (await import(new URL('../src/sandbox/client.js', import.meta.url).href)) as Client;

const baseArg = process.argv.indexOf('--base');
const base = baseArg > 0 ? process.argv[baseArg + 1] : 'https://api.arcmira.com';
const specArg = process.argv.indexOf('--spec');
const spec = specArg > 0 ? process.argv[specArg + 1] : undefined;
const key = process.env.ARCMIRA_KEY;
if (!key && !spec) throw new Error('ARCMIRA_KEY missing (or pass --spec <openapi.json> to run against the document)');

type Schema = { $ref?: string; type?: string | string[]; format?: string; enum?: unknown[]; const?: unknown; properties?: Record<string, Schema>; items?: Schema; oneOf?: Schema[]; anyOf?: Schema[]; allOf?: Schema[]; additionalProperties?: unknown };
type Doc = { paths: Record<string, Record<string, { responses?: Record<string, { $ref?: string; content?: { 'application/json'?: { schema?: Schema } } }> }>>; components: { schemas: Record<string, Schema>; responses?: Record<string, { content?: { 'application/json'?: { schema?: Schema } } }> } };

/** Strings the client checks before it sends them, by the property that carries them. */
const IDS: Record<string, string> = { id: 'ent_14', entity_id: 'ent_14', channel_id: 'UC-DRzaGnL_vtBUpCFH5M0tg', youtube_channel_id: 'UC-DRzaGnL_vtBUpCFH5M0tg', video_id: 'dQw4w9WgXcQ' };

/** A body with every property the schema documents: the first enum value, one row per array, a non-null branch of every union. */
function sample(doc: Doc, schema: Schema | undefined, depth = 0, key = ''): unknown {
  while (schema?.$ref) schema = doc.components.schemas[schema.$ref.split('/').pop()!];
  if (!schema || depth > 12) return null;
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => sample(doc, s, depth, key)));
  const branches = schema.oneOf ?? schema.anyOf;
  if (branches) return sample(doc, branches.find((b) => b.type !== 'null') ?? branches[0], depth, key);
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum.find((v) => v !== null) ?? null;
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (schema.properties) return Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, sample(doc, v, depth + 1, k)]));
  if (type === 'array' || schema.items) return [sample(doc, schema.items, depth + 1, key)];
  if (type === 'object') return {};
  if (type === 'integer' || type === 'number') return 1;
  if (type === 'boolean') return key !== 'has_more';
  if (type === 'string') return IDS[key] ?? (schema.format === 'date-time' ? '2026-09-01T00:00:00Z' : schema.format === 'date' ? '2026-09-01' : `${key || 'value'} sample`);
  return null;
}

function specFetch(doc: Doc): typeof fetch {
  const routes = Object.entries(doc.paths).flatMap(([path, ops]) => Object.entries(ops).map(([method, op]) => ({ method: method.toUpperCase(), pattern: new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`), op })));
  return (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const route = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
    if (!route) return Response.json({ error: { code: 'not_documented', message: `${method} ${url.pathname} is not in the document` } }, { status: 404 });
    const [status, response] = Object.entries(route.op.responses ?? {}).filter(([code]) => code.startsWith('2')).sort(([a], [b]) => a.localeCompare(b))[0] ?? [];
    const body = response?.$ref ? doc.components.responses?.[response.$ref.split('/').pop()!] : response;
    return Response.json(sample(doc, body?.content?.['application/json']?.schema), { status: Number(status) });
  }) as typeof fetch;
}
const answer = spec ? specFetch(JSON.parse(readFileSync(spec, 'utf8')) as Doc) : undefined;
const target = spec ?? base;

function undefinedPaths(value: unknown, path = '$', out: string[] = []): string[] {
  if (value === undefined) out.push(path);
  else if (Array.isArray(value)) value.forEach((v, i) => undefinedPaths(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) undefinedPaths(v, `${path}.${k}`, out);
  return out;
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;
let failed = 0;
const PROGRAMS = [...EXAMPLES, ...TASK_SKILLS.flatMap((s) => s.programs.map((p) => ({ title: `${s.name}: ${p.title}`, code: p.code, write: p.tool === 'write' })))];
for (const [i, example] of PROGRAMS.entries()) {
  if ('write' in example && example.write) {
    console.log(`${i + 1}. ${example.title}: skipped (writes to the account)`);
    continue;
  }
  const { arcmira, meter } = createArcmira({
    base,
    fetch: answer ?? (((url: string, init?: RequestInit) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${key}` } })) as typeof fetch),
  });
  const lines: string[] = [];
  const console_ = { log: (...a: unknown[]) => lines.push(a.map(String).join(' ')), error: (...a: unknown[]) => lines.push(a.map(String).join(' ')) };
  let verdict: string;
  try {
    let value = await new AsyncFunction('arcmira', 'ArcmiraError', 'console', example.code)(arcmira, ArcmiraError, console_);
    const ask = (value as { ask?: { options?: Array<{ id: string; channel_id?: string | null }> } | null } | null)?.ask;
    if (value && typeof value === 'object' && 'ask' in value && !ask?.options?.length) throw new Error('the name resolved to nothing: no best, suggested or ask');
    const first = ask?.options?.[0];
    if (first && example.code.includes('ID = null')) {
      const pickId = first.channel_id ?? first.id;
      lines.push(`ask offered ${ask?.options?.length}; rerun with ID = ${pickId}`);
      value = await new AsyncFunction('arcmira', 'ArcmiraError', 'console', example.code.replace('ID = null', `ID = ${JSON.stringify(pickId)}`))(arcmira, ArcmiraError, console_);
    }
    const holes = undefinedPaths(value);
    const empty = value === undefined || value === null || (Array.isArray(value) && value.length === 0);
    if (holes.length > 0) verdict = `FAIL undefined at ${holes.slice(0, 6).join(', ')}`;
    else if (empty) verdict = 'FAIL returned nothing';
    else verdict = `ok ${first ? '(after ask) ' : ''}${JSON.stringify(value).slice(0, 110)}`;
  } catch (error) {
    verdict = `FAIL ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 160)}` : String(error)}`;
  }
  if (verdict.startsWith('FAIL')) failed += 1;
  console.log(`${i + 1}. ${example.title}: ${verdict} (${meter.calls} calls)`);
}
console.log(failed === 0 ? `every example runs against ${target} with no undefined field` : `${failed} example(s) failed`);
process.exit(failed === 0 ? 0 : 1);
