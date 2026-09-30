import { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import { DOCS, SHORT_GUIDE, referenceText } from './reference.ts';
import { errorResult, okResult, textResult, type ToolResult } from './result.ts';
import { renderExecution, runProgram, type Execution, type SandboxHost } from './sandbox.ts';

/** Both tools read our index and nothing else. The Claude and ChatGPT directories require all four. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const TOOL_NAMES = ['describe', 'execute'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** The tools 0.6.0 listed. A call to one answers with the two that replaced it. */
export const RETIRED_TOOLS = [
  'search_transcripts',
  'resolve_entities',
  'list_mentions',
  'entity_momentum',
  'list_sponsors',
  'list_recommendations',
  'index_status',
  'count_occurrences',
  'list_episodes',
  'get_transcript',
] as const;

export interface ToolSpec<Schema extends z.ZodObject<z.ZodRawShape>> {
  readonly name: ToolName;
  /** Short noun phrase a host shows in its tool picker. Under 40 characters, no dash. */
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Schema;
  run(input: z.output<Schema>, host: SandboxHost | null): Promise<ToolResult>;
}

export type AnyToolSpec = ToolSpec<z.ZodObject<z.ZodRawShape>>;

function tool<Schema extends z.ZodObject<z.ZodRawShape>>(spec: ToolSpec<Schema>): ToolSpec<Schema> {
  return spec;
}

export const describeTool = tool({
  name: 'describe',
  title: 'The arcmira client reference',
  description: `The reference for the arcmira client that execute exposes: the id rule (resolve a name to an id before filtering on it), which method answers which question, every method with its arguments and return fields, eight worked example programs, the quirks that cost answers, error codes and doc links. Call it once before your first execute; pass topic to narrow it to one method and its examples. Reads nothing from the index and never bills. Docs: ${DOCS.mcp}`,
  inputSchema: z.object({
    topic: z.string().max(60).optional().describe('One word to narrow the reference, like sponsors, resolve, transcript or dates. Omit for the whole reference (about 2,800 tokens).'),
  }),
  async run(input) {
    return textResult(referenceText(input.topic));
  },
});

export const executeTool = tool({
  name: 'execute',
  title: 'Run a program against Arcmira',
  description: `Run JavaScript against the arcmira client and get back what it printed (console.log) plus its return value as JSON. The code is the body of an async function with arcmira and ArcmiraError in scope: use await and return one compact value. Write one program per question: resolve every name it carries with arcmira.resolve, check each .best against what the user meant, run every query the question needs, and return only the fields the answer needs. Filters take ids only (ent_..., UC..., 11-character video ids); a name where an id belongs throws id_required. Use arcmira.today() and arcmira.daysAgo(n) for date windows. Limits: 30 seconds, 40 API calls, 20,000 characters of output. A plan gate comes back as ERROR with an unlock url to relay. Read describe first for the method list and examples.`,
  inputSchema: z.object({
    code: z.string().min(1).max(40_000).describe('JavaScript source, the body of async function (arcmira, ArcmiraError, console) { ... }. Return a value or console.log lines. No import or export.'),
  }),
  async run(input, host) {
    if (host === null) return errorResult(sandboxUnavailable());
    const execution = await runProgram(host, input.code);
    return executionResult(execution);
  },
});

export const TOOLS: readonly AnyToolSpec[] = [describeTool, executeTool];

/** A program's outcome as a tool result: text for every host, the envelope as structuredContent only when it is the whole story. */
export function executionResult(execution: Execution): ToolResult {
  const text = renderExecution(execution);
  const meta = { calls: execution.calls, api_build: execution.api_build };
  if (execution.ok) return { content: [{ type: 'text', text }], _meta: { 'arcmira.com/execution': meta } };
  return { content: [{ type: 'text', text }], isError: true, _meta: { 'arcmira.com/execution': meta } };
}

function sandboxUnavailable() {
  return {
    type: 'server_error',
    code: 'sandbox_unavailable',
    message: 'The execute sandbox is not configured on this deployment. Retry in a minute; if it repeats, report it at https://github.com/arcmira/mcp/issues.',
    doc_url: `${DOCS.errors}#server_error`,
    request_id: `mcp_${crypto.randomUUID()}`,
  };
}

/** What a host that cached the 0.6.0 tool list gets when it calls one of them. */
export function retiredToolResult(name: string): ToolResult {
  return errorResult({
    type: 'invalid_request_error',
    code: 'tool_retired',
    message: `${name} was retired in 0.7.0. Call describe for the arcmira client reference, then execute with a program; the same data is one method away (for example arcmira.resolve, arcmira.search, arcmira.sponsors). Refresh the tool list to see the two tools.`,
    doc_url: DOCS.mcp,
    request_id: `mcp_${crypto.randomUUID()}`,
  });
}

export { okResult };

export const SERVER_INSTRUCTIONS = SHORT_GUIDE;
