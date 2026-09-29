/**
 * One list_recommendations call per kind for Ramp, as an MCP client sees it, printing the text
 * block a host shows. Fails when a result's structuredContent differs from its text (HIDDEN)
 * or when a row's kind is not the kind asked for.
 *
 *   ARCMIRA_KEY=arc_sk_... node --experimental-strip-types scripts/probe-recommendations.ts [mcp-url]
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = new URL(process.argv[2] ?? 'https://mcp.arcmira.com/mcp');
const client = new Client({ name: 'arcmira-recs-probe', version: '0' });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${process.env.ARCMIRA_KEY ?? ''}` } } }));

let failed = false;
for (const kind of ['organic', 'sponsored'] as const) {
  const result = await client.callTool({ name: 'list_recommendations', arguments: { entityId: 'ent_14', kind, limit: 2 } });
  const texts = (result.content as Array<{ type: string; text?: string }>).flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : []));
  const hidden = result.structuredContent !== undefined && (texts.length !== 1 || texts[0] !== JSON.stringify(result.structuredContent));
  const body = JSON.parse(texts[0] ?? '{}') as { recommendations?: Array<{ kind: string }> };
  const kinds = (body.recommendations ?? []).map((row) => row.kind);
  const wrongKind = result.isError === true || kinds.length === 0 || kinds.some((rowKind) => rowKind !== kind);
  if (hidden || wrongKind) failed = true;
  console.log(`${hidden ? 'HIDDEN' : wrongKind ? 'UNEXPECTED' : 'ok'} kind=${kind} rows=${kinds.length}`);
  console.log(texts[0]);
}
await client.close();
process.exit(failed ? 1 : 0);
