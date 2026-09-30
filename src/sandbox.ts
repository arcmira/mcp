import clientSource from './sandbox/client-source.ts';
import { MAX_CALLS } from './reference.ts';

/** How long one program may run before execute answers timeout. */
export const TIME_LIMIT_MS = 30_000;
/** Characters of program output execute returns before it truncates. About 5,000 tokens. */
export const RESULT_CAP = 20_000;
/** CPU the sandbox isolate may burn on one program. */
export const CPU_LIMIT_MS = 5_000;
/** The compatibility date the sandbox isolate runs under. */
export const SANDBOX_COMPAT_DATE = '2026-08-01';

export interface ExecutionError {
  name: string;
  code: string;
  message: string;
  unlock?: unknown;
  gate?: string;
  param?: string;
  retry_after_seconds?: number;
  doc_url?: string;
  request_id?: string;
}

export interface Meter {
  calls: number;
  rate_limit: { limit: number; remaining: number; reset: number } | null;
  api_build: string | null;
}

export type Execution =
  | ({ ok: true; value: unknown; lines: string[] } & Meter)
  | ({ ok: false; error: ExecutionError; lines: string[] } & Meter);

/** What runs in the isolate: the program as the body of an async function, arcmira and ArcmiraError in scope. */
export function programModule(code: string): string {
  return `import { createArcmira, ArcmiraError } from './client.js';
const stringify = (v) => typeof v === 'string' ? v : JSON.stringify(v, null, 0) ?? String(v);
export default {
  async fetch(request, env) {
    const lines = [];
    const log = (tag) => (...args) => lines.push((tag ? tag + ' ' : '') + args.map(stringify).join(' '));
    const console = { log: log(''), info: log(''), warn: log('WARN'), error: log('ERR'), debug: log('') };
    const { arcmira, meter } = createArcmira({ base: env.API_BASE, maxCalls: env.MAX_CALLS });
    try {
      const value = await (async (arcmira, ArcmiraError, console) => {
${code}
      })(arcmira, ArcmiraError, console);
      return Response.json({ ok: true, value: value === undefined ? null : value, lines, ...meter });
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      const { name, message, code, unlock, gate, param, retry_after_seconds, doc_url, request_id } = e;
      return Response.json({ ok: false, error: { name, code: code ?? 'program_error', message, unlock, gate, param, retry_after_seconds, doc_url, request_id }, lines, ...meter });
    }
  },
};
`;
}

export interface SandboxHost {
  loader: WorkerLoader;
  /** The outbound the isolate's fetch() reaches: the parent's API proxy for this caller. */
  outbound: Fetcher;
  apiBase: string;
}

const EMPTY_METER: Meter = { calls: 0, rate_limit: null, api_build: null };

/** Runs one program in a fresh isolate and reads back its envelope. Never throws. */
export async function runProgram(host: SandboxHost, code: string): Promise<Execution> {
  const worker = host.loader.load({
    compatibilityDate: SANDBOX_COMPAT_DATE,
    mainModule: 'program.js',
    modules: { 'program.js': programModule(code), 'client.js': clientSource },
    env: { API_BASE: host.apiBase, MAX_CALLS },
    globalOutbound: host.outbound,
    limits: { cpuMs: CPU_LIMIT_MS, subRequests: MAX_CALLS + 5 },
  });
  const timeout = new Promise<Execution>((resolve) =>
    setTimeout(
      () =>
        resolve({
          ok: false,
          error: { name: 'TimeoutError', code: 'timeout', message: `The program ran longer than ${TIME_LIMIT_MS / 1000} s. Make fewer calls per program, or narrow each call with limit, after and before.` },
          lines: [],
          ...EMPTY_METER,
        }),
      TIME_LIMIT_MS,
    ),
  );
  const run = (async (): Promise<Execution> => {
    try {
      const response = await worker.getEntrypoint().fetch('https://sandbox.invalid/run');
      return (await response.json()) as Execution;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const syntax = /SyntaxError/.test(message) || (error instanceof Error && error.name === 'SyntaxError');
      return {
        ok: false,
        error: {
          name: syntax ? 'SyntaxError' : 'SandboxError',
          code: syntax ? 'syntax_error' : 'sandbox_error',
          message: syntax
            ? `${message}. The code runs as the body of an async function: top-level await and return are fine, import and export are not.`
            : `${message}. Retry once; if it repeats, make the program smaller.`,
        },
        lines: [],
        ...EMPTY_METER,
      };
    }
  })();
  return Promise.race([run, timeout]);
}

const stringify = (value: unknown): string => (typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value)));

/** The text block an execute result carries: printed lines, then RETURN or ERROR, capped. */
export function renderExecution(execution: Execution): string {
  const parts: string[] = [];
  if (execution.lines.length > 0) parts.push(execution.lines.join('\n'));
  if (execution.ok) {
    if (execution.value !== null && execution.value !== undefined) parts.push(`RETURN: ${stringify(execution.value)}`);
  } else {
    parts.push(`ERROR: ${stringify(execution.error)}`);
  }
  const text = parts.join('\n') || '(no output: the program printed nothing and returned nothing)';
  return text.length <= RESULT_CAP ? text : `${text.slice(0, RESULT_CAP)}\n[truncated ${text.length - RESULT_CAP} characters; return fewer fields or a smaller limit]`;
}
