/**
 * Directory-reviewer dry run over the blessed entities, as an MCP client would see it.
 *
 *   ARCMIRA_KEY=arc_tk_... node --experimental-strip-types scripts/smoke.ts [mcp-url]
 *
 * Lists the tools, then makes one call per tool and one call per gate row the key can hit.
 * With no key the transport must answer 401 with the OAuth challenge, and the script stops there.
 * Prints one line per call and never prints the key. Exit 1 when any call is not what the
 * manifest promises.
 */
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = new URL(process.argv[2] ?? 'https://mcp.arcmira.com/mcp');
const key = process.env.ARCMIRA_KEY ?? '';
const TBPN = 'UC-DRzaGnL_vtBUpCFH5M0tg';
const MTS = 'UClWkDGXEzsh77GAhs90wpXw';

const CALLS: Array<{ label: string; tool: string; args: Record<string, unknown>; expect: 'ok' | 'gate' | 'either' }> = [
  { label: 'resolve handle', tool: 'resolve_entities', args: { q: '@TBPNLive' }, expect: 'ok' },
  { label: 'resolve url', tool: 'resolve_entities', args: { q: 'https://www.youtube.com/channel/UClWkDGXEzsh77GAhs90wpXw' }, expect: 'ok' },
  { label: 'resolve name', tool: 'resolve_entities', args: { q: 'Ramp', type: 'organization' }, expect: 'ok' },
  { label: 'coverage tbpn', tool: 'index_status', args: { youtubeChannelId: TBPN }, expect: 'ok' },
  { label: 'mentions ramp on tbpn', tool: 'list_mentions', args: { entityId: 'ent_14', channelId: TBPN, limit: 5 }, expect: 'ok' },
  { label: 'momentum ramp', tool: 'entity_momentum', args: { entityIds: ['ent_14'] }, expect: 'ok' },
  { label: 'counts brands both', tool: 'count_occurrences', args: { channelIds: [TBPN, MTS], entityTypes: ['organization', 'product'], limit: 5 }, expect: 'ok' },
  { label: 'sponsors tbpn', tool: 'list_sponsors', args: { youtubeChannelId: TBPN }, expect: 'either' },
  { label: 'search recent', tool: 'search_transcripts', args: { query: 'Ramp corporate cards', channelIds: [TBPN], recency: 'year', maxResults: 3 }, expect: 'either' },
  { label: 'gate: premium source', tool: 'search_transcripts', args: { query: 'Ramp', channelIds: [TBPN], source: 'arcmira_premium' }, expect: 'either' },
  { label: 'gate: fresh window', tool: 'search_transcripts', args: { query: 'Ramp', channelIds: [TBPN], recency: 'recent' }, expect: 'either' },
  { label: 'gate: sponsor filter', tool: 'list_sponsors', args: { youtubeChannelId: TBPN, status: 'active' }, expect: 'either' },
  { label: 'gate: mentions dateTo', tool: 'list_mentions', args: { entityId: 'ent_14', dateTo: '2026-01-01' }, expect: 'either' },
  { label: 'gate: job on key', tool: 'index_status', args: { jobId: '00000000-0000-4000-8000-000000000000' }, expect: 'either' },
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

const client = new Client({ name: 'arcmira-mcp-smoke', version: '0.2.0' });
const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${key}` } } });
await client.connect(transport);

const tools = await client.listTools();
const names = tools.tools.map((tool) => tool.name);
console.log(`tools/list: ${names.join(', ')}`);
let failed = false;
for (const tool of tools.tools) {
  const hints = tool.annotations ?? {};
  const okHints = hints.readOnlyHint === true && hints.destructiveHint === false && hints.idempotentHint === true && hints.openWorldHint === false;
  if (!okHints) {
    failed = true;
    console.log(`  ${tool.name}: hints wrong ${JSON.stringify(hints)}`);
  }
}

function summarize(structured: unknown, text: string): string {
  const body = (structured ?? safeParse(text)) as Record<string, unknown> | null;
  if (body === null) return text.slice(0, 160);
  const error = body.error as Record<string, unknown> | undefined;
  if (error) {
    const unlock = (error.unlock ?? {}) as Record<string, unknown>;
    return `${error.code} gate=${error.gate ?? '-'} param=${error.param ?? '-'} unlock=${unlock.url ?? '-'}`;
  }
  const parts: string[] = [];
  for (const key of ['entities', 'chunks', 'mentions', 'cards', 'rows', 'sponsors']) {
    if (Array.isArray(body[key])) parts.push(`${key}=${(body[key] as unknown[]).length}`);
  }
  if (body.channel) parts.push(`channel=${JSON.stringify(body.channel).slice(0, 80)}`);
  if (body.transcription) parts.push('transcription');
  if (body.as_of !== undefined) parts.push(`as_of=${body.as_of}`);
  if (body.access) parts.push(`access=${(body.access as Record<string, unknown>).code}`);
  return parts.join(' ') || JSON.stringify(body).slice(0, 160);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

for (const call of CALLS) {
  const started = Date.now();
  const result = await client.callTool({ name: call.tool, arguments: call.args });
  const text = (result.content as Array<{ type: string; text?: string }>).find((part) => part.type === 'text')?.text ?? '';
  const isError = result.isError === true;
  const expect = call.expect;
  const verdict = expect === 'either' ? 'ok' : (expect === 'gate') === isError ? 'ok' : 'UNEXPECTED';
  if (verdict !== 'ok') failed = true;
  console.log(`${verdict.padEnd(10)} ${call.label.padEnd(24)} ${call.tool.padEnd(19)} ${isError ? 'isError' : 'result '} ${String(Date.now() - started).padStart(5)}ms  ${summarize(result.structuredContent, text)}`);
}
await client.close();
process.exit(failed ? 1 : 0);
