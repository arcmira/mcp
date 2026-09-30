/**
 * Runs every worked example in src/reference.ts and every task skill program in src/skills.ts against production through the sandbox client and
 * fails when a program throws, returns nothing, or reads a field the API does not send (an undefined
 * leaf in the returned value). This is how the reference is kept true to the live response shapes.
 *
 *   ARCMIRA_KEY=arc_sk_... node --experimental-strip-types scripts/check-examples.ts
 *
 * About a dozen calls, a few rows each. Pass --base to point at another API.
 */
import { EXAMPLES } from '../src/reference.ts';
import { TASK_SKILLS } from '../src/skills.ts';

type Client = {
  createArcmira(o: { base: string; fetch: typeof fetch }): { arcmira: object; meter: { calls: number } };
  ArcmiraError: unknown;
};
const { createArcmira, ArcmiraError } = (await import(new URL('../src/sandbox/client.js', import.meta.url).href)) as Client;

const key = process.env.ARCMIRA_KEY;
if (!key) throw new Error('ARCMIRA_KEY missing');
const baseArg = process.argv.indexOf('--base');
const base = baseArg > 0 ? process.argv[baseArg + 1] : 'https://api.arcmira.com';

function undefinedPaths(value: unknown, path = '$', out: string[] = []): string[] {
  if (value === undefined) out.push(path);
  else if (Array.isArray(value)) value.forEach((v, i) => undefinedPaths(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) undefinedPaths(v, `${path}.${k}`, out);
  return out;
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;
let failed = 0;
const PROGRAMS = [...EXAMPLES, ...TASK_SKILLS.flatMap((s) => s.programs.map((p) => ({ title: `${s.name}: ${p.title}`, code: p.code })))];
for (const [i, example] of PROGRAMS.entries()) {
  const { arcmira, meter } = createArcmira({
    base,
    fetch: ((url: string, init?: RequestInit) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${key}` } })) as typeof fetch,
  });
  const lines: string[] = [];
  const console_ = { log: (...a: unknown[]) => lines.push(a.map(String).join(' ')), error: (...a: unknown[]) => lines.push(a.map(String).join(' ')) };
  let verdict: string;
  try {
    let value = await new AsyncFunction('arcmira', 'ArcmiraError', 'console', example.code)(arcmira, ArcmiraError, console_);
    const choose = (value as { choose?: Array<{ id: string }> } | null)?.choose;
    if (choose && choose.length === 0) throw new Error('choose came back empty: the pick guard offered nothing to choose from');
    if (choose?.[0]?.id && example.code.includes('ID = null')) {
      lines.push(`choose returned ${choose.length}; rerun with ID = ${choose[0].id}`);
      value = await new AsyncFunction('arcmira', 'ArcmiraError', 'console', example.code.replace('ID = null', `ID = ${JSON.stringify(choose[0].id)}`))(arcmira, ArcmiraError, console_);
    }
    const holes = undefinedPaths(value);
    const empty = value === undefined || value === null || (Array.isArray(value) && value.length === 0);
    if (holes.length > 0) verdict = `FAIL undefined at ${holes.slice(0, 6).join(', ')}`;
    else if (empty) verdict = 'FAIL returned nothing';
    else verdict = `ok ${choose ? '(after choose) ' : ''}${JSON.stringify(value).slice(0, 110)}`;
  } catch (error) {
    verdict = `FAIL ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 160)}` : String(error)}`;
  }
  if (verdict.startsWith('FAIL')) failed += 1;
  console.log(`${i + 1}. ${example.title}: ${verdict} (${meter.calls} calls)`);
}
console.log(failed === 0 ? `every example runs against ${base} with no undefined field` : `${failed} example(s) failed`);
process.exit(failed === 0 ? 0 : 1);
