import { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type { ApiClient, ApiErrorBody } from './api.ts';
import { RECENCY, resolvePublishedAfter } from './recency.ts';
import { errorResult, okResult, type ToolResult } from './result.ts';

/** Every tool reads our index and nothing else. The Claude and ChatGPT directories require all four. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const TOOL_NAMES = [
  'search_transcripts',
  'resolve_entities',
  'list_mentions',
  'entity_momentum',
  'list_sponsors',
  'index_status',
  'count_occurrences',
  'get_transcript',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolSpec<Schema extends z.ZodObject<z.ZodRawShape>> {
  readonly name: ToolName;
  /** Loaded context. Verbatim from SPEC-mcp-manifest section 3; revise there first. */
  readonly description: string;
  readonly inputSchema: Schema;
  /** The v1 operationIds this tool is a facade over, checked against the live OpenAPI document. */
  readonly fronts: readonly string[];
  run(input: z.output<Schema>, api: ApiClient): Promise<ToolResult>;
}

export type AnyToolSpec = ToolSpec<z.ZodObject<z.ZodRawShape>>;

function tool<Schema extends z.ZodObject<z.ZodRawShape>>(spec: ToolSpec<Schema>): ToolSpec<Schema> {
  return spec;
}

const UC = z.string().regex(/^UC[A-Za-z0-9_-]{22}$/, 'a YouTube channel id starts with UC and is 24 characters');
const ENT = z.string().regex(/^ent_\d+$/, 'an entity id looks like ent_14');
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'an ISO date, YYYY-MM-DD');
const ENTITY_TYPE = z.enum(['person', 'organization', 'product', 'topic', 'channel']);

const recencyInput = z.enum(RECENCY).optional().describe('Shorthand window resolved on server time: recent is the last 30 days, quarter 90, year 365, all is no filter. Pass recent for newest, latest, recently, or this week. An explicit publishedAfter wins over it.');

function latest(dates: Array<string | null | undefined>): string | null {
  let out: string | null = null;
  for (const date of dates) if (date && (out === null || date > out)) out = date;
  return out;
}

function pick<T extends Record<string, unknown>>(row: T, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) if (row[key] !== undefined) out[key] = row[key];
  return out;
}

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function watchUrl(videoId: unknown, startSeconds: unknown): string | null {
  if (typeof videoId !== 'string' || videoId === '') return null;
  const t = typeof startSeconds === 'number' && startSeconds > 0 ? `&t=${startSeconds}` : '';
  return `https://arcmira.com/watch?v=${videoId}${t}`;
}

const searchTranscripts = tool({
  name: 'search_transcripts',
  description: "Retrieve short spoken slices from indexed YouTube and podcast transcripts that answer one topic or phrase. Use it after you know what to look for: a named entity from `resolve_entities`, a channel id, or a phrase the user gave you. Pass every show in scope in `channelIds` unless drilling into one. One topic per call; do not concatenate unrelated names. Do NOT use it to learn whether a name was ever said (`list_mentions`), how hot something is (`entity_momentum`), what a show talks about (`count_occurrences`), or who sponsors a show (`list_sponsors`); those are catalog tools and are cheaper and exact. For any question with 'newest', 'latest', 'recently', or 'this week', pass `recency` or `publishedAfter`; otherwise results span the whole index. Quote `text` as a spoken beat of a few sentences and cite `watchUrl` with `publishedAt`. An empty `chunks` array means the index has no hit; say so, never search the open web.",
  inputSchema: z.object({
    query: z.string().min(2).describe('One topic or phrase, 2 or more characters. One topic per call.'),
    channelIds: z.array(UC).max(8).optional().describe('YouTube channel ids (UC...) to search, at most 8. Pass every show in scope.'),
    entityIds: z.array(ENT).max(8).optional().describe('Entity ids (ent_...) to scope by, at most 8. A person id filters to that person\'s appearances.'),
    recency: recencyInput,
    publishedAfter: ISO_DATE.optional().describe('ISO date. Only media published on or after this day. Wins over recency.'),
    publishedBefore: ISO_DATE.optional().describe('ISO date. Only media published before this day.'),
    source: z.enum(['arcmira_premium', 'creator_captions', 'third_party_quick']).optional().describe('Restrict to one transcript source class. arcmira_premium needs a plan with Premium transcripts; otherwise the call is refused with filter_requires_paid.'),
    maxResults: z.number().int().min(1).max(20).optional().describe('Chunks to return, 1 to 20. Default 5.'),
  }),
  fronts: ['search_transcripts'],
  async run(input, api) {
    const result = await api.get('/v1/transcripts/search', {
      q: input.query,
      channel_ids: input.channelIds,
      entity_ids: input.entityIds,
      published_after: resolvePublishedAfter(input),
      published_before: input.publishedBefore,
      source: input.source,
      limit: input.maxResults ?? 5,
    });
    return result.ok ? okResult(result.body) : errorResult(result.error);
  },
});

function resolveNote(entities: Row[]): string {
  if (entities.length === 0) return 'No typed match. Try a broader name or a different type. Never guess an id.';
  if (entities.some((row) => row.suggested === true)) {
    return 'A suggested=true row is an exact match with much more traction than the other rows. Use its id, and for a channel its youtube_channel_id, without asking.';
  }
  return 'Return these as options. When a person and a channel both match closely, let the user choose rather than picking yourself.';
}

const resolveEntities = tool({
  name: 'resolve_entities',
  description: 'Turn a name, alias, YouTube URL, `@handle`, or `UC` channel id into typed rows: person, organization, product, topic, channel, each with a stable `ent_` id and, for channels, `youtube_channel_id`. Call this first whenever the user names a show, person, brand, or topic and you do not already hold its id. A row with `suggested: true` is an exact match with far more traction than any other row; use it without asking. When a person and a channel both match closely (a creator who is also a show), return the options to the user instead of choosing. Do not call it again for an id you already hold, and do not use it to search transcripts.',
  inputSchema: z.object({
    q: z.string().min(2).describe('A name, alias, YouTube URL, @handle, or UC channel id. 2 or more characters.'),
    type: ENTITY_TYPE.optional().describe('Restrict to one entity type.'),
    limit: z.number().int().min(1).max(15).optional().describe('Rows to return, 1 to 15. Default 8.'),
  }),
  fronts: ['search_entities'],
  async run(input, api) {
    const result = await api.get('/v1/entities/search', { q: input.q, type: input.type, limit: input.limit ?? 8 });
    if (!result.ok) return errorResult(result.error);
    const entities = rows(result.body.data).map((row) =>
      pick(row, ['id', 'name', 'slug', 'type', 'appearance_count', 'youtube_channel_id', 'suggested']),
    );
    return okResult({ query: input.q, entities, has_more: result.body.has_more === true, note: resolveNote(entities) });
  },
});

const listMentions = tool({
  name: 'list_mentions',
  description: "Catalog rows for 'has X mentioned Y yet', 'first seen', or 'when did they last talk about it'. Exact and cheap: one row per mention with the video, timestamp, and channel, newest first. Call it before `search_transcripts` for any existence question, and search only afterwards if you need the spoken wording of a clip that this tool proved exists. `indexed_through` is the newest media we have for that channel; an empty list means no mention in our index up to that date, not that it never happened. Never fill an empty result from the open web.",
  inputSchema: z.object({
    entityId: ENT.describe('The entity to look for, as ent_... from resolve_entities.'),
    channelId: UC.optional().describe('Restrict to one YouTube channel id (UC...). Also fills indexed_through.'),
    dateFrom: ISO_DATE.optional().describe('ISO date. Only media published on or after this day.'),
    dateTo: ISO_DATE.optional().describe('ISO date. Only media published on or before this day. Walks past the free window, so paid plans only.'),
    limit: z.number().int().min(1).max(25).optional().describe('Rows to return, 1 to 25. Default 10.'),
  }),
  fronts: ['list_mentions', 'get_channel_coverage'],
  async run(input, api) {
    const result = await api.get('/v1/mentions', {
      entity_id: input.entityId,
      channel_id: input.channelId,
      date_from: input.dateFrom,
      date_to: input.dateTo,
      limit: input.limit ?? 10,
    });
    if (!result.ok) return errorResult(result.error);
    const mentions = rows(result.body.data).map((row) => {
      const media = (row.media ?? {}) as Row;
      const source = (media.source_channel ?? null) as Row | null;
      return {
        mention_id: row.id,
        is_appearance: row.is_appearance === true,
        video_id: media.video_id ?? null,
        title: media.title ?? null,
        published_at: media.published_at ?? null,
        channel_id: media.channel_id ?? null,
        channel_name: source?.name ?? null,
        start_seconds: row.start_seconds ?? null,
        watch_url: watchUrl(media.video_id, row.start_seconds),
      };
    });
    let indexedThrough: string | null = null;
    if (input.channelId) {
      const coverage = await api.get(`/v1/channels/${encodeURIComponent(input.channelId)}/coverage`);
      const channel = coverage.ok ? ((coverage.body.channel ?? {}) as Row) : {};
      indexedThrough = typeof channel.indexed_through === 'string' ? channel.indexed_through : null;
    }
    const entity = (result.body.entity ?? {}) as Row;
    return okResult({
      entity: pick(entity, ['id', 'name', 'type']),
      indexed_through: indexedThrough,
      count: mentions.length,
      mentions,
      as_of: latest(mentions.map((row) => (typeof row.published_at === 'string' ? row.published_at : null))),
      note: mentions.length === 0
        ? `No mention in our index${indexedThrough ? ` as of ${indexedThrough}` : ''}. Say so; never fill it from the open web.`
        : 'Catalog hit. Call search_transcripts only if you need the spoken wording of one of these clips.',
    });
  },
});

const entityMomentum = tool({
  name: 'entity_momentum',
  description: "Spoken-web heat for up to four entities: mentions in the last 7 and 30 days versus the prior 30 days, an absolute-delta verdict (`accelerating`, `flat`, `fading`, `none`), the top shows in the window, and on Pro keys the paid-versus-organic split. Call it for 'is X hot', 'momentum', 'trending', 'who is talking about X most'. Lead with the verdict and `as_of`. It measures the shows we index, not the whole internet, and it is a count, not a score; never invent a heat number. Use `search_transcripts` afterwards only for quotes that explain the curve.",
  inputSchema: z.object({
    entityIds: z.array(ENT).min(1).max(4).describe('One to four entity ids (ent_...) from resolve_entities.'),
  }),
  fronts: ['get_entity_momentum'],
  async run(input, api) {
    const cards: Row[] = [];
    const unresolved: string[] = [];
    let note: unknown = null;
    for (const id of [...new Set(input.entityIds)]) {
      const result = await api.get(`/v1/entities/${encodeURIComponent(id)}/momentum`);
      if (result.ok) {
        const { note: cardNote, ...card } = result.body;
        note ??= cardNote;
        cards.push(card);
        continue;
      }
      if (result.error.code === 'entity_not_found') {
        unresolved.push(id);
        continue;
      }
      return errorResult(result.error);
    }
    if (cards.length === 0) {
      return errorResult(localError('not_found', 'entity_not_found', `No indexed entity for ${unresolved.join(', ')}. Call resolve_entities first.`));
    }
    return okResult({
      cards,
      unresolved,
      note: typeof note === 'string' ? note : 'Lead with verdict and as_of. Never invent a heat score.',
    });
  },
});

const listSponsors = tool({
  name: 'list_sponsors',
  description: "Recurring sponsors of a YouTube channel from our ad-read rollup, ordered by ad-read count. Call it for 'who sponsors X', 'advertisers on X', 'is brand Y a sponsor of X'. Pass a `UC` channel id from `resolve_entities`, not a handle. Free and trial keys receive the free slice the website shows (the top sponsors plus the total count); the full list, status filters, and lower thresholds need a Pro plan and the tool tells you so with an unlock link. Never assemble a sponsor list from transcript search; if this tool is gated or empty, say that.",
  inputSchema: z.object({
    youtubeChannelId: UC.describe('The YouTube channel id (UC...), from resolve_entities. Not a handle.'),
    minAdReads: z.number().int().min(1).max(100).optional().describe('Exclude sponsors with fewer ad reads. Default 3. Pro plans only.'),
    status: z.enum(['active', 'lapsed', 'ended', 'uncertain']).optional().describe('Filter by curated sponsorship status. Pro plans only.'),
    limit: z.number().int().min(1).max(200).optional().describe('Sponsors to return. Pro plans only past the free slice.'),
  }),
  fronts: ['list_channel_sponsors'],
  async run(input, api) {
    const result = await api.get(`/v1/channels/${encodeURIComponent(input.youtubeChannelId)}/sponsors`, {
      min_ad_reads: input.minAdReads,
      status: input.status,
      limit: input.limit,
    });
    if (!result.ok) return errorResult(result.error);
    const sponsors = rows(result.body.sponsors);
    const meta = (result.body.meta ?? {}) as Row;
    const total = typeof meta.total === 'number' ? meta.total : sponsors.length;
    return okResult({
      ...result.body,
      as_of: latest(sponsors.map((row) => (typeof row.last_seen === 'string' ? row.last_seen : null))),
      note: total === 0
        ? 'No recurring sponsors for this channel in our rollup. Do not invent names from transcript search.'
        : result.body.access
          ? 'This is the free slice; meta.total is the true count and access names the plan that lifts the gate. Say so rather than listing more names.'
          : 'Structured rollup. Optionally search_transcripts for a recent host-read clip of the top sponsor.',
    });
  },
});

const indexStatus = tool({
  name: 'index_status',
  description: "What we have for a channel, or the state of one transcription job. For a `UC` channel id it returns how many videos are searchable and the newest indexed publish date, so you can say 'as of' honestly or explain an empty search. For a transcription `jobId` (account keys only) it returns the pipeline status and when to poll again. Call it when a search or mention lookup came back empty, before telling the user we do not cover something. It cannot request indexing; say that channel backfill is not available yet rather than promising it.",
  inputSchema: z.object({
    youtubeChannelId: UC.optional().describe('A YouTube channel id (UC...) to report coverage for.'),
    jobId: z.string().uuid().optional().describe('A transcription job id from an account key\'s own submissions.'),
  }).refine((value) => value.youtubeChannelId !== undefined || value.jobId !== undefined, {
    message: 'Pass youtubeChannelId or jobId.',
  }),
  fronts: ['get_channel_coverage', 'get_transcription'],
  async run(input, api) {
    const body: Row = {};
    if (typeof input.youtubeChannelId === 'string') {
      const coverage = await api.get(`/v1/channels/${encodeURIComponent(input.youtubeChannelId)}/coverage`);
      if (!coverage.ok) return errorResult(coverage.error);
      body.channel = coverage.body.channel;
      body.note = coverage.body.note;
    }
    if (typeof input.jobId === 'string') {
      const job = await api.get(`/v1/transcriptions/${encodeURIComponent(input.jobId)}`);
      if (!job.ok) return errorResult(job.error);
      body.transcription = pick(job.body, ['id', 'status', 'stage', 'video_id', 'videoId', 'etaSeconds', 'nextPollSeconds']);
      body.note ??= 'Poll again after nextPollSeconds. Channel backfill is not available yet.';
    }
    return okResult(body);
  },
});

const countOccurrences = tool({
  name: 'count_occurrences',
  description: "Catalog counts of which entities a set of channels mention or host, as a small ranked table. Call it for 'what do they talk about', 'hottest topics on X', 'how often does X mention Y', or 'which brands appear on both X and Y'. Match `entityTypes` to the question: subjects and topics `[\"topic\"]`, guests `[\"person\"]`, brands `[\"organization\",\"product\"]`; omit it and organizations dominate. Passing two or more `channelIds` also returns `shared`, the entities on more than one of those channels ranked by the smallest per-channel count, which is true overlap. Counts are all-time unless you pass `publishedAfter` or `recency`. Do not use it for quotes (`search_transcripts`), a single yes-or-no existence check (`list_mentions`), or heat versus a prior window (`entity_momentum`).",
  inputSchema: z.object({
    channelIds: z.array(UC).max(8).optional().describe('YouTube channel ids (UC...) to count over, at most 8. Two or more also return shared.'),
    entityIds: z.array(ENT).max(20).optional().describe('Entity ids (ent_...) to count, at most 20.'),
    entityTypes: z.array(ENTITY_TYPE).optional().describe('Entity types to count. topic for subjects, person for guests, organization and product for brands.'),
    mode: z.enum(['mentions', 'appearances', 'both']).optional().describe('mentions counts talk about an entity, appearances counts a person being present, both counts either. Default mentions.'),
    recency: recencyInput,
    publishedAfter: ISO_DATE.optional().describe('ISO date. Only media published on or after this day. Wins over recency.'),
    publishedBefore: ISO_DATE.optional().describe('ISO date. Only media published before this day.'),
    limit: z.number().int().min(1).max(40).optional().describe('Rows in the ranked table, 1 to 40. Default 20.'),
  }).refine((value) => (value.channelIds?.length ?? 0) > 0 || (value.entityIds?.length ?? 0) > 0, {
    message: 'Pass channelIds or entityIds.',
  }),
  fronts: ['count_mentions'],
  async run(input, api) {
    const result = await api.get('/v1/mentions/counts', {
      channel_ids: input.channelIds,
      entity_ids: input.entityIds,
      entity_types: input.entityTypes,
      mode: input.mode,
      published_after: resolvePublishedAfter(input),
      published_before: input.publishedBefore,
      limit: input.limit ?? 20,
    });
    return result.ok ? okResult(result.body) : errorResult(result.error);
  },
});

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const VIDEO_URL_FORMS: readonly RegExp[] = [
  /youtube\.com\/[^#]*[?&]v=([^&#]+)/i,
  /youtu\.be\/([^/?#]+)/i,
  /youtube\.com\/(?:shorts|live|embed|v)\/([^/?#]+)/i,
];

export function extractVideoId(video: string): string | null {
  if (VIDEO_ID.test(video)) return video;
  for (const form of VIDEO_URL_FORMS) {
    const candidate = form.exec(video)?.[1];
    if (candidate !== undefined && VIDEO_ID.test(candidate)) return candidate;
  }
  return null;
}

function withWatchUrl(body: Record<string, unknown>, id: string): Record<string, unknown> {
  const video = body.video;
  if (typeof video !== 'object' || video === null) return body;
  const row = video as Row;
  if (row.watch_url !== undefined) return body;
  return { ...body, video: { ...row, watch_url: watchUrl(row.id ?? id, null) } };
}

function errorWithLanguages(error: ApiErrorBody, languages: unknown[]): ToolResult {
  const body = { error, languages };
  return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body, isError: true };
}

const getTranscript = tool({
  name: 'get_transcript',
  description: "Full transcript of one YouTube video from its URL or 11-character id, with `start` seconds on every line. Call it when the user names a specific video or pastes a link, or when a search hit needs its surrounding context; not for finding videos (`resolve_entities`, `search_transcripts`). The default is the video's own captions, creator-written when they exist and YouTube's auto captions otherwise, returned from our cache when we have it and fetched from YouTube when we do not, costing one row per fifteen minutes of video. Pass `language` as a priority list like `de,en` to pick a caption track; `languages` in the result says which tracks exist. `quality: premium` returns Arcmira's own transcript: every line carries `speaker`, because Premium always diarizes and we identify each speaker from the audio, the video, and internal and community review, which is right most of the time and wrong sometimes; say so when a name matters. Premium needs a paid plan and bills more rows; the tool tells you the plan and the row count with an unlock link before spending anything. `timestamps: false` returns the text as paragraphs when you only need to read. Never quote a transcript back in full; quote the lines that answer, with their `start` and the `watchUrl`.",
  inputSchema: z.object({
    video: z.string()
      .describe('One YouTube video: a watch URL, a youtu.be link, a /shorts/, /live/, or /embed/ URL, or a bare 11-character id.')
      .refine((value) => extractVideoId(value) !== null, {
        message: 'Pass a watch URL with v=, a youtu.be link, a /shorts/, /live/, or /embed/ URL, or a bare 11-character video id.',
      }),
    quality: z.enum(['captions', 'premium']).optional().describe('captions is the default and reads the video\'s own caption track. premium is Arcmira\'s own diarized transcript; it needs a paid plan and bills more rows. The account setting transcripts.quality overrides the default.'),
    language: z.string().optional().describe('A comma-separated priority list of caption language codes, like de,en. Use asr for any auto-generated track and asr-<code> for a specific auto track. Defaults to the account setting, then en, then the video\'s first track.'),
    timestamps: z.boolean().optional().describe('Default true, which returns lines each carrying start seconds. false returns paragraphs for reading.'),
    range: z.object({
      start: z.number().min(0).describe('Window start in seconds from the beginning of the video. Non-negative.'),
      end: z.number().min(0).describe('Window end in seconds. Non-negative and greater than start.'),
    }).refine((value) => value.end > value.start, { message: 'range.end must be greater than range.start.' })
      .optional()
      .describe('Return only this window of the video and bill only its minutes.'),
  }),
  fronts: ['get_transcript', 'get_video_captions'],
  async run(input, api) {
    const id = extractVideoId(input.video);
    if (id === null) {
      return errorResult(localError('invalid_request_error', 'invalid_video_id', 'No video id in that value. Pass a watch URL with v=, a youtu.be link, a /shorts/, /live/, or /embed/ URL, or a bare 11-character id.'));
    }
    const result = await api.get(`/v1/transcripts/${encodeURIComponent(id)}`, {
      format: 'v2',
      quality: input.quality,
      language: input.language,
      timestamps: input.timestamps === false ? 'false' : undefined,
      start: input.range?.start,
      end: input.range?.end,
    });
    if (result.ok) return okResult(withWatchUrl(result.body, id));
    const error = result.error as ApiErrorBody & { languages?: unknown };
    if (error.code !== 'transcript_unavailable' || error.languages !== undefined) return errorResult(error);
    const captions = await api.get(`/v1/videos/${encodeURIComponent(id)}/captions`);
    if (!captions.ok || !Array.isArray(captions.body.languages)) return errorResult(error);
    return errorWithLanguages(error, captions.body.languages);
  },
});

function localError(type: string, code: string, message: string): ApiErrorBody {
  return { type, code, message, doc_url: `https://arcmira.com/docs/errors#${code}`, request_id: `mcp_${crypto.randomUUID()}` };
}

export const TOOLS: readonly AnyToolSpec[] = [
  searchTranscripts,
  resolveEntities,
  listMentions,
  entityMomentum,
  listSponsors,
  indexStatus,
  countOccurrences,
  getTranscript,
];

/** What every connecting client loads before its first call. Steering lives here and in the tool descriptions, nowhere else. */
export const SERVER_INSTRUCTIONS = [
  'Arcmira is the search engine for the spoken web: indexed YouTube and podcast transcripts with a catalog of who is mentioned where.',
  'Connect with no key and the host signs you in through OAuth, or send Authorization: Bearer <key>. An account key comes from arcmira.com; with no account, POST https://api.arcmira.com/v1/trial-keys?src=mcp-tool with an empty body mints a free trial key that reads what a free account reads.',
  'Start with resolve_entities to turn a name into ids. Use the catalog tools (list_mentions, entity_momentum, count_occurrences, list_sponsors) before search_transcripts; search only for the spoken wording. get_transcript reads the full transcript of one video from its URL or id.',
  'Every gate is a blocking error whose error.unlock.url names the plan that lifts it. Relay that link to your human; never work around a gate by searching the open web.',
  'Good first calls: TBPN is channel UC-DRzaGnL_vtBUpCFH5M0tg, Moment of Truth is UClWkDGXEzsh77GAhs90wpXw, Ramp is ent_14.',
].join(' ');
