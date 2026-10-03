import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { OPERATION_DEFINITIONS, EFFECTS } from '../src/operations/definitions.ts';

const object = z.record(z.string(), z.unknown());
const parameter = z.object({ name: z.string(), in: z.enum(['query', 'path', 'header']), required: z.boolean().optional(), schema: object });
const operation = z.object({
  operationId: z.string(),
  parameters: z.array(parameter).default([]),
  requestBody: z.object({ required: z.boolean().optional(), content: z.object({ 'application/json': z.object({ schema: object }) }) }).optional(),
});
const documentSchema = z.object({ paths: z.record(z.string(), object) }).passthrough();
const source = process.argv.find((arg) => arg.startsWith('--source='))?.slice('--source='.length) ?? 'https://api.arcmira.com/v1/openapi.json';
const raw: unknown = source.startsWith('https:')
  ? await (await fetch(source)).json()
  : JSON.parse(await readFile(source, 'utf8'));
const document = documentSchema.parse(raw);

function resolve(value: unknown, seen: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item) => resolve(item, seen));
  if (value === null || typeof value !== 'object') return value;
  const record = object.parse(value);
  if (typeof record.$ref === 'string') {
    const ref = record.$ref;
    if (!ref.startsWith('#/') || seen.includes(ref)) throw new Error(`Unsupported schema reference: ${ref}`);
    let target: unknown = document;
    for (const key of ref.slice(2).split('/')) target = object.parse(target)[key.replaceAll('~1', '/').replaceAll('~0', '~')];
    if (target === undefined) throw new Error(`Missing schema reference: ${ref}`);
    const { $ref: _ref, ...siblings } = record;
    return resolve({ ...object.parse(target), ...siblings }, [...seen, ref]);
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, resolve(item, seen)]));
}

const catalog = OPERATION_DEFINITIONS.map(([id, title, description, effect]) => {
  const matches = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.entries(methods).flatMap(([method, value]) => {
      if (!['get', 'post', 'patch'].includes(method)) return [];
      const parsed = operation.safeParse(value);
      return parsed.success && parsed.data.operationId === id ? [{ path, method, operation: parsed.data }] : [];
    }),
  );
  if (matches.length !== 1) throw new Error(`${id}: expected one operation, found ${matches.length}`);
  const [{ path, method, operation: spec }] = matches;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const parameters = spec.parameters.filter((p) => p.in !== 'header' && p.name !== 'src');
  for (const parameter of parameters) {
    properties[parameter.name] = resolve(parameter.schema);
    if (parameter.required) required.push(parameter.name);
  }
  if (spec.requestBody) {
    properties.body = resolve(spec.requestBody.content['application/json'].schema);
    required.push('body');
  }
  if (method !== 'get') {
    properties.idempotency_key = { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9_.:-]+$', description: 'Reuse the same key only when retrying the same write with the same body.' };
    required.push('idempotency_key');
  }
  const inputSchema = { type: 'object', properties, required, additionalProperties: false };
  // Fail generation when the runtime validator cannot support this contract.
  z.fromJSONSchema(object.parse(inputSchema));
  return { id, name: `arcmira_${id}`, title, description, method: method.toUpperCase(), path, parameters: parameters.map(({ name, in: location }) => ({ name, location })), annotations: EFFECTS[effect], inputSchema };
});
const output = `${JSON.stringify(catalog, null, 2)}\n`;
const destination = new URL('../src/operations/catalog.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(destination, 'utf8') !== output) throw new Error('Operation catalog differs from the OpenAPI contract. Run pnpm operations:build and review the diff.');
} else await writeFile(destination, output);
console.log(`${catalog.length} explicit operation contracts ${process.argv.includes('--check') ? 'checked' : 'generated'}.`);
