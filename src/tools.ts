import { z } from 'zod';
import type { ApiClient } from './api.ts';
import { withRateLimit } from './result.ts';
import pkg from '../package.json' with { type: 'json' };
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import { DOCS, SHORT_GUIDE, referenceText } from './reference.ts';
import { errorResult, okResult, textResult, type ToolResult } from './result.ts';
import { renderExecution, runProgram, type Access, type Execution, type SandboxHost } from './sandbox.ts';
import { OUTPUT_LIMITS } from './output.ts';
import { intentParam } from './telemetry.ts';

export const TOOL_NAMES = ['arcmira_describe', 'arcmira_execute_read', 'arcmira_execute_write', 'arcmira_feedback'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Every retired tool name and what replaced it. A call to one answers tool_retired naming the replacement. */
export const RETIRED_TOOLS: Readonly<Record<string, string>> = {
  describe: 'arcmira_describe',
  execute: 'arcmira_execute_read (arcmira_execute_write for monitor changes)',
  prepare_transcript: 'arcmira.transcript(video, { quality: "premium" }) inside arcmira_execute_read',
  ...Object.fromEntries(
    [
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
    ].map((name) => [name, 'arcmira_describe, then arcmira_execute_read with a program']),
  ),
};

/** What a tool's run gets besides its input: the call it serves, the v1 client, and a sandbox of the access it asks for. */
export interface ToolContext {
  call: { id: string; tool: string };
  api: ApiClient;
  /** Null under a deployment without a Worker Loader binding. */
  sandbox: ((access: Access) => SandboxHost) | null;
}

export interface ToolSpec<Schema extends z.ZodObject<z.ZodRawShape>> {
  readonly name: ToolName;
  /** Short noun phrase a host shows in its tool picker. Under 40 characters, no dash. */
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Schema;
  readonly annotations: Required<Pick<ToolAnnotations, 'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint'>>;
  run(input: z.output<Schema>, context: ToolContext): Promise<ToolResult>;
}

export type AnyToolSpec = ToolSpec<z.ZodObject<z.ZodRawShape>>;

function tool<Schema extends z.ZodObject<z.ZodRawShape>>(spec: ToolSpec<Schema>): ToolSpec<Schema> {
  return spec;
}

/** First line of every describe: the server version, so an agent can tell this reference from a stale skill copy. */
export const VERSION_LINE = `arcmira MCP ${pkg.version}.`;

/** The whole reference's size, measured from the text so the describe input never goes stale. */
export const REFERENCE_SIZE = `about ${Math.round(referenceText().length / 1000)},000 characters`;

export const describeTool = tool({
  name: 'arcmira_describe',
  title: 'The arcmira client reference',
  description: `Returns the reference for the typed arcmira client the execute tools run: method arguments, return fields, entity ID rules, examples, errors, the budget and monitor rules, and documentation links. The optional topic narrows it to a method or subject. Reads no indexed content and bills nothing. Docs: ${DOCS.mcp}`,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: z.object({
    topic: z.string().max(60).optional().describe(`One word to narrow the reference, like sponsors, resolve, transcript, monitors or dates. Omit for the whole reference (${REFERENCE_SIZE}).`),
    intent: intentParam,
  }),
  async run(input) {
    return textResult(`${VERSION_LINE}\n\n${referenceText(input.topic)}`);
  },
});

const code = z
  .string()
  .min(1)
  .max(40_000)
  .describe('JavaScript source, the body of async function (arcmira, ArcmiraError, console) { ... }. Return a value or console.log lines. No import or export.');

const LIMITS = `Limits: 30 seconds, 40 API calls, and ${OUTPUT_LIMITS}.`;

export const executeReadTool = tool({
  name: 'arcmira_execute_read',
  title: 'Research with a program',
  description: `Runs JavaScript against the Arcmira API through the arcmira client: indexed YouTube and podcast transcripts, mentions, sponsors, recommendations, coverage, Premium transcripts (a Premium read of an untranscribed video starts a transcription that uses credits from the account's plan, then its on-demand budget, and reports its charge), and the user's monitors. Input is an async function body with arcmira, ArcmiraError, and console in scope. Output is bounded JSON with the result first, then the call count, rate limit, build and capped logs. Methods and examples: arcmira_describe. Filters require entity, channel, or video IDs. ${LIMITS}`,
  // Not read-only: a Premium read can start a transcription that uses credits. Not destructive: it only adds.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: z.object({ code, intent: intentParam }),
  async run(input, context) {
    return execute(input.code, 'read', context);
  },
});

export const executeWriteTool = tool({
  name: 'arcmira_execute_write',
  title: 'Change Arcmira monitors',
  description: `Runs JavaScript like arcmira_execute_read, plus the monitor writes: create, update (including paused), addEntities, addName and attachTrackers. Nothing is deleted. The MONITORS section of arcmira_describe has the fields and results. ${LIMITS}`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: z.object({ code, intent: intentParam }),
  async run(input, context) {
    return execute(input.code, 'write', context);
  },
});

export const FEEDBACK_CATEGORIES = ['wrong_entity', 'bad_data', 'missing', 'slow', 'confusing', 'other'] as const;

const feedbackInput = z
  .object({
    category: z
      .enum(FEEDBACK_CATEGORIES)
      .describe('wrong_entity: the wrong person, company or show. bad_data: a wrong count, date, quote or label. missing: something that should be there is not. slow: it took too long. confusing: a result, error or rule was hard to act on. other.'),
    note: z.string().min(1).max(4000).describe('What happened in a sentence or two: what the user was doing, what came back, what they expected, and any source links. No credentials or personal details.'),
    request_id: z.string().max(200).optional().describe('The request_id of the error this is about, when there was one.'),
    call_id: z
      .string()
      .regex(/^mcpc_[0-9a-f]{32}$/)
      .optional()
      .describe('The call_id a result named (mcpc_ followed by 32 hex characters), for the call this is about.'),
    intent: intentParam,
  })
  .strict();

/** The POST /v1/feedback body for one arcmira_feedback call. */
export function feedbackBody(input: Omit<z.output<typeof feedbackInput>, 'intent'>): Record<string, unknown> {
  return {
    type: 'experience',
    category: input.category,
    notes: input.note,
    ...(input.request_id ? { request_id: input.request_id } : {}),
    ...(input.call_id ? { mcp_call_id: input.call_id } : {}),
  };
}

export const feedbackTool = tool({
  name: 'arcmira_feedback',
  title: 'Tell Arcmira what went wrong',
  description: 'Saves a feedback record for the Arcmira team. Send one when a result was wrong, slow, empty or confusing, or when the user wants a source or capability Arcmira lacks. Put what they were doing and any source links in note. Each call adds a record; repeated calls create separate records. Costs nothing.',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema: feedbackInput,
  async run(input, { api }) {
    const answer = await api.post('/v1/feedback', feedbackBody(input), { idempotencyKey: crypto.randomUUID() });
    if (!answer.ok) return errorResult(answer.error, answer.body);
    return okResult({ ...answer.body, recorded: true });
  },
});

export const TOOLS: readonly AnyToolSpec[] = [describeTool, executeReadTool, executeWriteTool, feedbackTool];

async function execute(source: string, access: Access, { sandbox, call }: ToolContext): Promise<ToolResult> {
  if (sandbox === null) return errorResult(sandboxUnavailable());
  return executionResult(await runProgram(sandbox(access), source), call.id);
}

/** A program's outcome as a tool result: text for every host, naming its call_id when the outcome warrants feedback. */
export function executionResult(execution: Execution, callId: string): ToolResult {
  const text = renderExecution(execution, { callId });
  const meta = {
    calls: execution.calls,
    api_build: execution.api_build,
    rate_limit: execution.rate_limit,
    outcome_uncertain: execution.outcome_uncertain,
    routes: execution.routes ?? [],
  };
  return withRateLimit(
    {
      content: [{ type: 'text', text }],
      ...(execution.ok ? {} : { isError: true }),
      _meta: { 'arcmira.com/execution': meta },
    },
    execution.rate_limit,
  );
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

/** What a host that cached an older tool list gets when it calls a retired name. */
export function retiredToolResult(name: string): ToolResult {
  return errorResult({
    type: 'invalid_request_error',
    code: 'tool_retired',
    message: `${name} was retired. Use ${RETIRED_TOOLS[name] ?? 'arcmira_describe, then arcmira_execute_read'}. The tools are arcmira_describe, arcmira_execute_read, arcmira_execute_write and arcmira_feedback; refresh the tool list to see them.`,
    doc_url: DOCS.mcp,
    request_id: `mcp_${crypto.randomUUID()}`,
  });
}

export { okResult };

export const SERVER_INSTRUCTIONS = SHORT_GUIDE;
