import { z } from 'zod';
import type { ApiClient } from './api.ts';
import { withRateLimit } from './result.ts';
import pkg from '../package.json' with { type: 'json' };
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import { DOCS, SHORT_GUIDE, referenceText } from './reference.ts';
import { errorResult, okResult, textResult, type ToolResult } from './result.ts';
import { renderExecution, runProgram, type Execution, type SandboxHost } from './sandbox.ts';

/** Retrieval and quote tools do not submit preparation jobs. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const TOOL_NAMES = ['describe', 'execute', 'quote_transcript', 'prepare_transcript'] as const;
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
  annotations?: ToolAnnotations;
  run(input: z.output<Schema>, host: SandboxHost | null, api?: ApiClient): Promise<ToolResult>;
}

export type AnyToolSpec = ToolSpec<z.ZodObject<z.ZodRawShape>>;

function tool<Schema extends z.ZodObject<z.ZodRawShape>>(spec: ToolSpec<Schema>): ToolSpec<Schema> {
  return spec;
}

/** First line of every describe: the server version, and why a stale plugin or skill copy does not make this reference stale. */
export const VERSION_LINE = `arcmira MCP ${pkg.version}. The server sends this reference fresh on every call; plugin and skill copies can lag, so keep them on auto-update: ${DOCS.mcp}#stay-up-to-date`;

export const describeTool = tool({
  name: 'describe',
  title: 'The arcmira client reference',
  description: `Returns the reference for the typed arcmira client available inside execute: method arguments, return fields, entity ID rules, examples, errors, and documentation links. The optional topic narrows the reference to a method or subject. This tool does not read indexed content or consume billable rows. Docs: ${DOCS.mcp}`,
  inputSchema: z.object({
    topic: z.string().max(60).optional().describe('One word to narrow the reference, like sponsors, resolve, transcript or dates. Omit for the whole reference (about 2,800 tokens).'),
  }),
  async run(input) {
    return textResult(`${VERSION_LINE}\n\n${referenceText(input.topic)}`);
  },
});

export const executeTool = tool({
  name: 'execute',
  title: 'Run a program against Arcmira',
  description: `Runs JavaScript against Arcmira's read-only client for indexed YouTube and podcast transcripts, mentions, sponsors, recommendations, and coverage. Input is an async function body with arcmira, ArcmiraError, and console in scope. Output is bounded JSON with the outcome first, then actual call/rate/build facts and capped logs. Timeouts report unknown calls and may leave reads in flight. GET never purchases Premium. Use quote_transcript and, after explicit cost authorization, prepare_transcript. Methods and examples are documented by describe. Filters require entity, channel, or video IDs. Limits: 30 seconds, 40 API calls, and 20,000 characters of output.`,
  inputSchema: z.object({
    code: z
      .string()
      .min(1)
      .max(40_000)
      .describe(
        'JavaScript source, the body of async function (arcmira, ArcmiraError, console) { ... }. Return a value or console.log lines. No import or export.',
      ),
  }),
  async run(input, host) {
    if (host === null) return errorResult(sandboxUnavailable());
    const execution = await runProgram(host, input.code);
    return executionResult(execution);
  },
});

const video = z
  .string()
  .regex(/^[A-Za-z0-9_-]{11}$/)
  .describe('Exact 11-character YouTube video ID.');
export const quoteTranscriptTool = tool({
  name: 'quote_transcript',
  title: 'Quote a whole video transcript',
  description:
    'Returns a free quote for preparing one whole Premium video transcript, including actual row/credit units and possible on-demand cents. It does not buy or submit a provider job. A requested transcript window does not reduce the whole-video purchase price.',
  inputSchema: z.object({ video_id: video }).strict(),
  async run(input, _host, api) {
    if (!api) return errorResult(sandboxUnavailable());
    const answer = await api.get(`/v1/transcripts/${input.video_id}/quote`);
    return answer.ok ? okResult(answer.body) : errorResult(answer.error, answer.body);
  },
});
export const prepareTranscriptTool = tool({
  name: 'prepare_transcript',
  title: 'Prepare a Premium transcript',
  description:
    'Explicitly authorizes a whole-video Premium purchase and durable preparation. Only call after the user authorizes the supplied max_rows and monetary ceiling. max_on_demand_cents defaults to zero. Persist an idempotency_key before calling; retry an uncertain outcome with the same key and exact same inputs. Returns the public {request, existing?} envelope: 201 ready, 202 pending, 200 replay, or a typed refusal with its current quote. This tool can debit the account. It can only POST /v1/transcriptions; execute remains read-only.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: z
    .object({
      video_id: video,
      max_rows: z
        .number()
        .int()
        .min(0)
        .max(3600)
        .describe('Explicit maximum whole-video row price accepted by the user.'),
      max_on_demand_cents: z
        .number()
        .nonnegative()
        .optional()
        .describe('Maximum new monetary overage in cents. Omitted means zero.'),
      idempotency_key: z
        .string()
        .min(1)
        .max(128)
        .describe(
          'Persisted intent key. Reuse unchanged after timeout or lost response; change only for a new deliberate purchase.',
        ),
    })
    .strict(),
  async run(input, _host, api) {
    if (!api) return errorResult(sandboxUnavailable());
    try {
      const answer = await api.prepareTranscript(input);
      if (!answer.ok && ['upstream_unreadable', 'redirect_refused'].includes(answer.error.code))
        throw new Error('Preparation response did not establish the outcome');
      return answer.ok ? okResult(answer.body) : errorResult(answer.error, answer.body);
    } catch {
      return errorResult({
        type: 'server_error',
        code: 'preparation_outcome_unknown',
        message:
          'The purchase response was not received. The purchase may have been accepted. Retry prepare_transcript with the same idempotency_key and identical ceilings; do not create a new key.',
        doc_url: DOCS.errors,
        request_id: `mcp_${crypto.randomUUID()}`,
      });
    }
  },
});
export const TOOLS: readonly AnyToolSpec[] = [describeTool, executeTool, quoteTranscriptTool, prepareTranscriptTool];

/** A program's outcome as a tool result: text for every host, the envelope as structuredContent only when it is the whole story. */
export function executionResult(execution: Execution): ToolResult {
  const text = renderExecution(execution);
  const meta = {
    calls: execution.calls,
    api_build: execution.api_build,
    rate_limit: execution.rate_limit,
    outcome_uncertain: execution.outcome_uncertain,
  };
  if (execution.ok)
    return withRateLimit(
      {
        content: [{ type: 'text', text }],
        _meta: { 'arcmira.com/execution': meta },
      },
      execution.rate_limit,
    );
  return withRateLimit(
    {
      content: [{ type: 'text', text }],
      isError: true,
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

/** What a host that cached the 0.6.0 tool list gets when it calls one of them. */
export function retiredToolResult(name: string): ToolResult {
  return errorResult({
    type: 'invalid_request_error',
    code: 'tool_retired',
    message: `${name} was retired in 0.7.0. Call describe for the arcmira client reference, then execute with a program; the same data is one method away (for example arcmira.resolve, arcmira.search, arcmira.sponsors). Refresh the tool list to see the current tools.`,
    doc_url: DOCS.mcp,
    request_id: `mcp_${crypto.randomUUID()}`,
  });
}

export { okResult };

export const SERVER_INSTRUCTIONS = SHORT_GUIDE;
