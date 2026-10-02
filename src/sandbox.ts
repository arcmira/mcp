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
  calls_started: z.number().int().nonnegative().optional(),
  in_flight: z.number().int().nonnegative().optional(),
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
    const outbound = globalThis.fetch.bind(globalThis);
    const meteredFetch = async (...args) => {
      if (meter.calls >= ${MAX_CALLS}) throw new ArcmiraError('This program reached its 40 API call limit.', 'call_budget');
      meter.calls++;
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
    const { arcmira } = createArcmira({ base: env.API_BASE, maxCalls: ${MAX_CALLS} });
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
      const { name, message, code, status, unlock, gate, param, retry_after_seconds, retry_after, doc_url, request_id, quote, status_url, prepare_url, quote_url } = e;
      return finish({ ok: false, error: { name, code: code ?? (name === 'SyntaxError' ? 'syntax_error' : 'program_error'), message: name === 'SyntaxError' ? message + '. Code runs as the body of an async function; import and export are not supported.' : message, status, unlock, gate, param, retry_after_seconds, retry_after, doc_url, request_id, quote, status_url, prepare_url, quote_url }, lines, logs_truncated, outcome_uncertain: false, ...meter });
    }
  },
};`;
}

export interface SandboxHost {
  loader: WorkerLoader;
  outbound: Fetcher;
  apiBase: string;
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
      env: { API_BASE: host.apiBase, MAX_CALLS },
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
              'The program exceeded 30 seconds. Its call count and final outcome are unknown. Read requests may still finish and consume rows. No purchase was authorized. Retry with a smaller query or inspect the existing preparation status.',
            ),
          ),
        TIME_LIMIT_MS,
      );
    });
    const run = (async () => {
      const response = await worker.getEntrypoint().fetch('https://sandbox.invalid/run');
      const execution = executionSchema.parse(await response.json());
      const rawCalls = response.headers.get('x-execution-calls');
      if (rawCalls === null || !/^\d+$/.test(rawCalls) || Number(rawCalls) > MAX_CALLS)
        throw new Error('Sandbox response lacks authoritative call accounting');
      const rawCompleted = response.headers.get('x-execution-completed');
      if (rawCompleted === null || !/^\d+$/.test(rawCompleted) || Number(rawCompleted) > Number(rawCalls))
        throw new Error('Sandbox response lacks completed call accounting');
      const inFlight = Number(rawCalls) - Number(rawCompleted);
      return {
        ...execution,
        calls: inFlight ? null : Number(rawCompleted),
        calls_started: Number(rawCalls),
        in_flight: inFlight,
        outcome_uncertain: execution.outcome_uncertain || inFlight > 0,
        rate_limit: rateLimitOf(response.headers),
        api_build: response.headers.get('x-arcmira-build'),
      };
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
