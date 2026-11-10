import type { ApiErrorBody } from './api.ts';
import { errorResult, type ToolResult } from './result.ts';

/**
 * How one MCP surface shows what the API says. /mcp passes the API's refusals, notes and unlocks
 * through. /mcp/apps is the store surface: its results name no plan, price, offer or link other
 * than a YouTube watch link, whatever the API words them, because store agreements forbid an
 * upsell. Each apps text is either a fixed sentence below or the API's own sentences with every
 * sentence that names a plan or a link removed, so a later API wording change cannot add one.
 */

/** GET /v1/transcripts answers this, exactly, when YouTube has no video with the id. */
export const VIDEO_NOT_FOUND = 'YouTube has no video with this id. It may have been removed or the link may be mistyped.';

/** A transcript with no caption lines, on /mcp/apps. */
export const NO_CAPTION_TRACK = 'This video has no caption track Arcmira can read, so there are no lines to return.';

const OUT_OF_CREDITS = 'This account is out of Arcmira credits for now.';
const NOT_HERE = "Arcmira can't return this here.";

/** A sentence naming a plan, an offer or an unlock, or carrying a link that is not a YouTube watch link. */
const OFFER = /\b(?:pro|premium|free|paid|upgrades?|trials?|plans?|pricing|ultra|enterprise|on-demand|unlock\w*)\b/i;
const OTHER_LINK = /https?:\/\/(?!(?:www\.)?youtube\.com\/watch\?)\S+/i;

/** The sentences of `text` that name no plan, offer or other link; undefined when none is left. */
export function planFree(text: string | null | undefined): string | undefined {
  const kept = (text ?? '').split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== '' && !OFFER.test(sentence) && !OTHER_LINK.test(sentence));
  return kept.length > 0 ? kept.join(' ') : undefined;
}

export interface SearchNotesInput {
  note: string | null | undefined;
  freshness: unknown;
  unlock: unknown;
  access: unknown;
  window: unknown;
  matched: boolean;
}

export interface Surface {
  /** What a transcript tool says where the API's advice names a quality argument it does not take. */
  readonly transcript: {
    /** A video with no caption lines. */
    readonly unavailable: string;
    /** The note on captions read for an account whose default quality is Premium, given the rest of the API's note. */
    readonly noPremium: (rest: string) => string;
  };
  /** A note as this surface shows it. */
  note(text: string | null | undefined): string | undefined;
  /** A refusal, with the details the tool adds. */
  refusal(error: ApiErrorBody, details?: Record<string, unknown>): ToolResult;
  /** The note and gate fields of a search answer. */
  searchNotes(input: SearchNotesInput): Record<string, unknown>;
}

const START_PREMIUM = 'arcmira_execute_read starts one with arcmira.transcript(video, { quality: "premium" }), and that read uses credits.';
const NO_PREMIUM = 'These are captions because this account has no Premium transcript of this video.';
const joined = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ');

/** /mcp: the API's words and unlocks, untouched, plus where the program tool takes over. */
export const PROGRAM_SURFACE: Surface = {
  transcript: {
    unavailable: `When a video has no caption track, its transcript comes only from a Premium transcription, which this tool never starts: ${START_PREMIUM}`,
    noPremium: (rest) => joined(rest, NO_PREMIUM, START_PREMIUM),
  },
  note: (text) => text || undefined,
  refusal: errorResult,
  searchNotes: ({ note, freshness, unlock, access }) => ({ note: note || undefined, freshness, unlock, access }),
};

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {});
const day = (value: unknown): string | undefined => (typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : undefined);

/** The refusal sentence /mcp/apps shows for an API error. */
function appsMessage(error: ApiErrorBody & { details?: unknown }): string {
  if (error.code === 'transcript_unavailable') return error.message === VIDEO_NOT_FOUND ? VIDEO_NOT_FOUND : NO_CAPTION_TRACK;
  if (error.type === 'quota_exceeded') return OUT_OF_CREDITS;
  if (error.code === 'filter_requires_paid' && error.param) return `The ${error.param} filter isn't available here. Search again without it.`;
  if (error.code === 'freshness_requires_paid') {
    const cutoff = day(record(record(error.details).limit).served_through);
    return cutoff ? `Results here cover videos published up to ${cutoff}. Set after to ${cutoff} or earlier.` : NOT_HERE;
  }
  return planFree(error.message) ?? NOT_HERE;
}

/** The error fields /mcp/apps keeps: no gate, unlock, details or doc link. */
const APPS_ERROR_FIELDS = ['type', 'code', 'reason', 'param', 'retry_after_seconds', 'retry_after', 'request_id'] as const;
/** The tool details /mcp/apps keeps beside a refusal. */
const APPS_DETAIL_FIELDS = ['call_id', 'reason', 'languages', 'state', 'resolved', 'options'] as const;

const pick = (from: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((key) => from[key] !== undefined && from[key] !== null).map((key) => [key, from[key]]));

/** The search answer's dates, said plainly when the account's results stop before today. */
function datesNote(freshness: unknown, window: unknown, matched: boolean): string | undefined {
  const through = day(record(freshness).served_through);
  if (through === undefined) return undefined;
  const after = day(record(window).after);
  if (matched) return after ? `These results cover videos published from ${after} to ${through}.` : `These results cover videos published up to ${through}.`;
  return after ? `Nothing matched in videos published from ${after} to ${through}.` : `Nothing matched in videos published up to ${through}.`;
}

/** The API's own "No match before <date>." restates the dates note, so it goes when the dates note is there. */
const NO_MATCH_BEFORE = /(?:^|\s)No match before \S+\.(?=\s|$)/;

/** /mcp/apps: fixed sentences for gates, and the API's other sentences only when they name no plan or link. */
export const APPS_SURFACE: Surface = {
  transcript: {
    unavailable: NO_CAPTION_TRACK,
    noPremium: (rest) => rest,
  },
  note: planFree,
  refusal(error, details = {}) {
    const kept = pick(details, APPS_DETAIL_FIELDS);
    const note = planFree(typeof details.note === 'string' ? details.note : undefined);
    return errorResult({ ...pick(error as unknown as Record<string, unknown>, APPS_ERROR_FIELDS), message: appsMessage(error) } as ApiErrorBody, {
      ...kept,
      ...(note ? { note } : {}),
    });
  },
  searchNotes({ note, freshness, window, matched }) {
    const dates = datesNote(freshness, window, matched);
    const rest = planFree(dates ? (note ?? '').replace(NO_MATCH_BEFORE, ' ') : note);
    return { note: joined(dates, rest) || undefined };
  },
};
