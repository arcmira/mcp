import type { Execution } from "./sandbox.ts";

export const RESULT_CAP = 20_000;
export const LOG_CAP = 4_000;
const OUTPUT_BUDGET = 12_000;
const STRING_CAP = 3_000;
const ARRAY_CAP = 100;
const CUT_LIMIT = 5;
const count = (n: number) => n.toLocaleString("en-US");
/** What execute promises about its output, written from the caps renderExecution applies. */
export const OUTPUT_LIMITS = `${count(OUTPUT_BUDGET)} characters of output in total, ${count(STRING_CAP)} per string, and ${count(ARRAY_CAP)} items per array`;

/** Output truncation drops rows the API returned, so the page's own next_cursor would skip them. */
const RECOVERY =
  "The output budget cut this result; the API did not. truncated_arrays lists each cut array with its returned and total rows. Rerun the same call with the same cursor, limit and filters, and return fewer fields (map rows to the fields the answer needs). Do not follow next_cursor from this result: it points past rows that were not shown. If a smaller page is needed, restart pagination from the first page with the smaller limit.";

const CONTROL = [
  "state",
  "status",
  "error",
  "code",
  "message",
  "status_url",
  "next_cursor",
  "cursor",
  "has_more",
  "window",
  "request_id",
  "id",
  "video_id",
  "eta_seconds",
  "next_poll_seconds",
  "retry_after_seconds",
  "retry_after",
  "gate",
  "unlock",
  "doc_url",
  "param",
  "job",
  "action",
  "premium_job",
  "existing",
  "quote",
  "charge",
  "rows_charged",
];
const priority = (key: string) => {
  const index = CONTROL.indexOf(key);
  return index < 0 ? CONTROL.length : index;
};

/** An empty answer: nothing, or an object whose every top-level array came back empty. */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== "object") return false;
  const values = Object.values(value);
  if (values.length === 0) return true;
  const arrays = values.filter(Array.isArray);
  return arrays.length > 0 && arrays.every((array) => array.length === 0);
}

/** A resolve ask the program handed back for the user to pick from. */
function isAsk(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Boolean((value as { ask?: unknown }).ask);
}

/**
 * Bound data without slicing JSON, retaining outcome and continuation fields before bulk arrays.
 * `feedback` is the one line added when the outcome is an error, empty, truncated or a resolve ask.
 */
export function renderExecution(execution: Execution, options: { feedback?: string } = {}): string {
  let budget = OUTPUT_BUDGET;
  let truncated = execution.truncated ?? false;
  let cuts = [...(execution.truncated_arrays ?? [])];
  function bounded(value: unknown, depth = 0, path = ""): unknown {
    if (
      value === null ||
      value === undefined ||
      typeof value === "boolean" ||
      typeof value === "number"
    )
      return value ?? null;
    if (typeof value === "string") {
      const size = Math.max(0, Math.min(budget, STRING_CAP));
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
        if (budget <= 0 || items.length >= ARRAY_CAP) {
          truncated = true;
          if (cuts.length < CUT_LIMIT)
            cuts.push({ path, returned: items.length, total: value.length });
          break;
        }
        budget -= 4;
        items.push(bounded(item, depth + 1, `${path}[${items.length}]`));
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
        result[key] = bounded(item, depth + 1, `${path}.${key}`);
      }
      return result;
    }
    return bounded(String(value), depth, path);
  }
  const outcome = execution.ok
    ? { value: bounded(execution.value, 0, "value") }
    : { error: bounded(execution.error, 0, "error") };
  const envelope: Record<string, unknown> = {
    ok: execution.ok,
    ...outcome,
    calls: execution.calls,
    ...(execution.calls_started === undefined ? {} : { calls_started: execution.calls_started, in_flight: execution.in_flight }),
    outcome_uncertain: execution.outcome_uncertain,
    rate_limit: execution.rate_limit,
    api_build: execution.api_build,
    truncated,
    ...(truncated ? { truncated_arrays: cuts, recovery: RECOVERY } : {}),
    ...(options.feedback && (!execution.ok || truncated || isEmpty(execution.value) || isAsk(execution.value)) ? { feedback: options.feedback } : {}),
    logs: execution.lines,
    logs_truncated: execution.logs_truncated,
  };
  // Escaped strings can cost six JSON characters per source character.
  let text = JSON.stringify(envelope);
  if (text.length > RESULT_CAP) {
    budget = 1_500;
    cuts = [...(execution.truncated_arrays ?? [])];
    if (execution.ok) envelope.value = bounded(execution.value, 0, "value");
    else envelope.error = bounded(execution.error, 0, "error");
    envelope.truncated_arrays = cuts;
    envelope.recovery = RECOVERY;
    envelope.logs = [];
    envelope.logs_truncated =
      execution.lines.length > 0 || execution.logs_truncated;
    envelope.truncated = true;
    if (options.feedback) envelope.feedback = options.feedback;
    text = JSON.stringify(envelope);
  }
  return text;
}
