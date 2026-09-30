/**
 * Directory-reviewer dry run, as an MCP client sees it.
 *
 *   ARCMIRA_KEY=arc_sk_... node --experimental-strip-types scripts/smoke.ts [mcp-url]
 *
 * Lists the tools, reads describe, then runs one execute program per method plus the error
 * paths a host will hit (a name where an id belongs, a retired tool name, a gate). With no key
 * the transport must answer 401 with the OAuth challenge, and the script stops there. Prints
 * one line per call and never prints the key. Exit 1 when any call is not what the manifest
 * promises. Each execute is one or two production calls; the whole run is about 20.
 */
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import pkg from '../package.json' with { type: 'json' };
import { METHODS } from '../src/reference.ts';

const url = new URL(process.argv[2] ?? 'https://mcp.arcmira.com/mcp');
const key = process.env.ARCMIRA_KEY ?? '';
const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';

interface Probe {
  label: string;
  tool: 'describe' | 'execute';
  args: Record<string, unknown>;
  /** ok: a result. error: isError with this code in the text. either: a result or a gate. */
  expect: 'ok' | 'either' | { code: string };
  /** A string the text must contain. */
  contains?: string;
}

const PROBES: Probe[] = [
  { label: 'describe whole', tool: 'describe', args: {}, expect: 'ok', contains: 'ID RULE' },
  { label: 'describe topic', tool: 'describe', args: { topic: 'sponsors' }, expect: 'ok', contains: 'arcmira.sponsors(' },
  { label: 'resolve', tool: 'execute', args: { code: 'const r = await arcmira.resolve("Ramp", { type: "organization" }); return { confidence: r.confidence, best: r.best && { id: r.best.id, name: r.best.name } };' }, expect: 'ok', contains: 'ent_14' },
  { label: 'dates', tool: 'execute', args: { code: 'return { today: arcmira.today(), ago: arcmira.daysAgo(90) };' }, expect: 'ok', contains: 'today' },
  { label: 'console.log', tool: 'execute', args: { code: 'console.log("hello", { a: 1 }); return 2;' }, expect: 'ok', contains: 'hello {"a":1}\nRETURN: 2' },
  { label: 'status channel', tool: 'execute', args: { code: `const s = await arcmira.status({ channelId: "${TBPN}" }); return { indexed: s.channel.searchable_videos, through: s.channel.indexed_through };` }, expect: 'ok', contains: 'indexed' },
  { label: 'status me', tool: 'execute', args: { code: 'const me = await arcmira.status(); return Object.keys(me);' }, expect: 'ok' },
  { label: 'episodes', tool: 'execute', args: { code: `const e = await arcmira.episodes("${TBPN}", { limit: 2 }); return e.episodes.map(x => x.video_id);` }, expect: 'ok', contains: 'RETURN: ["' },
  { label: 'mentions', tool: 'execute', args: { code: `const m = await arcmira.mentions({ entityId: "ent_14", channelId: "${TBPN}", limit: 3 }); return { n: m.data.length, first: m.data[0]?.media?.title };` }, expect: 'ok' },
  { label: 'momentum', tool: 'execute', args: { code: 'const m = await arcmira.momentum("ent_14"); return { verdict: m.verdict, d30: m.volume.mentions_30d };' }, expect: 'ok', contains: 'verdict' },
  { label: 'occurrences', tool: 'execute', args: { code: `const o = await arcmira.occurrences({ channelIds: ["${TBPN}"], types: ["organization"], limit: 3 }); return o.rows.map(r => [r.name, r.count]);` }, expect: 'ok' },
  { label: 'sponsors', tool: 'execute', args: { code: `const s = await arcmira.sponsors("${TBPN}", { limit: 3 }); return s.sponsors.map(x => [x.entity.name, x.ad_reads]);` }, expect: 'either' },
  { label: 'recommendations', tool: 'execute', args: { code: 'const r = await arcmira.recommendations("ent_14", { kind: "organic", limit: 3 }); return r.data.length;' }, expect: 'either' },
  { label: 'search', tool: 'execute', args: { code: `const s = await arcmira.search({ query: "corporate cards", channelIds: ["${TBPN}"], limit: 2 }); return s.chunks.map(c => c.watchUrl);` }, expect: 'either' },
  { label: 'transcript window', tool: 'execute', args: { code: 'const t = await arcmira.transcript("cdLeJU_1UH8", { start: 0, end: 30 }); return { lines: (t.lines ?? t.paragraphs ?? []).length };' }, expect: 'either' },
  { label: 'two calls in parallel', tool: 'execute', args: { code: 'const [a, b] = await Promise.all([arcmira.momentum("ent_14"), arcmira.momentum("ent_323")]); return [a.verdict, b.verdict];' }, expect: 'ok' },
  { label: 'id_required', tool: 'execute', args: { code: 'return await arcmira.momentum("Ramp");' }, expect: { code: 'id_required' }, contains: 'arcmira.resolve' },
  { label: 'invalid_video', tool: 'execute', args: { code: 'return await arcmira.transcript("not a video");' }, expect: { code: 'invalid_video' } },
  { label: 'thrown error', tool: 'execute', args: { code: 'throw new Error("boom");' }, expect: { code: 'program_error' }, contains: 'boom' },
  { label: 'syntax error', tool: 'execute', args: { code: 'const = ;' }, expect: { code: 'syntax_error' } },
  { label: 'no network', tool: 'execute', args: { code: 'const r = await fetch("https://example.com/"); return { status: r.status, body: await r.text() };' }, expect: 'ok', contains: 'outbound_refused' },
  { label: 'call budget', tool: 'execute', args: { code: 'for (let i = 0; i < 50; i++) await arcmira.momentum("ent_14");' }, expect: { code: 'call_budget' } },
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
if (names.join(',') !== 'describe,execute') {
  failed = true;
  console.log('  expected exactly describe and execute');
}
for (const tool of tools.tools) {
  const hints = tool.annotations ?? {};
  if (!(hints.readOnlyHint === true && hints.destructiveHint === false && hints.idempotentHint === true && hints.openWorldHint === false)) {
    failed = true;
    console.log(`  ${tool.name}: hints wrong ${JSON.stringify(hints)}`);
  }
}
const instructions = client.getInstructions() ?? '';
if (!instructions.includes('describe')) {
  failed = true;
  console.log('  instructions do not name describe');
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ type: string; text?: string }>).flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : [])).join('\n');
}

const describeText = textOf(await client.callTool({ name: 'describe', arguments: {} }));
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
  console.log(`${verdict.padEnd(10)} ${probe.label.padEnd(22)} ${probe.tool.padEnd(8)} ${isError ? 'isError' : 'result '} ${String(Date.now() - started).padStart(5)}ms  ${summary}`);
}

const retired = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'resolve_entities', arguments: { q: 'Ramp' } } }),
});
const retiredBody = await retired.text();
const retiredOk = retired.status === 200 && retiredBody.includes('tool_retired');
if (!retiredOk) failed = true;
console.log(`${(retiredOk ? 'ok' : 'UNEXPECTED').padEnd(10)} retired tool name      raw      ${retired.status} ${retiredBody.slice(0, 100)}`);

await client.close();
process.exit(failed ? 1 : 0);
