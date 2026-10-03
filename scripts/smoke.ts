/**
 * Directory-reviewer dry run, as an MCP client sees it.
 *
 *   ARCMIRA_KEY=arc_sk_... node --experimental-strip-types scripts/smoke.ts [mcp-url]
 *
 * Lists the tools, reads arcmira_describe, then runs one arcmira_execute_read program per method
 * plus the error paths a host will hit (a name where an id belongs, a retired tool name, a gate,
 * a write from the read tool). With no key the transport must answer 401 with the OAuth
 * challenge, and the script stops there. Prints one line per call and never prints the key. Exit 1
 * when any call is not what the manifest promises. Most probes make one or two API reads. The
 * budget probe makes 40. The purchase probes read a free quote with arcmira.quote, then send a raw
 * POST /v1/transcriptions from the read sandbox, which the outbound refuses before any request (a
 * Premium purchase happens only inside the transcript GET). The key's usage is read before and after
 * each to show neither spent anything. The write tool only lists monitors; the smoke never changes
 * the account.
 */
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import pkg from '../package.json' with { type: 'json' };
import { METHODS } from '../src/reference.ts';

const url = new URL(process.argv[2] ?? 'https://mcp.arcmira.com/mcp');
const key = process.env.ARCMIRA_KEY ?? '';
const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';
/** A video the smoke key does not own, so its quote is positive. */
const UNOWNED_VIDEO = 'cdLeJU_1UH8';

interface Probe {
  label: string;
  tool: 'arcmira_describe' | 'arcmira_execute_read' | 'arcmira_execute_write';
  args: Record<string, unknown>;
  /** ok: a result. error: isError with this code in the text. either: a result or a gate. */
  expect: 'ok' | 'either' | { code: string };
  /** A string the text must contain. */
  contains?: string;
}

const PROBES: Probe[] = [
  { label: 'describe whole', tool: 'arcmira_describe', args: {}, expect: 'ok', contains: 'ID RULE' },
  { label: 'describe topic', tool: 'arcmira_describe', args: { topic: 'sponsors' }, expect: 'ok', contains: 'arcmira.sponsors(' },
  { label: 'resolve', tool: 'arcmira_execute_read', args: { code: 'const r = await arcmira.resolve("Ramp", { type: "organization" }); return { confidence: r.confidence, best: r.best && { id: r.best.id, name: r.best.name } };' }, expect: 'ok', contains: 'ent_14' },
  { label: 'dates', tool: 'arcmira_execute_read', args: { code: 'return { today: arcmira.today(), ago: arcmira.daysAgo(90) };' }, expect: 'ok', contains: 'today' },
  { label: 'console.log', tool: 'arcmira_execute_read', args: { code: 'console.log("hello", { a: 1 }); return 2;' }, expect: 'ok', contains: '"value":2' },
  { label: 'status channel', tool: 'arcmira_execute_read', args: { code: `const s = await arcmira.status({ channelId: "${TBPN}" }); return { indexed: s.channel.searchable_videos, through: s.channel.indexed_through };` }, expect: 'ok', contains: 'indexed' },
  { label: 'status me', tool: 'arcmira_execute_read', args: { code: 'const me = await arcmira.status(); return Object.keys(me);' }, expect: 'ok' },
  { label: 'episodes', tool: 'arcmira_execute_read', args: { code: `const e = await arcmira.episodes("${TBPN}", { limit: 2 }); return e.episodes.map(x => x.video_id);` }, expect: 'ok', contains: '"value":["' },
  { label: 'mentions', tool: 'arcmira_execute_read', args: { code: `const m = await arcmira.mentions({ entityId: "ent_14", channelId: "${TBPN}", limit: 3 }); return { n: m.mentions.length, first: m.mentions[0]?.media?.title, window: m.window };` }, expect: 'ok', contains: 'window' },
  { label: 'momentum', tool: 'arcmira_execute_read', args: { code: 'const m = await arcmira.momentum("ent_14"); return { verdict: m.verdict, d30: m.volume.mentions_30d };' }, expect: 'ok', contains: 'verdict' },
  { label: 'occurrences', tool: 'arcmira_execute_read', args: { code: `const o = await arcmira.occurrences({ channelIds: ["${TBPN}"], types: ["organization"], limit: 3 }); return o.rows.map(r => [r.name, r.count]);` }, expect: 'ok' },
  { label: 'sponsors', tool: 'arcmira_execute_read', args: { code: `const s = await arcmira.sponsors("${TBPN}", { limit: 3 }); return s.sponsors.map(x => [x.entity.name, x.ad_reads]);` }, expect: 'either' },
  { label: 'recommendations', tool: 'arcmira_execute_read', args: { code: 'const r = await arcmira.recommendations("ent_14", { kind: "organic", limit: 3 }); return r.recommendations.map(x => x.class);' }, expect: 'either' },
  { label: 'search', tool: 'arcmira_execute_read', args: { code: `const s = await arcmira.search({ query: "corporate cards", channelIds: ["${TBPN}"], limit: 2 }); return s.chunks.map(c => c.watch_url);` }, expect: 'either' },
  { label: 'transcript window', tool: 'arcmira_execute_read', args: { code: 'const t = await arcmira.transcript("cdLeJU_1UH8", { start: 0, end: 30 }); return { lines: (t.lines ?? t.paragraphs ?? []).length };' }, expect: 'either' },
  { label: 'two calls in parallel', tool: 'arcmira_execute_read', args: { code: 'const [a, b] = await Promise.all([arcmira.momentum("ent_14"), arcmira.momentum("ent_323")]); return [a.verdict, b.verdict];' }, expect: 'ok' },
  { label: 'id_required', tool: 'arcmira_execute_read', args: { code: 'return await arcmira.momentum("Ramp");' }, expect: { code: 'id_required' }, contains: 'arcmira.resolve' },
  { label: 'invalid_video', tool: 'arcmira_execute_read', args: { code: 'return await arcmira.transcript("not a video");' }, expect: { code: 'invalid_video' } },
  { label: 'thrown error', tool: 'arcmira_execute_read', args: { code: 'throw new Error("boom");' }, expect: { code: 'program_error' }, contains: 'boom' },
  { label: 'syntax error', tool: 'arcmira_execute_read', args: { code: 'const = ;' }, expect: { code: 'syntax_error' } },
  { label: 'no network', tool: 'arcmira_execute_read', args: { code: 'const r = await fetch("https://example.com/"); return { status: r.status, body: await r.text() };' }, expect: 'ok', contains: 'outbound_refused' },
  { label: 'call budget', tool: 'arcmira_execute_read', args: { code: 'for (let i = 0; i < 50; i++) await arcmira.momentum("ent_14");' }, expect: { code: 'call_budget' } },
  { label: 'monitors list', tool: 'arcmira_execute_read', args: { code: 'const m = await arcmira.monitors.list(); return { monitors: m.monitors.length };' }, expect: 'ok', contains: 'monitors' },
  { label: 'write method in read', tool: 'arcmira_execute_read', args: { code: 'return await arcmira.monitors.update("mon_x", { paused: true });' }, expect: { code: 'write_tool_required' } },
  { label: 'raw write in read', tool: 'arcmira_execute_read', args: { code: 'const r = await fetch("https://api.arcmira.com/v1/monitors", { method: "POST", body: "{}" }); return { status: r.status, body: await r.text() };' }, expect: 'ok', contains: 'arcmira_execute_write' },
  { label: 'delete in write', tool: 'arcmira_execute_write', args: { code: 'const r = await fetch("https://api.arcmira.com/v1/monitors/mon_x", { method: "DELETE" }); return { status: r.status, body: await r.text() };' }, expect: 'ok', contains: 'outbound_refused' },
  { label: 'write tool reads', tool: 'arcmira_execute_write', args: { code: 'const m = await arcmira.monitors.list(); return { monitors: m.monitors.length };' }, expect: 'ok', contains: 'monitors' },
];

if (!key) {
  const probe = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } }) });
  const challenge = probe.headers.get('www-authenticate') ?? '';
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  const metadata = metadataUrl ? ((await (await fetch(metadataUrl)).json()) as { authorization_servers?: string[] }) : null;
  const ok = probe.status === 401 && metadata !== null && Array.isArray(metadata.authorization_servers) && metadata.authorization_servers.length > 0;
  console.log(`${ok ? 'ok' : 'UNEXPECTED'}         no key: ${probe.status} ${challenge || '(no WWW-Authenticate)'} -> ${metadata?.authorization_servers?.join(', ') ?? '-'}`);
  process.exit(ok ? 0 : 1);
}

const client = new Client({ name: 'arcmira-mcp-smoke', version: pkg.version });
const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${key}` } } });
await client.connect(transport);

let failed = false;
const tools = await client.listTools();
const names = tools.tools.map((tool) => tool.name).sort();
console.log(`tools/list: ${names.join(', ')}`);
if (names.join(',') !== 'arcmira_describe,arcmira_execute_read,arcmira_execute_write,arcmira_feedback') {
  failed = true;
  console.log('  expected arcmira_describe, arcmira_execute_read, arcmira_execute_write and arcmira_feedback');
}
for (const tool of tools.tools) {
  const hints = tool.annotations ?? {};
  const writes = tool.name === 'arcmira_execute_write';
  if (!(hints.readOnlyHint === !writes && hints.destructiveHint === false && hints.openWorldHint === false)) {
    failed = true;
    console.log(`  ${tool.name}: hints wrong ${JSON.stringify(hints)}`);
  }
}
const instructions = client.getInstructions() ?? '';
if (!instructions.includes('arcmira_describe')) {
  failed = true;
  console.log('  instructions do not name arcmira_describe');
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ type: string; text?: string }>).flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : [])).join('\n');
}

const describeText = textOf(await client.callTool({ name: 'arcmira_describe', arguments: {} }));
for (const method of METHODS) {
  if (!describeText.includes(`arcmira.${method.name}(`)) {
    failed = true;
    console.log(`  describe lacks ${method.name}`);
  }
}

for (const probe of PROBES) {
  const started = Date.now();
  const result = await client.callTool({ name: probe.tool, arguments: probe.args });
  const text = textOf(result);
  const isError = result.isError === true;
  let verdict = 'ok';
  if (result.structuredContent !== undefined) verdict = 'HIDDEN';
  else if (probe.expect === 'ok' && isError) verdict = 'UNEXPECTED';
  else if (typeof probe.expect === 'object' && !(isError && text.includes(`"code":"${probe.expect.code}"`))) verdict = 'UNEXPECTED';
  else if (probe.contains && !text.includes(probe.contains)) verdict = 'MISSING';
  if (verdict !== 'ok') failed = true;
  const summary = text.replace(/\s+/g, ' ').slice(0, 110);
  console.log(`${verdict.padEnd(10)} ${probe.label.padEnd(22)} ${probe.tool.replace('arcmira_', '').padEnd(13)} ${isError ? 'isError' : 'result '} ${String(Date.now() - started).padStart(5)}ms  ${summary}`);
}

/** What a purchase can move: rows, monetary spend and credits. */
async function spend(): Promise<string> {
  const text = textOf(await client.callTool({ name: 'arcmira_execute_read', arguments: { code: 'const { usage } = await arcmira.status(); return [usage.rows_used, usage.current_spend_cents, usage.credits?.available ?? null];' } }));
  return JSON.stringify((JSON.parse(text) as { value: unknown }).value);
}

const beforeQuote = await spend();
const quote = await client.callTool({
  name: 'arcmira_execute_read',
  arguments: { code: `const q = await arcmira.quote("${UNOWNED_VIDEO}"); return { owned: q.owned, eligible: q.eligible, rows: q.quote.rows, charge: q.charge };` },
});
const quoteText = textOf(quote);
const quoted = quote.isError === true ? null : (JSON.parse(quoteText) as { value: { owned: boolean; rows: number } }).value;
const afterQuote = await spend();
const quoteOk = afterQuote === beforeQuote && quoted !== null && !quoted.owned && quoted.rows > 0;
if (!quoteOk) failed = true;
console.log(`${(quoteOk ? 'ok' : 'UNEXPECTED').padEnd(10)} ${'quote free, unowned'.padEnd(22)} execute  spend ${beforeQuote} -> ${afterQuote}  ${quoteText.replace(/\s+/g, ' ').slice(0, 90)}`);

const raw = await client.callTool({
  name: 'arcmira_execute_read',
  arguments: { code: `const r = await fetch("https://api.arcmira.com/v1/transcriptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ video_id: "${UNOWNED_VIDEO}" }) }); return { status: r.status, body: await r.json() };` },
});
const rawText = textOf(raw);
const afterRaw = await spend();
const refusedCode = /"code":"([a-z_]+)"/.exec(rawText)?.[1];
const rawOk = refusedCode === 'outbound_refused' && afterRaw === afterQuote;
if (!rawOk) failed = true;
console.log(`${(rawOk ? 'ok' : 'UNEXPECTED').padEnd(10)} ${'raw purchase POST'.padEnd(22)} execute  spend ${afterQuote} -> ${afterRaw}  ${refusedCode ?? rawText.replace(/\s+/g, ' ').slice(0, 90)}`);

for (const [name, args, replacement] of [
  ['resolve_entities', { q: 'Ramp' }, 'arcmira_describe'],
  ['execute', { code: 'return 1;' }, 'arcmira_execute_read'],
  ['prepare_transcript', { video_id: UNOWNED_VIDEO }, 'arcmira.transcript(video'],
] as const) {
  const retired = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }),
  });
  const retiredBody = await retired.text();
  const retiredOk = retired.status === 200 && retiredBody.includes('tool_retired') && retiredBody.includes(replacement);
  if (!retiredOk) failed = true;
  console.log(`${(retiredOk ? 'ok' : 'UNEXPECTED').padEnd(10)} retired ${name.padEnd(18)} raw      ${retired.status} ${retiredBody.slice(0, 100)}`);
}

await client.close();
process.exit(failed ? 1 : 0);
