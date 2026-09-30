/** Serves the cloudflare:workers module to node tests: only what src/index.ts imports from it. */
const SHIM = `export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }`;

export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'cloudflare:workers', shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === 'cloudflare:workers') return { format: 'module', source: SHIM, shortCircuit: true };
  return next(url, context);
}
