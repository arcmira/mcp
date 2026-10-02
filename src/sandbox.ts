import { z } from 'zod';
import clientSource from './sandbox/client-source.ts';
import { MAX_CALLS } from './reference.ts';
import { rateLimitOf } from './api.ts';

export const TIME_LIMIT_MS = 30_000;
import { LOG_CAP } from './output.ts';
import outputSource from './sandbox/output-source.ts';
export { RESULT_CAP, LOG_CAP, renderExecution } from './output.ts';
export const CPU_LIMIT_MS = 5_000;
export const SANDBOX_COMPAT_DATE = '2026-08-01';
const meterSchema = z.object({
  calls: z.number().int().nonnegative().nullable(),
  rate_limit: z.object({ limit: z.number(), remaining: z.number(), reset: z.number() }).nullable(),
  api_build: z.string().nullable(),
});
const fields = {
  ...meterSchema.shape,
  lines: z.array(z.string()),
  logs_truncated: z.boolean(),
  outcome_uncertain: z.boolean(),
  truncated: z.boolean().optional(),
  truncated_arrays: z.array(z.object({ path: z.string(), returned: z.number().int(), total: z.number().int() })).optional(),
  calls_started: z.number().int().nonnegative().optional(),
  in_flight: z.number().int().nonnegative().optional(),
  /** `METHOD /v1/path` for each API call the program started, in order. Read from the sandbox header, never the body. */
  routes: z.array(z.string()).optional(),
};
const executionSchema = z.discriminatedUnion('ok', [
  z.object({ ...fields, ok: z.literal(true), value: z.unknown() }),
  z.object({
    ...fields,
    ok: z.literal(false),
    error: z.object({ name: z.string(), code: z.string(), message: z.string() }).passthrough(),
  }),
]);
export type Execution = z.infer<typeof executionSchema>;
export type Meter = z.infer<typeof meterSchema>;

export function userModule(code: string): string {
  return `export default async (arcmira, ArcmiraError, console) => {\n${code}\n};`;
}

export function programModule(): string {
  return `import { createArcmira, ArcmiraError } from './client.js';
import { renderExecution } from './output.js';
export default {
  async fetch(request, env) {
    const NativeResponse = Response;
    const NativeRequest = Request;
    const NativeURL = URL;
    const getHeaders = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(Response.prototype, 'headers').get);
    const getHeader = Function.prototype.call.bind(Headers.prototype.get);
    const setHeader = Function.prototype.call.bind(Headers.prototype.set);
    const parse = JSON.parse.bind(JSON);
    const stringifyResult = JSON.stringify.bind(JSON);
    const toNumber = Number;
    const toString = String;
    const isFinite = Number.isFinite;
    const lines = [];
    let logChars = 0, logs_truncated = false;
    const stringify = v => typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
    const log = tag => (...args) => {
      if (logChars >= ${LOG_CAP} || lines.length >= 100) { logs_truncated = true; return; }
      const text = (tag ? tag + ' ' : '') + args.map(stringify).join(' ');
      const remaining = ${LOG_CAP} - logChars;
      lines.push(text.slice(0, remaining)); logChars += Math.min(text.length, remaining);
      if (text.length > remaining) logs_truncated = true;
    };
    const console = { log: log(''), info: log(''), warn: log('WARN'), error: log('ERR'), debug: log('') };
    const meter = { calls: 0, completed: 0, rate_limit: null, api_build: null };
    const routes = [];
    const outbound = globalThis.fetch.bind(globalThis);
    const meteredFetch = async (...args) => {
      if (meter.calls >= ${MAX_CALLS}) throw new ArcmiraError('This program reached its 40 API call limit.', 'call_budget');
      meter.calls++;
      try {
        const [input, init] = args;
        const request = input instanceof NativeRequest;
        routes.push(toString((init && init.method) || (request ? input.method : 'GET')).toUpperCase() + ' ' + new NativeURL(request ? input.url : toString(input)).pathname);
      } catch {}
      try {
      const response = await outbound(...args);
      const read = name => { const raw = getHeader(getHeaders(response), name); return raw !== null && raw !== '' && isFinite(toNumber(raw)) ? toNumber(raw) : null; };
      const limit = read('ratelimit-limit'), remaining = read('ratelimit-remaining'), reset = read('ratelimit-reset');
      if (limit !== null && remaining !== null && reset !== null) meter.rate_limit = { limit, remaining, reset };
      meter.api_build = getHeader(getHeaders(response), 'x-arcmira-build') ?? meter.api_build;
      return response;
      } finally { meter.completed++; }
    };
    // workerd exposes native fetch on the global prototype as well as the global object.
    for (let scope = globalThis; scope !== null; scope = Object.getPrototypeOf(scope)) {
      if (Object.prototype.hasOwnProperty.call(scope, 'fetch'))
        Object.defineProperty(scope, 'fetch', { value: meteredFetch, writable: true, configurable: true });
    }
    globalThis.fetch = meteredFetch;
    const { arcmira } = createArcmira({ base: env.API_BASE, maxCalls: ${MAX_CALLS}, access: env.ACCESS === 'write' ? 'write' : 'read' });
    const finish = execution => {
      execution.calls_started = meter.calls;
      execution.in_flight = meter.calls - meter.completed;
      execution.calls = execution.in_flight ? null : meter.completed;
      execution.outcome_uncertain = execution.in_flight > 0;
      const { logs, ...result } = parse(renderExecution(execution));
      const response = new NativeResponse(stringifyResult({ ...result, lines: logs }));
      const headers = getHeaders(response);
      setHeader(headers, 'content-type', 'application/json');
      setHeader(headers, 'x-execution-calls', toString(meter.calls));
      setHeader(headers, 'x-execution-completed', toString(meter.completed));
      setHeader(headers, 'x-execution-routes', stringifyResult(routes));
      if (meter.api_build !== null) setHeader(headers, 'x-arcmira-build', meter.api_build);
      if (meter.rate_limit !== null) {
        setHeader(headers, 'ratelimit-limit', toString(meter.rate_limit.limit));
        setHeader(headers, 'ratelimit-remaining', toString(meter.rate_limit.remaining));
        setHeader(headers, 'ratelimit-reset', toString(meter.rate_limit.reset));
      }
      return response;
    };
    try {
      const { default: userProgram } = await import('./user.js');
      const value = await userProgram(arcmira, ArcmiraError, console);
      return finish({ ok: true, value: value === undefined ? null : value, lines, logs_truncated, outcome_uncertain: false, ...meter });
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      const { name, message, code, status, unlock, gate, param, retry_after_seconds, retry_after, doc_url, request_id, quote } = e;
      return finish({ ok: false, error: { name, code: code ?? (name === 'SyntaxError' ? 'syntax_error' : 'program_error'), message: name === 'SyntaxError' ? message + '. Code runs as the body of an async function; import and export are not supported.' : message, status, unlock, gate, param, retry_after_seconds, retry_after, doc_url, request_id, quote }, lines, logs_truncated, outcome_uncertain: false, ...meter });
    }
  },
};`;
}

/** Which execute tool a program runs under. The outbound enforces the routes; the client only fails faster. */
export type Access = 'read' | 'write';

/** True when `path` is `root` or under it. */
const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

/**
 * The routes a sandbox program may call, by tool. Read: any GET under /v1, and POST
 * /v1/transcriptions (Premium preparation is a read, ruling 2026-10-02). Write adds POST and PATCH
 * under /v1/monitors and /v1/trackers, never DELETE, and never the webhook secret rotation, which
 * breaks the user's existing webhook verification.
 */
export function outboundAllowed(access: Access, method: string, path: string): boolean {
  if (/%2f|%5c/i.test(path) || !under(path, '/v1')) return false;
  if (method === 'GET') return true;
  if (method === 'POST' && path === '/v1/transcriptions') return true;
  if (access !== 'write' || (method !== 'POST' && method !== 'PATCH')) return false;
  if (path.includes('/webhook-secret')) return false;
  return under(path, '/v1/monitors') || under(path, '/v1/trackers');
}

export interface SandboxHost {
  loader: WorkerLoader;
  /** Refuses every request outside this host's access allowlist (ApiOutbound in src/index.ts). */
  outbound: Fetcher;
  apiBase: string;
  access: Access;
}

/** An in-isolate render is at most RESULT_CAP characters, and UTF-8 spends at most three bytes on each. */
export const RESPONSE_BYTE_CAP = 65_536;

/** The response text, or null when it is over RESPONSE_BYTE_CAP; never buffers more than the cap plus one chunk. */
async function readCapped(response: Response): Promise<string | null> {
  if (Number(response.headers.get('content-length')) > RESPONSE_BYTE_CAP) {
    await response.body?.cancel();
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  for (;;) {
    const next = await reader?.read();
    if (next === undefined || next.done) break;
    size += next.value.byteLength;
    if (size > RESPONSE_BYTE_CAP) {
      await reader?.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The sandbox's route log, or an empty list when the header is missing or malformed. Telemetry only. */
function routesOf(header: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(header ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((route): route is string => typeof route === 'string').slice(0, MAX_CALLS) : [];
  } catch {
    return [];
  }
}

function unknownOutcome(name: string, code: string, message: string): Execution {
  return {
    ok: false,
    error: { name, code, message },
    lines: [],
    logs_truncated: false,
    outcome_uncertain: true,
    calls: null,
    rate_limit: null,
    api_build: null,
  };
}

export async function runProgram(host: SandboxHost, code: string): Promise<Execution> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const worker = host.loader.load({
      compatibilityDate: SANDBOX_COMPAT_DATE,
      mainModule: 'program.js',
      modules: {
        'program.js': programModule(),
        'user.js': userModule(code),
        'client.js': clientSource,
        'output.js': outputSource,
      },
      env: { API_BASE: host.apiBase, MAX_CALLS, ACCESS: host.access },
      globalOutbound: host.outbound,
      limits: { cpuMs: CPU_LIMIT_MS, subRequests: MAX_CALLS },
    });
    const timeout = new Promise<Execution>((resolve) => {
      timer = setTimeout(
        () =>
          resolve(
            unknownOutcome(
              'TimeoutError',
              'timeout',
              'The program exceeded 30 seconds. Its call count and final outcome are unknown. Requests may still finish and consume rows; a preparation or monitor change it started may have gone through. Retry with a smaller program, or check arcmira.status({ jobId }) or arcmira.monitors.list() before repeating a change.',
            ),
          ),
        TIME_LIMIT_MS,
      );
    });
    const run = (async (): Promise<Execution> => {
      const response = await worker.getEntrypoint().fetch('https://sandbox.invalid/run');
      const rawCalls = response.headers.get('x-execution-calls');
      if (rawCalls === null || !/^\d+$/.test(rawCalls) || Number(rawCalls) > MAX_CALLS)
        throw new Error('Sandbox response lacks authoritative call accounting');
      const rawCompleted = response.headers.get('x-execution-completed');
      if (rawCompleted === null || !/^\d+$/.test(rawCompleted) || Number(rawCompleted) > Number(rawCalls))
        throw new Error('Sandbox response lacks completed call accounting');
      const inFlight = Number(rawCalls) - Number(rawCompleted);
      const accounting = {
        calls: inFlight ? null : Number(rawCompleted),
        calls_started: Number(rawCalls),
        in_flight: inFlight,
        rate_limit: rateLimitOf(response.headers),
        api_build: response.headers.get('x-arcmira-build'),
        routes: routesOf(response.headers.get('x-execution-routes')),
      };
      const body = await readCapped(response);
      if (body === null)
        return {
          ok: false,
          error: {
            name: 'SandboxError',
            code: 'sandbox_error',
            message: `The program's result exceeded ${RESPONSE_BYTE_CAP} bytes at the sandbox boundary and was discarded. Return fewer or shorter fields.`,
          },
          lines: [],
          logs_truncated: false,
          outcome_uncertain: inFlight > 0,
          ...accounting,
        };
      const execution = executionSchema.parse(JSON.parse(body));
      return { ...execution, ...accounting, outcome_uncertain: execution.outcome_uncertain || inFlight > 0 };
    })();
    return await Promise.race([run, timeout]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const syntax = /SyntaxError/.test(message) || (error instanceof Error && error.name === 'SyntaxError');
    return unknownOutcome(
      syntax ? 'SyntaxError' : 'SandboxError',
      syntax ? 'syntax_error' : 'sandbox_error',
      syntax
        ? `${message}. Code runs as the body of an async function; import and export are not supported.`
        : `${message}. The final call count is unknown. Read requests may still finish; inspect status before retrying.`,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
