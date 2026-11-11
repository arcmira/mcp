import type { ApiErrorBody } from './api.ts';
import { errorResult, type ToolResult } from './result.ts';

/**
 * How one MCP surface shows what the API says. /mcp passes the API's refusals, notes and unlocks
 * through. /mcp/apps is the store surface: its refusals and notes name no plan, price, offer or
 * link other than a YouTube watch link, whatever the API words them, because store agreements
 * forbid an upsell. Each apps refusal or note is either a fixed sentence below or the API's own
 * sentences with every sentence that names a plan or a link removed, so a later API wording
 * change cannot add one. Its answers keep only the fields the tools know.
 */

/** GET /v1/transcripts answers this, exactly, when YouTube has no video with the id. */
export const VIDEO_NOT_FOUND = 'YouTube has no video with this id. It may have been removed or the link may be mistyped.';

/** A transcript with no caption lines, on /mcp/apps. */
export const NO_CAPTION_TRACK = 'This video has no caption track Arcmira can read, so there are no lines to return.';

/** A transcript in the API's `pending` state, on /mcp/apps. */
const PREPARING = 'Arcmira is still preparing this transcript. Read it again in a minute.';
const OUT_OF_CREDITS = 'This account is out of Arcmira credits for now.';
const NOT_HERE = "Arcmira can't return this here.";

/** A word that names a plan, a price or an offer, also inside a snake_case name like filter_requires_paid. */
const OFFER =
  /(?<![a-z])(?:pro|premium|free|paid|upgrad\w*|trials?|plans?|pricing|prices?|costs?|billing|subscri\w*|tiers?|seats?|buy\w*|purchas\w*|checkout|top.?up|sign.?up|ultra|enterprise|on-demand|unlock\w*|discount\w*|coupon\w*|promo\w*|usd|eur|gbp|per (?:month|year|seat)|monthly|annual\w*)(?![a-z])|[$€£]\s?\d|\d\s?%\s?off(?![a-z])/i;
const LINK = /https?:\/\/\S+|(?:[a-z0-9-]+\.)+(?:com|net|org|io|ai|dev|app|co|gg|to|so|sh|me|tv)(?![a-z0-9-])\S*/gi;
const YOUTUBE_WATCH = /^(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?/i;
/** A link to the second a passage was said: YouTube's watch page or Arcmira's, which embeds YouTube's player. */
const WATCH_LINK = /^https:\/\/(?:www\.)?(?:youtube|arcmira)\.com\/watch\?(\S*)$/;
/** A watch link's own parameters: the video and the second it opens at. */
const WATCH_PARAM = /^(?:v=[\w-]{11}|t=\d+(?:\.\d+)?s?)$/;

/** True when `text` names a plan or an offer, or carries a link that is not a YouTube watch link. */
const offers = (text: string) => OFFER.test(text) || [...text.matchAll(LINK)].some(([link]) => !YOUTUBE_WATCH.test(link));

const decoded = (part: string) => {
  try {
    return decodeURIComponent(part.replaceAll('+', ' '));
  } catch {
    return part;
  }
};

/** `url` when it is a watch link whose other parameters, decoded, name no plan, offer or other link. */
function watchLink(url: string | null | undefined): string | undefined {
  const query = url?.match(WATCH_LINK)?.[1];
  if (query === undefined) return undefined;
  const rest = query.split('&').filter((part) => part !== '' && !WATCH_PARAM.test(part)).map(decoded);
  return rest.some(offers) ? undefined : url!;
}

/** The sentences of `text` that name no plan, offer or other link; undefined when none is left. */
export function planFree(text: string | null | undefined): string | undefined {
  const kept = (text ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '' && !offers(sentence));
  return kept.length > 0 ? kept.join(' ') : undefined;
}

export interface SearchMetaInput {
  window: unknown;
  as_of: string | null | undefined;
  note: string | null | undefined;
  search_index: Record<string, unknown> | undefined;
  freshness: unknown;
  unlock: unknown;
  access: unknown;
  matched: boolean;
}

export interface Surface {
  /** What a transcript tool says where the API's advice names a quality argument it does not take. */
  readonly transcript: {
    /** A video with no caption lines. */
    readonly unavailable: string;
    /** The note on a transcript Arcmira holds in a state other than ready, such as a Premium transcription still running. */
    readonly notReady: string | undefined;
    /** The note on captions read for an account whose default quality is Premium, given the rest of the API's note. */
    readonly noPremium: (rest: string) => string;
  };
  /** A note as this surface shows it. */
  note(text: string | null | undefined): string | undefined;
  /** A result's watch link as this surface shows it. */
  link(url: string | null | undefined): string | undefined;
  /** An API error as this surface shows it, outside a tool result too. */
  error(error: ApiErrorBody): ApiErrorBody;
  /** An API answer's fields as this surface shows them: all of them, or only `fields`. */
  known(body: unknown, fields: readonly string[]): Record<string, unknown> | undefined;
  /** A refusal, with the details the tool adds. */
  refusal(error: ApiErrorBody, details?: Record<string, unknown>): ToolResult;
  /** A search answer's fields after its results, in the order /mcp has always sent them. */
  searchMeta(input: SearchMetaInput): Record<string, unknown>;
}

const START_PREMIUM = 'arcmira_execute_read starts one with arcmira.transcript(video, { quality: "premium" }), and that read uses credits.';
const NO_PREMIUM = 'These are captions because this account has no Premium transcript of this video.';
const joined = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ');

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const day = (value: unknown): string | undefined => (typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : undefined);
const pick = (from: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((key) => from[key] !== undefined && from[key] !== null).map((key) => [key, from[key]]));
const knownFields = (body: unknown, fields: readonly string[]) => {
  const from = record(body);
  return from && pick(from, fields);
};

const PROGRAM_UNAVAILABLE = `When a video has no caption track, its transcript comes only from a Premium transcription, which this tool never starts: ${START_PREMIUM}`;

/** /mcp: the API's words and unlocks, untouched, plus where the program tool takes over. */
export const PROGRAM_SURFACE: Surface = {
  transcript: {
    unavailable: PROGRAM_UNAVAILABLE,
    notReady: PROGRAM_UNAVAILABLE,
    noPremium: (rest) => joined(rest, NO_PREMIUM, START_PREMIUM),
  },
  note: (text) => text || undefined,
  link: (url) => url || undefined,
  error: (error) => error,
  known: (body) => record(body),
  refusal: errorResult,
  searchMeta: ({ window, as_of, note, search_index, freshness, unlock, access }) => ({
    window,
    as_of,
    note: note || undefined,
    search_index,
    freshness,
    unlock,
    access,
  }),
};

/** The apps error code for each gate code that names a plan. */
const APPS_CODES: Readonly<Record<string, string>> = {
  filter_requires_paid: 'filter_unavailable',
  freshness_requires_paid: 'outside_date_range',
};

/** An identifier the API sent, kept on /mcp/apps only when it names no plan or link. */
const plain = (value: unknown) => (typeof value === 'string' && !offers(value) ? value : undefined);

/** The refusal sentence /mcp/apps shows for an API error. */
function appsMessage(error: ApiErrorBody & { details?: unknown }, details: Record<string, unknown>): string {
  if (error.code === 'transcript_unavailable') {
    if (typeof details.state === 'string') return details.state === 'pending' ? PREPARING : NOT_HERE;
    return error.message === VIDEO_NOT_FOUND ? VIDEO_NOT_FOUND : NO_CAPTION_TRACK;
  }
  if (error.type === 'quota_exceeded') return OUT_OF_CREDITS;
  if (error.code === 'filter_requires_paid' && error.param) return `The ${error.param} filter isn't available here. Search again without it.`;
  if (error.code === 'freshness_requires_paid') {
    const cutoff = day(record(record(error.details)?.limit)?.served_through);
    return cutoff ? `Results here cover videos published up to ${cutoff}. Set after to ${cutoff} or earlier.` : NOT_HERE;
  }
  return planFree(error.message) ?? NOT_HERE;
}

/** The error fields /mcp/apps keeps: no gate, unlock, details or doc link. */
const APPS_ERROR_FIELDS = ['type', 'reason', 'param', 'retry_after_seconds', 'retry_after', 'request_id'] as const;
/** How one detail field reads on /mcp/apps; undefined leaves it out. */
type Shape = (value: unknown) => unknown;
/** An entity's name, or the name a person searched for, is data like a result title and stays as written. */
const name: Shape = (value) => (typeof value === 'string' ? value : undefined);
const flag: Shape = (value) => (typeof value === 'boolean' ? value : undefined);

/** `value` with only `fields`, each in its shape; undefined when none is left. */
function shaped(value: unknown, fields: Readonly<Record<string, Shape>>): Record<string, unknown> | undefined {
  const from = record(value);
  if (!from) return undefined;
  const kept = Object.entries(fields)
    .map(([key, shape]) => [key, shape(from[key])] as const)
    .filter(([, inner]) => inner !== undefined);
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

const rows =
  (fields: Readonly<Record<string, Shape>>): Shape =>
  (value) =>
    Array.isArray(value) ? value.map((row) => shaped(row, fields)).filter((row) => row !== undefined) : undefined;

/** The tool details /mcp/apps keeps beside a refusal, each in the one shape it has. */
const APPS_DETAILS: Readonly<Record<string, Shape>> = {
  call_id: plain,
  reason: plain,
  state: plain,
  languages: rows({ code: plain, name: plain, generated: flag }),
  resolved: rows({ filter: plain, name, matched: name, id: plain, assumed: (value) => (value === true ? true : plain(value)) }),
  options: rows({ id: plain, label: name }),
};

function appsError(error: ApiErrorBody, details: Record<string, unknown> = {}): ApiErrorBody {
  const kept = Object.fromEntries(
    Object.entries(pick(error as unknown as Record<string, unknown>, APPS_ERROR_FIELDS)).filter(([, value]) => typeof value !== 'string' || plain(value)),
  );
  const code = APPS_CODES[error.code] ?? plain(error.code) ?? 'not_available';
  return { ...kept, code, message: appsMessage(error, details) } as ApiErrorBody;
}

/** The search answer's dates, said plainly when the account's results stop before today. */
function datesNote(freshness: unknown, window: unknown, matched: boolean): string | undefined {
  const through = day(record(freshness)?.served_through);
  if (through === undefined) return undefined;
  const after = day(record(window)?.after);
  if (matched) return after ? `These results cover videos published from ${after} to ${through}.` : `These results cover videos published up to ${through}.`;
  return after ? `Nothing matched in videos published from ${after} to ${through}.` : undefined;
}

/** The API's own "No match before <date>." restates the dates note, so it goes when the dates note is there. */
const NO_MATCH_BEFORE = /(?:^|\s)No match before \S+\.(?=\s|$)/;

/** /mcp/apps: fixed sentences for gates, the API's other sentences only when they name no plan or link, and known fields only. */
export const APPS_SURFACE: Surface = {
  transcript: {
    unavailable: NO_CAPTION_TRACK,
    notReady: undefined,
    noPremium: (rest) => rest,
  },
  note: planFree,
  link: watchLink,
  error: (error) => appsError(error),
  known: knownFields,
  refusal(error, details = {}) {
    // A transcript Arcmira holds in some state has no caption track to explain.
    const note = typeof details.state === 'string' ? undefined : planFree(typeof details.note === 'string' ? details.note : undefined);
    return errorResult(appsError(error, details), { ...shaped(details, APPS_DETAILS), ...(note ? { note } : {}) });
  },
  searchMeta({ window, as_of, note, search_index, freshness, matched }) {
    const dates = datesNote(freshness, window, matched);
    return {
      window: knownFields(window, ['after', 'before']),
      as_of,
      note: joined(dates, planFree(dates ? (note ?? '').replace(NO_MATCH_BEFORE, '') : note)) || undefined,
      search_index: knownFields(search_index, ['state', 'missing_before']),
    };
  },
};
