import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import pkg from '../../package.json' with { type: 'json' };
import catalog from './catalog.json' with { type: 'json' };
import { noKeyError, type ApiClient, type Query } from '../api.ts';
import { errorResult, okResult } from '../result.ts';

const record = z.record(z.string(), z.unknown());
const queryValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);
const method = z.enum(['GET', 'POST', 'PATCH']);

/**
 * Review candidate, deliberately not wired to the public Worker yet. Authentication routing,
 * entitlement enforcement, result minimization and telemetry controls must pass before release.
 */
export function createOperationServer(api: ApiClient | null): McpServer {
  const server = new McpServer({ name: 'arcmira', version: pkg.version }, {
    instructions: 'Research indexed YouTube videos and livestreams with timestamped sources. Use resolved IDs for filters. Report coverage limitations and verify source context. Premium transcripts and captions are distinct: never substitute captions when Premium was requested. API documentation: https://arcmira.com/docs',
  });
  for (const operation of catalog) {
    const inputSchema = z.fromJSONSchema(record.parse(operation.inputSchema));
    if (!(inputSchema instanceof z.ZodObject)) throw new Error(`${operation.name}: expected an object schema`);
    const verb = method.parse(operation.method);
    server.registerTool(operation.name, {
      title: operation.title,
      description: operation.description,
      inputSchema,
      annotations: operation.annotations,
    }, async (input) => {
      if (api === null) return errorResult(noKeyError());
      let path = operation.path;
      const query: Query = {};
      for (const parameter of operation.parameters) {
        const value = input[parameter.name];
        if (parameter.location === 'path') {
          path = path.replace(`{${parameter.name}}`, encodeURIComponent(z.string().min(1).parse(value)));
        } else if (value !== undefined) query[parameter.name] = queryValue.parse(value);
      }
      const answer = verb === 'GET'
        ? await api.get(path, query)
        : await api[verb === 'POST' ? 'post' : 'patch'](path, record.parse(input.body), { idempotencyKey: z.string().parse(input.idempotency_key), query });
      return answer.ok ? okResult(answer.body) : errorResult(answer.error, answer.body);
    });
  }
  return server;
}
