/**
 * The arcmira client a program sees inside the execute sandbox. Plain JavaScript because the
 * dynamic Worker loads it as source text; the parent bundles this file as a Text module.
 * Methods mirror the arcmira CLI commands. Every filter takes verbatim ids; a name where an id
 * belongs throws id_required before any network call. fetch() inside the sandbox reaches only the
 * Arcmira API, through the parent's outbound proxy, which adds the caller's credential.
 */

export const ENTITY_ID = /^ent_\d+$/;
export const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export class ArcmiraError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = 'ArcmiraError';
    this.code = code;
    Object.assign(this, extra);
  }
}

function needEntityId(value, param) {
  if (typeof value !== 'string' || !ENTITY_ID.test(value)) {
    throw new ArcmiraError(
      `${param} takes a verbatim entity id like ent_14, got ${JSON.stringify(value)}. Call arcmira.resolve("<name>") first, check that .best (or the .candidates row you pick) is the thing the user meant, then pass its .id.`,
      'id_required',
    );
  }
  return value;
}

function needChannelId(value, param) {
  if (typeof value !== 'string' || !CHANNEL_ID.test(value)) {
    throw new ArcmiraError(
      `${param} takes a verbatim YouTube channel id (UC plus 22 characters), got ${JSON.stringify(value)}. Call arcmira.resolve("<show name>", { type: "channel" }) first and pass .best.youtube_channel_id.`,
      'id_required',
    );
  }
  return value;
}

export function videoIdOf(input) {
  if (typeof input === 'string' && VIDEO_ID.test(input)) return input;
  try {
    const url = new URL(input);
    const v = url.searchParams.get('v');
    if (v && VIDEO_ID.test(v)) return v;
    const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
    if (VIDEO_ID.test(last)) return last;
  } catch {}
  throw new ArcmiraError(`${JSON.stringify(input)} is not a YouTube video id or URL. Pass the 11-character id or the watch URL; arcmira.episodes(channelId) lists video_id per episode.`, 'invalid_video');
}

function list(values, check, param, max) {
  if (values === undefined || values === null) return undefined;
  const arr = Array.isArray(values) ? values : [values];
  if (arr.length > max) throw new ArcmiraError(`${param} takes at most ${max} ids; split the call.`, 'too_many');
  return arr.map((v) => check(v, param)).join(',');
}

function isoDay(value, param) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    throw new ArcmiraError(`${param} takes an ISO date like 2026-08-01; use arcmira.today() or arcmira.daysAgo(n).`, 'invalid_date');
  }
  return value.slice(0, 10);
}

const KINDS = { sponsored: 'ad_read', organic: 'endorsement', all: 'all' };
const SEARCH_KINDS = new Set(['mention', 'recommendation_sponsored', 'recommendation_organic']);

/** Picks the one row a name means, the way the CLI does: a suggested row, else the single exact name match. */
export function pickResolved(query, rows) {
  const wanted = query.replace(/^@/, '').trim().toLowerCase();
  const exact = rows.filter((row) => String(row.name).toLowerCase() === wanted);
  const suggested = rows.find((row) => row.suggested === true);
  if (suggested) return { best: suggested, confidence: 'exact' };
  if (exact.length === 1) return { best: exact[0], confidence: 'exact' };
  if (exact.length > 1) return { best: null, confidence: 'ambiguous' };
  if (rows.length === 1) return { best: rows[0], confidence: 'single_fuzzy' };
  return { best: null, confidence: rows.length === 0 ? 'none' : 'fuzzy' };
}

/**
 * @param {{ base: string, fetch?: typeof fetch, maxCalls?: number, now?: () => Date, onCall?: (call: object) => void }} options
 */
export function createArcmira({ base, fetch: doFetch = globalThis.fetch, maxCalls = 40, now = () => new Date(), onCall }) {
  const root = base.replace(/\/$/, '');
  const meter = { calls: 0, rate_limit: null, api_build: null };

  async function get(path, query = {}) {
    if (meter.calls >= maxCalls) {
      throw new ArcmiraError(`This program made ${maxCalls} API calls, the cap for one execute. Narrow the query (fewer names, a tighter window) or split the work across programs.`, 'call_budget');
    }
    meter.calls += 1;
    const url = new URL(root + path);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
    const started = Date.now();
    const res = await doFetch(url.toString(), { headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    const limit = Number(res.headers.get('ratelimit-limit'));
    const remaining = Number(res.headers.get('ratelimit-remaining'));
    const reset = Number(res.headers.get('ratelimit-reset'));
    if (Number.isFinite(limit) && Number.isFinite(remaining) && Number.isFinite(reset) && res.headers.get('ratelimit-limit') !== null) {
      meter.rate_limit = { limit, remaining, reset };
    }
    meter.api_build = res.headers.get('x-arcmira-build') ?? meter.api_build;
    onCall?.({ path, query, status: res.status, ms: Date.now() - started });
    if (res.ok && body) return body;
    const err = body?.error ?? {};
    throw new ArcmiraError(err.message ?? `HTTP ${res.status}`, err.code ?? 'http_error', {
      status: res.status,
      unlock: err.unlock,
      gate: err.gate,
      param: err.param,
      retry_after_seconds: err.retry_after_seconds,
      doc_url: err.doc_url,
      request_id: err.request_id,
    });
  }

  const arcmira = {
    today() {
      return now().toISOString().slice(0, 10);
    },
    daysAgo(n) {
      if (!Number.isFinite(n) || n < 0) throw new ArcmiraError('daysAgo takes a non-negative number of days', 'invalid_date');
      return new Date(now().getTime() - n * 86_400_000).toISOString().slice(0, 10);
    },
    async resolve(q, { type, limit = 8 } = {}) {
      if (typeof q !== 'string' || q.trim().length < 2) throw new ArcmiraError('resolve needs a name of 2 or more characters', 'invalid_name');
      const body = await get('/v1/entities/search', { q, type, limit });
      const candidates = (body.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        appearance_count: row.appearance_count,
        youtube_channel_id: row.youtube_channel_id ?? null,
        page: row.page ?? null,
        suggested: row.suggested === true,
      }));
      const { best, confidence } = pickResolved(q, candidates);
      const note = best
        ? `best is the ${confidence} match. Check its type and name against what the user meant before filtering on it.`
        : confidence === 'none'
          ? 'No match. Try another spelling or type; never invent an id.'
          : "No single match. Pick the candidates row that matches the user's meaning by type and name, or ask the user.";
      return { query: q, confidence, best, candidates, note };
    },
    async search({ query, channelIds, entityIds, speakerIds, kind, after, before, source, limit = 5 } = {}) {
      if (typeof query !== 'string' || query.length < 2) throw new ArcmiraError('search needs query, a topic or phrase of 2 or more characters', 'invalid_query');
      if (kind !== undefined && !SEARCH_KINDS.has(kind)) throw new ArcmiraError('kind is mention, recommendation_sponsored or recommendation_organic', 'invalid_kind');
      return get('/v1/transcripts/search', {
        q: query,
        channel_ids: list(channelIds, needChannelId, 'channelIds', 8),
        entity_ids: list(entityIds, needEntityId, 'entityIds', 8),
        by: list(speakerIds, needEntityId, 'speakerIds', 8),
        kind,
        published_after: isoDay(after, 'after'),
        published_before: isoDay(before, 'before'),
        source,
        limit,
      });
    },
    async mentions({ entityId, channelId, after, before, limit = 10, cursor } = {}) {
      return get('/v1/mentions', {
        entity_id: needEntityId(entityId, 'entityId'),
        channel_id: channelId === undefined ? undefined : needChannelId(channelId, 'channelId'),
        date_from: isoDay(after, 'after'),
        date_to: isoDay(before, 'before'),
        limit,
        cursor,
      });
    },
    async momentum(entityId) {
      return get(`/v1/entities/${needEntityId(entityId, 'entityId')}/momentum`);
    },
    async sponsors(channelId, { minAdReads, status, limit } = {}) {
      return get(`/v1/channels/${needChannelId(channelId, 'channelId')}/sponsors`, { min_ad_reads: minAdReads, status, limit });
    },
    async recommendations(entityId, { kind = 'all', channelId, after, before, limit = 10, cursor } = {}) {
      if (!(kind in KINDS)) throw new ArcmiraError('kind is sponsored, organic or all', 'invalid_kind');
      return get(`/v1/entities/${needEntityId(entityId, 'entityId')}/recommendations`, {
        mention_class: KINDS[kind],
        channel_id: channelId === undefined ? undefined : needChannelId(channelId, 'channelId'),
        date_from: isoDay(after, 'after'),
        date_to: isoDay(before, 'before'),
        limit,
        cursor,
      });
    },
    async episodes(channelId, { limit = 10, after, before } = {}) {
      return get(`/v1/channels/${needChannelId(channelId, 'channelId')}/videos`, {
        limit,
        published_after: isoDay(after, 'after'),
        published_before: isoDay(before, 'before'),
      });
    },
    async transcript(video, { quality, language, timestamps, start, end } = {}) {
      return get(`/v1/transcripts/${videoIdOf(video)}`, { quality, language, timestamps: timestamps === false ? 'false' : undefined, start, end });
    },
    async occurrences({ channelIds, entityIds, videoIds, types, mode, after, before, limit = 20 } = {}) {
      const channel_ids = list(channelIds, needChannelId, 'channelIds', 8);
      const entity_ids = list(entityIds, needEntityId, 'entityIds', 20);
      const video_ids = list(videoIds, (v) => videoIdOf(v), 'videoIds', 20);
      if (!channel_ids && !entity_ids && !video_ids) throw new ArcmiraError('occurrences needs channelIds, entityIds or videoIds', 'invalid_request');
      return get('/v1/mentions/counts', {
        channel_ids,
        entity_ids,
        video_ids,
        entity_types: Array.isArray(types) ? types.join(',') : types,
        mode,
        published_after: isoDay(after, 'after'),
        published_before: isoDay(before, 'before'),
        limit,
      });
    },
    async status({ channelId, jobId } = {}) {
      if (channelId) return get(`/v1/channels/${needChannelId(channelId, 'channelId')}/coverage`);
      if (jobId) return get(`/v1/transcriptions/${encodeURIComponent(jobId)}`);
      return get('/v1/me');
    },
  };
  return { arcmira, meter };
}
