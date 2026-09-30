import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A Worker Loader for node tests: writes the modules to a temp folder, imports the main module,
 * and routes the program's fetch() to the outbound the parent handed it, as workerd does with
 * globalOutbound. One import per load; module code is fresh each time because the folder is.
 */
export function fakeLoader(): WorkerLoader {
  return {
    get() {
      throw new Error('fake loader only implements load()');
    },
    load(code: WorkerLoaderWorkerCode) {
      const dir = mkdtempSync(join(tmpdir(), 'arcmira-sandbox-'));
      for (const [name, module] of Object.entries(code.modules)) {
        writeFileSync(join(dir, name), typeof module === 'string' ? module : ((module as { js?: string }).js ?? ''));
      }
      const outbound = code.globalOutbound as { fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> } | null | undefined;
      const entrypoint = {
        async fetch(input: string | URL | Request): Promise<Response> {
          const mod = (await import(pathToFileURL(join(dir, code.mainModule)).href)) as { default: { fetch(request: Request, env: unknown): Promise<Response> } };
          const original = globalThis.fetch;
          globalThis.fetch = (async (target: string | URL | Request, init?: RequestInit) => {
            if (outbound === null || outbound === undefined) throw new Error('no network');
            return outbound.fetch(target, init);
          }) as typeof fetch;
          try {
            return await mod.default.fetch(new Request(String(input)), code.env);
          } finally {
            globalThis.fetch = original;
          }
        },
      };
      return { getEntrypoint: () => entrypoint } as unknown as WorkerStub;
    },
  } as unknown as WorkerLoader;
}

/** An outbound that answers by path prefix, like the fake API the tool tests used. */
export function fakeOutbound(answers: Record<string, (url: URL) => Response>): Fetcher & { urls: URL[] } {
  const urls: URL[] = [];
  return {
    urls,
    async fetch(input: string | URL | Request) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      urls.push(url);
      const key = Object.keys(answers).find((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
      if (key === undefined) return Response.json({ error: { type: 'not_found', code: 'not_found', message: `fake api has no answer for ${url.pathname}`, doc_url: 'x', request_id: 'r' } }, { status: 404 });
      return answers[key](url);
    },
  } as unknown as Fetcher & { urls: URL[] };
}
