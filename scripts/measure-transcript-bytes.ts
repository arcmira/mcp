/**
 * Response bytes for one get_transcript call, measured on the wire.
 *
 *   ARCMIRA_KEY=arc_tk_... node --experimental-strip-types scripts/measure-transcript-bytes.ts <video> [mcp-url]
 *
 * Connects as an MCP client, calls get_transcript once, and prints the byte length of the HTTP
 * response body the server sent, split into the text block and the structured content.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import pkg from '../package.json' with { type: 'json' };

const video = process.argv[2];
const url = new URL(process.argv[3] ?? 'http://localhost:8790/mcp');
const key = process.env.ARCMIRA_KEY ?? '';
if (!video || !key) {
  console.error('Usage: ARCMIRA_KEY=arc_tk_... node --experimental-strip-types scripts/measure-transcript-bytes.ts <video> [mcp-url]');
  process.exit(1);
}

const upstream = globalThis.fetch;
let wireBytes = 0;
globalThis.fetch = async (input: Parameters<typeof upstream>[0], init?: Parameters<typeof upstream>[1]) => {
  const isCall = typeof init?.body === 'string' && init.body.includes('"tools/call"');
  const response = await upstream(input, init);
  if (!isCall) return response;
  const text = await response.text();
  wireBytes = Buffer.byteLength(text);
  return new Response(text, { status: response.status, headers: response.headers });
};

const client = new Client({ name: 'arcmira-mcp-measure', version: pkg.version });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${key}` } } }));
const result = await client.callTool({ name: 'get_transcript', arguments: { video } });
await client.close();

const content = result.content as Array<{ type: string; text?: string }>;
const text = content.find((part) => part.type === 'text')?.text ?? '';
const structured = result.structuredContent === undefined ? '' : JSON.stringify(result.structuredContent);
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;
console.log([
  video.padEnd(14),
  `wire ${kb(wireBytes).padStart(10)}`,
  `text ${kb(Buffer.byteLength(text)).padStart(10)}`,
  `structured ${kb(Buffer.byteLength(structured)).padStart(10)}`,
  `isError=${result.isError === true}`,
].join('  '));
