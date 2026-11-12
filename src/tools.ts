import { z } from 'zod';
import type { ApiClient } from './api.ts';
import { withRateLimit } from './result.ts';
import pkg from '../package.json' with { type: 'json' };
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import { DOCS, SHORT_GUIDE, referenceText } from './reference.ts';
import { errorResult, okResult, textResult, type ToolResult } from './result.ts';
import { renderExecution, runProgram, type Execution, type SandboxHost } from './sandbox.ts';
import { OUTPUT_LIMITS } from './output.ts';
import { intentParam } from './telemetry.ts';
import { appsSearchTool, appsTranscriptTool, youtubeSearchTool, youtubeTranscriptTool } from './read-tools.ts';
import { APPS_SURFACE, PROGRAM_SURFACE, type Surface } from './surface.ts';

export const TOOL_NAMES = [
  'arcmira_describe',
  'arcmira_execute_read',
  'arcmira_execute_write',
  'arcmira_youtube_search',
  'arcmira_youtube_transcript',
  'arcmira_feedback',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Every retired tool name and what replaced it. A call to one answers tool_retired naming the replacement. */
export const RETIRED_TOOLS: Readonly<Record<string, string>> = {
  describe: 'arcmira_describe',
  execute: 'arcmira_execute_read (arcmira_execute_write for monitor changes and Premium transcripts)',
  prepare_transcript: 'arcmira.transcript(video, { quality: "premium" }) inside arcmira_execute_write',
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

/** What a tool's run gets besides its input: the call it serves, the v1 client, and a sandbox of the access its annotation gives. */
export interface ToolContext {
  call: { id: string; tool: string };
  api: ApiClient;
  /**
   * Read access, whose every request is marked read-only, for a tool annotated read-only, and write access for any other.
   * The run cannot choose. Null under a deployment without a Worker Loader binding.
   */
  sandbox: (() => SandboxHost) | null;
}

export interface ToolSpec<Schema extends z.ZodObject<z.ZodRawShape>> {
  readonly name: ToolName;
  /** Short noun phrase a host shows in its tool picker. Under 40 characters, no dash. */
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Schema;
  readonly annotations: Required<Pick<ToolAnnotations, 'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint'>>;
  /** tools/list _meta. Claude Code loads a tool with anthropic/alwaysLoad upfront instead of deferring it behind tool search; user config can override it. */
  readonly _meta?: { readonly 'anthropic/alwaysLoad': true };
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
  title: 'YouTube research reference',
  description: `The reference for YouTube and podcast transcript research in Arcmira: the arcmira client methods that arcmira_execute_read programs call (search for quotes and clips, transcript for one video, mentions, sponsors, monitors), with arguments, return fields, id rules, examples and errors. topic narrows it, like transcript, search, sponsors or monitors. Reads no indexed content and bills nothing. Docs: ${DOCS.mcp}`,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { 'anthropic/alwaysLoad': true },
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
  title: 'YouTube transcripts and quotes',
  description: `YouTube video and podcast transcripts for questions about what was said: summarize or read a YouTube video from its URL, find the exact quote and the second it was said with a timestamped watch link, often who said it, clips, mentions of a person, brand or company, sponsors and ad reads, podcasts on YouTube included, and the user's monitors. Use Arcmira when the user shares a youtube.com or youtu.be link, or asks what a YouTube video or podcast said. Runs a JavaScript program against the Arcmira API through the arcmira client; one video: return await arcmira.transcript(url, { start, end }); a phrase: return (await arcmira.search({ query })).chunks. Other methods and examples: arcmira_describe. Input is an async function body with arcmira, ArcmiraError and console in scope. Output is bounded JSON: the result first, then the call count, rate limit, build and capped logs. Filters take entity, channel or video ids. It only reads. To start a Premium transcript or translation the account does not own yet, run the same program in arcmira_execute_write. ${LIMITS}`,
  // Read-only, so its program runs with read access. The outbound marks every request read-only, so the API refuses a Premium transcript or translation the account does not own.
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  // Claude Code shows this tool, arcmira_describe and arcmira_feedback in full before any tool search: the reference, the program runner and the way to report a problem. The plain read tools wait behind tool search.
  _meta: { 'anthropic/alwaysLoad': true },
  inputSchema: z.object({ code, intent: intentParam }),
  async run(input, context) {
    return execute(input.code, context);
  },
});

export const executeWriteTool = tool({
  name: 'arcmira_execute_write',
  title: 'Monitors and Premium transcripts',
  description: `Creates and updates Arcmira monitors that alert by email, Slack or webhook when a person, brand or phrase comes up on YouTube, podcasts on YouTube included, and starts Premium transcripts. Runs JavaScript like arcmira_execute_read, plus the monitor writes: create, update (including paused), addEntities, addName and attachTrackers. Nothing is deleted. A Premium read of an untranscribed video starts a transcription, and a Premium read in another language starts a translation. Each uses credits from the account's plan, then its on-demand budget, and reports its charge. The MONITORS section of arcmira_describe has the fields and results. ${LIMITS}`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: z.object({ code, intent: intentParam }),
  async run(input, context) {
    return execute(input.code, context);
  },
});

export const FEEDBACK_CATEGORIES = ['wrong_entity', 'bad_data', 'missing', 'slow', 'confusing', 'other'] as const;

const feedbackInput = z
  .object({
    category: z
      .enum(FEEDBACK_CATEGORIES)
      .describe('wrong_entity: the wrong person, company or show. bad_data: a wrong count, date, quote or label.'),
    note: z.string().min(1).max(4000).describe('What happened in a sentence or two: what the user was doing, what came back, what they expected, and any source links. No credentials or personal details.'),
    request_id: z.string().max(200).optional().describe('The request_id of the error this is about, when there was one.'),
    call_id: z
      .string()
      .regex(/^mcpc_[0-9a-f]{32}$/)
      .optional()
      .describe('The call_id a result named, for the call this is about.'),
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

const FEEDBACK_DESCRIPTION =
  'Saves a feedback record for the Arcmira team. Send one when a result was wrong, slow, empty or confusing, or when the user wants a source or capability Arcmira lacks. Put what they were doing and any source links in note. Each call adds a record; repeated calls create separate records. Costs nothing.';

const feedbackToolFor = (surface: Surface) => tool({
  name: 'arcmira_feedback',
  title: 'Tell Arcmira what went wrong',
  // On /mcp/apps the description keeps only its sentences that name no price.
  description: surface.note(FEEDBACK_DESCRIPTION) ?? '',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  _meta: { 'anthropic/alwaysLoad': true },
  inputSchema: feedbackInput,
  async run(input, { api }) {
    const answer = await api.post('/v1/feedback', feedbackBody(input), { idempotencyKey: crypto.randomUUID() });
    if (!answer.ok) return surface.refusal(answer.error, answer.body);
    return okResult({ ...surface.known(answer.body, ['feedback_id']), recorded: true });
  },
});

export const feedbackTool = feedbackToolFor(PROGRAM_SURFACE);
const appsFeedbackTool = feedbackToolFor(APPS_SURFACE);

export const TOOLS: readonly AnyToolSpec[] = [describeTool, executeReadTool, executeWriteTool, youtubeSearchTool, youtubeTranscriptTool, feedbackTool];
/** The /mcp/apps surface: named, typed tools only, for directories that refuse a program runner. */
export const APPS_TOOLS: readonly AnyToolSpec[] = [appsSearchTool, appsTranscriptTool, appsFeedbackTool];

async function execute(source: string, { sandbox, call }: ToolContext): Promise<ToolResult> {
  if (sandbox === null) return errorResult(sandboxUnavailable());
  return executionResult(await runProgram(sandbox(), source), call.id);
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
    message: `${name} was retired. Use ${RETIRED_TOOLS[name] ?? 'arcmira_describe, then arcmira_execute_read'}. The tools are ${TOOL_NAMES.slice(0, -1).join(', ')} and ${TOOL_NAMES.at(-1)}; refresh the tool list to see them.`,
    doc_url: DOCS.mcp,
    request_id: `mcp_${crypto.randomUUID()}`,
  });
}

export { okResult };

export const SERVER_INSTRUCTIONS = SHORT_GUIDE;
