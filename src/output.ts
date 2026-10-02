import type { Execution } from "./sandbox.ts";

export const RESULT_CAP = 20_000;
export const LOG_CAP = 4_000;

const CONTROL = [
  "state",
  "status",
  "error",
  "code",
  "message",
  "status_url",
  "prepare_url",
  "quote_url",
  "next_cursor",
  "cursor",
  "has_more",
  "request_id",
  "id",
  "video_id",
  "videoId",
  "next_poll_seconds",
  "nextPollSeconds",
  "retry_after_seconds",
  "retry_after",
  "gate",
  "unlock",
  "doc_url",
  "param",
  "premium_job",
  "request",
  "existing",
  "quote",
  "charge",
  "rows_charged",
];
const priority = (key: string) => {
  const index = CONTROL.indexOf(key);
  return index < 0 ? CONTROL.length : index;
};

/** Bound data without slicing JSON, retaining outcome and continuation fields before bulk arrays. */
export function renderExecution(execution: Execution): string {
  let budget = 12_000;
  let truncated = execution.truncated ?? false;
  function bounded(value: unknown, depth = 0): unknown {
    if (
      value === null ||
      value === undefined ||
      typeof value === "boolean" ||
      typeof value === "number"
    )
      return value ?? null;
    if (typeof value === "string") {
      const size = Math.max(0, Math.min(budget, 3_000));
      const text = value.slice(0, size);
      budget -= text.length;
      if (text.length < value.length) truncated = true;
      return text;
    }
    if (depth > 8 || budget <= 0) {
      truncated = true;
      return null;
    }
    if (Array.isArray(value)) {
      const items = [];
      for (const item of value) {
        if (budget <= 0 || items.length >= 100) {
          truncated = true;
          break;
        }
        budget -= 4;
        items.push(bounded(item, depth + 1));
      }
      return items;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value).sort(
        ([a], [b]) => priority(a) - priority(b),
      );
      const result: Record<string, unknown> = {};
      for (const [key, item] of entries) {
        if (key.length > 120) {
          truncated = true;
          continue;
        }
        if (budget <= 0 || Object.keys(result).length >= 100) {
          truncated = true;
          break;
        }
        budget -= key.length + 4;
        result[key] = bounded(item, depth + 1);
      }
      return result;
    }
    return bounded(String(value), depth);
  }
  const outcome = execution.ok
    ? { value: bounded(execution.value) }
    : { error: bounded(execution.error) };
  const envelope: Record<string, unknown> = {
    ok: execution.ok,
    ...outcome,
    calls: execution.calls,
    ...(execution.calls_started === undefined ? {} : { calls_started: execution.calls_started, in_flight: execution.in_flight }),
    outcome_uncertain: execution.outcome_uncertain,
    rate_limit: execution.rate_limit,
    api_build: execution.api_build,
    truncated,
    recovery:
      "When truncated, return fewer fields or a smaller page. Continue with the returned next_cursor using the same filters.",
    logs: execution.lines,
    logs_truncated: execution.logs_truncated,
  };
  // Escaped strings can cost six JSON characters per source character.
  let text = JSON.stringify(envelope);
  if (text.length > RESULT_CAP) {
    budget = 1_500;
    truncated = false;
    if (execution.ok) envelope.value = bounded(execution.value);
    else envelope.error = bounded(execution.error);
    envelope.logs = [];
    envelope.logs_truncated =
      execution.lines.length > 0 || execution.logs_truncated;
    envelope.truncated = true;
    text = JSON.stringify(envelope);
  }
  return text;
}
