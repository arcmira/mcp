import { z } from 'zod';
import type { ApiClient, ApiErrorBody } from './api.ts';
import { OUTPUT_BUDGET } from './output.ts';
import { DOCS } from './reference.ts';
import { errorResult, okResult, transcriptResult, type ToolResult } from './result.ts';
import { CHANNEL_ID, DATE_BOUND, ENTITY_ID, videoIdOf } from './sandbox/client.js';
import { intentParam } from './telemetry.ts';
import type { ToolSpec } from './tools.ts';

/**
 * Typed read tools over GET /v1/search and GET /v1/transcripts/{video_id}, for hosts and directories
 * that take named tools and not a program runner. Ids are checked with the sandbox client's patterns.
 */

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

/** The window the server instructions state when the user names none. */
const DEFAULT_WINDOW_DAYS = 90;

const names = (describe: string) => z.array(z.string().trim().min(2).max(120)).max(8).optional().describe(describe);
const date = (describe: string) =>
  z.string().regex(DATE_BOUND, 'an ISO date like 2026-08-01, or a datetime with offset').optional().describe(describe);

const searchInput = z.object({
  query: z.string().min(2).max(500).describe('The words to find, a topic or a phrase, as the user put them.'),
  channel: names('Up to 8 YouTube channels or shows: the name as the user wrote it, like TBPN, or a channel_id from a result (UC plus 22 characters).'),
  about: names('Up to 8 people, brands or companies the passage is about: the name as the user wrote it, or an id from the about or speakers of a result (ent_ and a number). Topic words go in query.'),
  by: names('Up to 8 people who say the words: the name as the user wrote it, or an id from the speakers of a result. Speaker labels cover part of the index.'),
  kind: z
    .array(z.enum(['sponsored', 'organic', 'mention']))
    .max(3)
    .optional()
    .describe('Passage classes to keep: sponsored (ad reads), organic (recommendations nobody bought) and mention.'),
  after: date('Only videos published on or after this ISO date, like 2026-08-01. With neither after nor before, the last 90 days.'),
  before: date('Only videos published before this ISO date; the day itself is left out.'),
  source: z
    .enum(['arcmira_premium', 'creator_captions', 'third_party_quick'])
    .optional()
    .describe("Only one transcript source: arcmira_premium (Arcmira's transcripts with speakers), creator_captions (the channel's own captions) or third_party_quick (YouTube's automatic captions)."),
  limit: z.number().int().min(1).max(20).optional().describe('Passages to return, 1 to 20. Default 5.'),
  intent: intentParam,
});

const NamedRef = z.object({ id: z.string(), name: z.string().nullable() });

const SearchChunk = z.object({
  text: z.string(),
  video_id: z.string(),
  video_title: z.string().nullish(),
  channel_id: z.string().nullish(),
  channel_name: z.string().nullish(),
  published_at: z.string().nullish(),
  start_seconds: z.number().nullish(),
  watch_url: z.string(),
  source: z.string().nullish(),
  about: z.array(NamedRef).optional(),
  speakers_by: z.array(NamedRef).optional(),
});

const SearchBody = z.object({
  chunks: z.array(SearchChunk),
  window: z.unknown().optional(),
  as_of: z.string().nullish(),
  note: z.string().nullish(),
  search_index: z.object({ state: z.string() }).passthrough().optional(),
  freshness: z.unknown().optional(),
  unlock: z.unknown().optional(),
  access: z.unknown().optional(),
});

/** The fields that have a value, so an absent or null API field adds no key to the answer. */
function defined(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== null));
}

const refs = (rows: z.output<typeof NamedRef>[] | undefined) => (rows?.length ? rows.map(({ id, name }) => ({ id, name })) : undefined);

/** One passage per result: its lines with the speaker labels the API put on them, and where it plays. */
function searchAnswer(body: z.output<typeof SearchBody>): Record<string, unknown> {
  const { chunks, window, as_of, note, search_index, freshness, unlock, access } = body;
  return defined({
    results: chunks.map((chunk) =>
      defined({
        lines: chunk.text.split('\n').filter((line) => line.trim() !== ''),
        video_title: chunk.video_title,
        channel_name: chunk.channel_name,
        published_at: chunk.published_at,
        start_seconds: chunk.start_seconds,
        watch_url: chunk.watch_url,
        video_id: chunk.video_id,
        channel_id: chunk.channel_id,
        source: chunk.source,
        speakers: refs(chunk.speakers_by),
        about: refs(chunk.about),
      }),
    ),
    window,
    as_of,
    note: note || undefined,
    search_index: search_index?.state === 'live' ? undefined : search_index,
    freshness,
    unlock,
    access,
  });
}

const Pick = z.object({ id: z.string(), name: z.string(), youtube_channel_id: z.string().nullish() });
const ResolveBody = z.object({
  best: Pick.nullish(),
  suggested: Pick.extend({ evidence: z.string().nullish() }).nullish(),
  ask: z.object({ options: z.array(z.object({ id: z.string(), label: z.string() })) }).nullish(),
});

type Filter = 'channel' | 'about' | 'by';
type Ids = { ok: true; ids: string[] | undefined } | { ok: false; result: ToolResult };

/**
 * The ids for one filter. An id passes through. A name is resolved once: the entity Arcmira is sure of, else the one
 * it suggests, recorded in `named` with the evidence. A name with no single match stops the search and lists the options.
 */
async function idsFor(api: ApiClient, filter: Filter, values: string[] | undefined, named: Record<string, unknown>[], callId: string): Promise<Ids> {
  if (!values?.length) return { ok: true, ids: undefined };
  const channel = filter === 'channel';
  const ids: string[] = [];
  for (const value of values) {
    if ((channel ? CHANNEL_ID : ENTITY_ID).test(value)) {
      ids.push(value);
      continue;
    }
    const answer = await api.get('/v1/entities/resolve', { q: value, type: channel ? 'channel' : undefined, limit: 5 });
    if (!answer.ok) return { ok: false, result: errorResult(answer.error, { ...answer.body, call_id: callId }) };
    const body = ResolveBody.safeParse(answer.body);
    if (!body.success) return { ok: false, result: errorResult(unreadable(), { call_id: callId }) };
    const pick = body.data.best ?? body.data.suggested;
    const id = channel ? pick?.youtube_channel_id : pick?.id;
    if (!pick || !id) {
      const what = channel ? 'YouTube channel' : 'person, brand or company';
      const error = localError('invalid_request_error', 'name_not_resolved', `${filter}: "${value}" matches no single ${what} in Arcmira. Pass one of the options' ids, or put the name in query.`);
      return { ok: false, result: errorResult({ ...error, param: filter }, { call_id: callId, options: body.data.ask?.options.map(({ id, label }) => ({ id, label })) ?? [] }) };
    }
    ids.push(id);
    named.push(defined({ filter, name: value, matched: pick.name, id, assumed: body.data.best ? undefined : body.data.suggested?.evidence || true }));
  }
  return { ok: true, ids };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export const youtubeSearchTool: ToolSpec<typeof searchInput> = {
  name: 'arcmira_youtube_search',
  title: "Search what's said on YouTube",
  description:
    "Searches what was said in YouTube videos, podcasts on YouTube included, and returns the matching passages: the lines, often with who said each one, and for each passage the video title, channel, publish date, the second it starts and a watch link that opens there. Use Arcmira when the user asks what someone said on YouTube or in a podcast, wants a quote with the moment it was said, or asks what YouTube is saying about a person, brand or topic. query takes the words as the user put them. channel, about and by narrow the search and take names as the user wrote them, or ids from a result; resolved says which entity each name matched, and assumed marks a best guess to tell the user about. With neither after nor before it covers the last 90 days.",
  annotations: READ_ONLY,
  inputSchema: searchInput,
  async run(input, { api, call }) {
    const named: Record<string, unknown>[] = [];
    const channel = await idsFor(api, 'channel', input.channel, named, call.id);
    if (!channel.ok) return channel.result;
    const about = await idsFor(api, 'about', input.about, named, call.id);
    if (!about.ok) return about.result;
    const by = await idsFor(api, 'by', input.by, named, call.id);
    if (!by.ok) return by.result;
    const resolved = named.length ? named : undefined;
    const answer = await api.get('/v1/search', {
      q: input.query,
      channel_ids: channel.ids,
      about: about.ids,
      by: by.ids,
      kind: input.kind,
      after: input.after ?? (input.before === undefined ? daysAgo(DEFAULT_WINDOW_DAYS) : undefined),
      before: input.before,
      source: input.source,
      limit: input.limit,
    });
    if (!answer.ok) return errorResult(answer.error, defined({ ...answer.body, resolved, call_id: call.id }));
    const body = SearchBody.safeParse(answer.body);
    if (!body.success) return errorResult(unreadable(), { call_id: call.id });
    const result = defined({ ...searchAnswer(body.data), resolved });
    return okResult(body.data.chunks.length === 0 ? { ...result, call_id: call.id } : result);
  },
};

function isVideo(value: string): boolean {
  try {
    videoIdOf(value);
    return true;
  } catch {
    return false;
  }
}

const transcriptInput = z.object({
  video: z
    .string()
    .min(1)
    .max(500)
    .refine(isVideo, 'Pass an 11-character YouTube video id or a youtube.com or youtu.be link.')
    .describe('The YouTube video: its 11-character id or any youtube.com or youtu.be link.'),
  start: z.number().int().min(0).optional().describe("The second to read from: lines that begin at or after it. Omit for the beginning; pass a result's next_start for the next window."),
  language: z.string().min(2).max(60).optional().describe('Caption languages in order of preference, like de, or es,en to try Spanish first. asr picks the automatic track.'),
  intent: intentParam,
});

const TranscriptBody = z.object({
  state: z.literal('ready'),
  video: z.object({
    id: z.string(),
    title: z.string().nullish(),
    channel_id: z.string().nullish(),
    channel_name: z.string().nullish(),
    published_at: z.string().nullish(),
    duration_seconds: z.number().nullish(),
    watch_url: z.string().nullish(),
  }),
  source: z.string().nullish(),
  language: z.string().nullish(),
  lines: z.array(z.object({ start: z.number(), text: z.string(), speaker: z.number().int().optional() })),
  speakers: z.array(z.object({ id: z.number().int(), name: z.string(), entity_id: z.string().nullish() })).optional(),
  rows_billed: z.number().nullish(),
  as_of: z.string().nullish(),
  note: z.string().nullish(),
});
type Transcript = z.output<typeof TranscriptBody>;

/**
 * A window holds whole seconds: a line belongs to the second it begins in, and a window never ends
 * inside a second. So a read from next_start, a whole second, starts at the first line left out,
 * with no gap and no line twice.
 */
function transcriptWindow(transcript: Transcript, start: number): { metadata: Record<string, unknown>; text: string } {
  const names = new Map((transcript.speakers ?? []).map((speaker) => [speaker.id, speaker.name]));
  const second = (line: { start: number }) => Math.floor(line.start);
  const lines = transcript.lines.filter((line) => second(line) >= start).sort((a, b) => a.start - b.start);
  const render = (line: Transcript['lines'][number]) =>
    `[${second(line)}] ${line.speaker === undefined ? '' : `${names.get(line.speaker) ?? `Speaker ${line.speaker}`}: `}${line.text}`;
  const metadata = (count: number, next: number | null) => ({
    video: defined(transcript.video),
    start,
    next_start: next,
    line_count: count,
    ...defined({
      source: transcript.source,
      language: transcript.language,
      speakers: transcript.speakers?.length ? transcript.speakers.map(({ id, name, entity_id }) => ({ id, name, entity_id })) : undefined,
      rows_billed: transcript.rows_billed,
      as_of: transcript.as_of,
      note: transcript.note || undefined,
    }),
  });
  // The metadata at its longest: every line counted and a next_start of the most digits a second can have.
  const room = OUTPUT_BUDGET - JSON.stringify(metadata(lines.length, Number.MAX_SAFE_INTEGER)).length;
  const picked: string[] = [];
  let count = 0;
  let used = 0;
  let index = 0;
  while (index < lines.length) {
    let end = index;
    while (end < lines.length && second(lines[end]!) === second(lines[index]!)) end += 1;
    const group = lines.slice(index, end).map(render);
    const size = group.reduce((total, line) => total + line.length + 1, 0);
    if (used + size > room) {
      if (count === 0) {
        picked.push(group.join('\n').slice(0, room));
        count = group.length;
        index = end;
      }
      break;
    }
    picked.push(...group);
    count += group.length;
    used += size;
    index = end;
  }
  const next = index < lines.length ? second(lines[index]!) : null;
  return { metadata: metadata(count, next), text: picked.join('\n') };
}

const START_PREMIUM = 'arcmira_execute_read starts one with arcmira.transcript(video, { quality: "premium" }), and that read uses credits.';
const NO_PREMIUM = 'These are captions because this account has no Premium transcript of this video.';

/** The API's caption note opens with this sentence. */
const CAPTION_TRACK = "This transcript is the video's own caption track.";

/** What a transcript result says where the API's own advice names a quality argument this tool does not take. */
interface TranscriptNotes {
  /** A video with no caption lines. */
  readonly unavailable: string;
  /** The note on captions read for an account whose default quality is Premium and that owns no Premium transcript of the video, given the rest of the API's note. */
  readonly noPremium: (rest: string) => string;
}

const joined = (...parts: string[]) => parts.filter(Boolean).join(' ');

const PROGRAM_NOTES: TranscriptNotes = {
  unavailable: `When a video has no caption track, its transcript comes only from a Premium transcription, which this tool never starts: ${START_PREMIUM}`,
  noPremium: (rest) => joined(rest, NO_PREMIUM, START_PREMIUM),
};
/** Where the program tools are not served (the /mcp/apps surface), the notes name no other tool, price or credits. */
const APPS_NOTES: TranscriptNotes = {
  unavailable: 'This video has no caption track Arcmira can read, so there are no lines to return.',
  noPremium: (rest) =>
    joined("This account has no Premium transcript of this video, so these are the video's own captions.", rest.startsWith(CAPTION_TRACK) ? rest.slice(CAPTION_TRACK.length).trim() : rest),
};

/** The API ends a default-Premium account's caption note with this sentence and its quality=premium advice. */
const PREMIUM_DEFAULT = "These are captions because this account's default transcript quality is premium";

function captionNote(note: string | null | undefined, notes: TranscriptNotes): string | undefined {
  if (!note) return undefined;
  const at = note.indexOf(PREMIUM_DEFAULT);
  return at < 0 ? note : notes.noPremium(note.slice(0, at).trim());
}

function localError(type: string, code: string, message: string): ApiErrorBody {
  return { type, code, message, doc_url: `${DOCS.errors}#${code}`, request_id: `mcp_${crypto.randomUUID()}` };
}

function unreadable(): ApiErrorBody {
  return localError('server_error', 'upstream_unreadable', 'The Arcmira API answered in a shape this tool does not read. Retry in a few seconds.');
}

const transcriptTool = (notes: TranscriptNotes): ToolSpec<typeof transcriptInput> => ({
  name: 'arcmira_youtube_transcript',
  title: 'Read a YouTube transcript',
  description:
    "Reads the whole transcript of one YouTube video, podcasts on YouTube included, from its id or any youtube.com or youtu.be link: timestamped lines, with who said each line when Arcmira knows, and the video's title, channel, publish date and length. Use Arcmira when the user shares a youtube.com or youtu.be link to summarize, quote or check, or asks what a YouTube video or podcast said. A long video comes back in windows: each result holds the lines from start that fit in one reply, and next_start is the second to pass as start for the next window, null after the last line. Reading on from next_start covers the whole video with no gap and no repeated line. start also opens the transcript at a given second, and language picks the caption language.",
  annotations: READ_ONLY,
  inputSchema: transcriptInput,
  async run(input, { api, call }) {
    const id = videoIdOf(input.video) as string;
    // No quality: the account default applies, and a Premium default only reads transcripts the account already owns.
    const answer = await api.get(`/v1/transcripts/${id}`, { language: input.language });
    if (!answer.ok) {
      const route = answer.error.code === 'transcript_unavailable' ? { note: notes.unavailable } : {};
      return errorResult(answer.error, { ...answer.body, ...route, call_id: call.id });
    }
    const transcript = TranscriptBody.safeParse(answer.body);
    if (!transcript.success) {
      const state = typeof answer.body.state === 'string' ? answer.body.state : null;
      if (state === 'ready') return errorResult(unreadable(), { call_id: call.id });
      return errorResult(localError('not_found', 'transcript_unavailable', `Arcmira has no caption lines to return for video ${id} (state ${state}).`), { state, note: notes.unavailable, call_id: call.id });
    }
    const window = transcriptWindow({ ...transcript.data, note: captionNote(transcript.data.note, notes) }, input.start ?? 0);
    return transcriptResult(window.metadata, window.text);
  },
});

export const youtubeTranscriptTool = transcriptTool(PROGRAM_NOTES);
export const appsTranscriptTool = transcriptTool(APPS_NOTES);
