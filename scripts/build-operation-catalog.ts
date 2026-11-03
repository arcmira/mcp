import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { OPERATION_DEFINITIONS, EFFECTS } from '../src/operations/definitions.ts';
import type { ResponseFields } from '../src/operations/responses.ts';

const object = z.record(z.string(), z.unknown());
const parameter = z.object({ name: z.string(), in: z.enum(['query', 'path', 'header']), required: z.boolean().optional(), schema: object });
const operation = z.object({
  operationId: z.string(),
  parameters: z.array(parameter).default([]),
  requestBody: z.object({ required: z.boolean().optional(), content: z.object({ 'application/json': z.object({ schema: object }) }) }).optional(),
  responses: z.record(z.string(), z.object({ content: z.object({ 'application/json': z.object({ schema: object }) }).optional() })),
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

const omitted = new Set(['user_id', 'key_id', 'key_label', 'credential_kind', 'email_masked',
  'request_id', 'image_checked_at', 'search_index', 'failed_batches', 'webhook_secret',
  'webhook_secret_hint', 'unlock', 'upgrade']);

function responseFields(schemas: unknown[], path: string[] = []): ResponseFields {
  function flatten(schema: unknown): Record<string, unknown>[] {
    const value = object.parse(schema);
    return [value, ...['allOf', 'oneOf', 'anyOf'].flatMap((key) => (z.array(object).optional().parse(value[key]) ?? []).flatMap(flatten))];
  }
  const expanded = schemas.flatMap(flatten);
  const properties = expanded.flatMap((schema) => Object.entries(object.optional().parse(schema.properties) ?? {}));
  if (properties.length) {
    const children: Record<string, unknown[]> = {};
    for (const [key, schema] of properties) {
      if (omitted.has(key) || (path[0] === 'submit_feedback' && path.length === 1 && key === 'query')
        || (['job', 'premium_job', 'last_attempt'].includes(path.at(-1) ?? '') && ['id', 'created_at', 'completed_at'].includes(key))) continue;
      (children[key] ??= []).push(schema);
    }
    return {
      kind: properties.some(([key]) => key === 'code') && properties.some(([key]) => key === 'message') ? 'error' : 'object',
      properties: Object.fromEntries(Object.entries(children).map(([key, values]) => [key, responseFields(values, [...path, key])])),
    };
  }
  const items = expanded.flatMap((schema) => schema.items === undefined ? [] : [schema.items]);
  if (items.length) return { kind: 'array', items: responseFields(items, [...path, '[]']) };
  if (expanded.some((schema) => schema.type === 'object' || schema.additionalProperties)) throw new Error(`Unreviewed open-ended response object: ${path.join('.')}`);
  return { kind: 'scalar' };
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
  const parameters = spec.parameters.filter((p) => p.in !== 'header' && p.name !== 'src'
    && !(id === 'get_transcript' && p.name === 'spending'));
  for (const parameter of parameters) {
    properties[parameter.name] = resolve(parameter.schema);
    if (parameter.required) required.push(parameter.name);
  }
  if (id === 'get_transcript') {
    required.push('quality');
    const descriptions = {
      quality: 'Select the source the user requested. Premium reads owned transcripts or starts whole-video transcription using existing credits only; no new on-demand charge is allowed. Captions and Premium are distinct. Insufficient credits return an error without changing the source.',
      retry: 'Premium only. Set true only for an explicit retry of a failed transcription; it can spend existing credits again. A pending job needs another read, not a retry.',
      start: 'Window start in seconds. Send start and end together. Captions bill only their returned window; Premium transcribes the whole video using existing credits even when a smaller window is returned.',
    };
    for (const [name, description] of Object.entries(descriptions)) {
      properties[name] = { ...object.parse(properties[name]), description };
    }
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
  const responses = Object.entries(spec.responses).flatMap(([status, response]) =>
    /^2\d\d$/.test(status) && response.content ? [resolve(response.content['application/json'].schema)] : []);
  if (!responses.length) throw new Error(`${id}: no successful JSON response contract`);
  const outputFields = responseFields(responses, [id]);
  return { id, name: `arcmira_${id}`, title, description, method: method.toUpperCase(), path, parameters: parameters.map(({ name, in: location }) => ({ name, location })), annotations: EFFECTS[effect], inputSchema, outputFields };
});
for (const [filename, value] of [
  ['catalog.json', catalog],
  ['error-fields.json', responseFields([resolve({ $ref: '#/components/schemas/Error' })])],
] as const) {
  const output = `${JSON.stringify(value, null, 2)}\n`;
  const destination = new URL(`../src/operations/${filename}`, import.meta.url);
  if (process.argv.includes('--check')) {
    if (await readFile(destination, 'utf8') !== output) throw new Error('Operation catalog differs from the OpenAPI contract. Run pnpm operations:build and review the diff.');
  } else await writeFile(destination, output);
}
console.log(`${catalog.length} explicit operation contracts ${process.argv.includes('--check') ? 'checked' : 'generated'}.`);
