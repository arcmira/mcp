/**
 * The arcmira client a program sees inside the execute sandbox. Plain JavaScript because the
 * dynamic Worker loads it as source text; the parent bundles this file as a Text module.
 * Methods mirror the arcmira CLI commands. Every filter takes verbatim ids; a name where an id
 * belongs throws id_required before any network call. fetch() inside the sandbox reaches only the
 * Arcmira API, through the parent's outbound proxy, which adds the caller's credential and refuses
 * every route outside the tool's allowlist. `access` is "read" (arcmira_execute_read) or "write"
 * (arcmira_execute_write); a write method in a read program throws write_tool_required before any
 * network call, and the outbound would refuse it anyway.
 */

export const ENTITY_ID = /^ent_\d+$/;
export const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** API errors name the /v1 query key; a program wrote the client option, so the error names that. */
const OPTION_FOR_WIRE_PARAM = new Map([['date_from', 'after'], ['published_after', 'after'], ['date_to', 'before'], ['published_before', 'before']]);

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
      `${param} takes a verbatim entity id like ent_14, got ${JSON.stringify(value)}. Call arcmira.resolve("<name>") first and pass the .id of .best or .suggested; when it answers .ask, pick from ask.options.`,
      'id_required',
    );
  }
  return value;
}

function needChannelId(value, param) {
  if (typeof value !== 'string' || !CHANNEL_ID.test(value)) {
    throw new ArcmiraError(
      `${param} takes a verbatim YouTube channel id (UC plus 22 characters), got ${JSON.stringify(value)}. Call arcmira.resolve("<show name>", { type: "channel" }) first and pass the .youtube_channel_id of .best or .suggested.`,
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

/** before is the last day counted everywhere in this client; /v1 published_before is exclusive, so send the next day. /v1 date_to is already inclusive. */
function dayAfterInclusive(value, param) {
  const day = isoDay(value, param);
  if (day === undefined) return undefined;
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function needOptions(method, value, signature) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArcmiraError(`arcmira.${method} takes one options object, got ${JSON.stringify(value)}. Call it as ${signature}.`, 'invalid_request');
  }
  return value;
}

/** wait stops here so its last poll still fits inside the 30-second execute limit. */
const MAX_WAIT_SECONDS = 25;

const KINDS = { sponsored: 'ad_read', organic: 'endorsement', all: 'all' };
const FREQUENCIES = new Set(['realtime', 'hourly', 'daily']);
const PERSON_MATCH_MODES = new Set(['mentions', 'appearances', 'both']);
/** The monitor fields POST /v1/monitors takes; PATCH also takes isPaused, isCollapsed and sortOrder. */
const MONITOR_FIELDS = ['name', 'notifyFrequency', 'notifyEmails', 'notifySlack', 'slackIntegrationId', 'slackChannelId', 'notifyWebhook', 'webhookUrl', 'digestDay', 'digestTime'];
const MONITOR_UPDATE_FIELDS = [...MONITOR_FIELDS, 'isPaused', 'isCollapsed', 'sortOrder'];
/** POST /v1/monitors/{id}/entities takes at most this many ids per call. */
const MAX_ENTITY_IDS = 90;

function needMonitorId(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 100) {
    throw new ArcmiraError(`A monitor id is the .id of a row from arcmira.monitors.list(), got ${JSON.stringify(value)}. Never pass a monitor name.`, 'id_required');
  }
  return encodeURIComponent(value);
}

function monitorFields(method, value, allowed) {
  const fields = needOptions(method, value, `arcmira.${method}({ ${allowed.slice(0, 4).join(', ')}, ... })`);
  const unknown = Object.keys(fields).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new ArcmiraError(`arcmira.${method} does not take ${unknown.join(', ')}. It takes ${allowed.join(', ')}.`, 'invalid_request');
  if (fields.notifyFrequency !== undefined && !FREQUENCIES.has(fields.notifyFrequency)) {
    throw new ArcmiraError('notifyFrequency is realtime (as it happens), hourly (an hourly digest) or daily (a daily digest).', 'invalid_request');
  }
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}
const SEARCH_KINDS = new Set(['mention', 'recommendation_sponsored', 'recommendation_organic']);

/**
 * @param {{ base: string, fetch?: typeof fetch, maxCalls?: number, now?: () => Date, sleep?: (ms: number) => Promise<void>, onCall?: (call: object) => void, access?: 'read' | 'write', idempotencyKey?: () => string }} options
 */
export function createArcmira({ base, fetch: doFetch = globalThis.fetch, maxCalls = 40, now = () => new Date(), sleep = (ms) => new Promise((done) => setTimeout(done, ms)), onCall, access = 'read', idempotencyKey = () => crypto.randomUUID() }) {
  const root = base.replace(/\/$/, '');
  const meter = { calls: 0, rate_limit: null, api_build: null };

  /**
   * The parsed body and headers of one v1 request; a non-2xx answer throws ArcmiraError. A body
   * makes it a POST (or `method`), sent as JSON with a fresh Idempotency-Key.
   */
  async function call(path, query = {}, send) {
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
    const res = await doFetch(
      url.toString(),
      send
        ? { method: send.method ?? 'POST', redirect: 'manual', headers: { accept: 'application/json', 'content-type': 'application/json', 'idempotency-key': idempotencyKey() }, body: JSON.stringify(send.body) }
        : { redirect: 'manual', headers: { accept: 'application/json' } },
    );
    const body = await res.json().catch(() => null);
    const limit = Number(res.headers.get('ratelimit-limit'));
    const remaining = Number(res.headers.get('ratelimit-remaining'));
    const reset = Number(res.headers.get('ratelimit-reset'));
    if (Number.isFinite(limit) && Number.isFinite(remaining) && Number.isFinite(reset) && res.headers.get('ratelimit-limit') !== null) {
      meter.rate_limit = { limit, remaining, reset };
    }
    meter.api_build = res.headers.get('x-arcmira-build') ?? meter.api_build;
    onCall?.({ method: send ? (send.method ?? 'POST') : 'GET', path, query, body: send?.body, status: res.status, ms: Date.now() - started });
    if (res.ok && body) return { body, headers: res.headers };
    const err = body?.error ?? {};
    const option = OPTION_FOR_WIRE_PARAM.get(err.param);
    const message = err.message ?? `HTTP ${res.status}`;
    throw new ArcmiraError(option ? message.replace(new RegExp(`\\b${err.param}\\b`, 'g'), option) : message, err.code ?? 'http_error', {
      status: res.status,
      unlock: err.unlock,
      gate: err.gate,
      param: option ?? err.param,
      retry_after_seconds: err.retry_after_seconds,
      retry_after: res.headers.get('retry-after'),
      doc_url: err.doc_url,
      request_id: err.request_id,
      quote: body?.quote,
    });
  }

  async function get(path, query = {}) {
    return (await call(path, query)).body;
  }

  async function write(method, path, body, verb = 'POST') {
    if (access !== 'write') {
      throw new ArcmiraError(`arcmira.${method} changes the account. Run it in arcmira_execute_write; arcmira_execute_read only reads.`, 'write_tool_required');
    }
    return (await call(path, {}, { method: verb, body })).body;
  }

  const arcmira = {
    today() {
      return now().toISOString().slice(0, 10);
    },
    daysAgo(n) {
      if (!Number.isFinite(n) || n < 0) throw new ArcmiraError('daysAgo takes a non-negative number of days', 'invalid_date');
      return new Date(now().getTime() - n * 86_400_000).toISOString().slice(0, 10);
    },
    async resolve(q, { type, context, limit = 8 } = {}) {
      if (typeof q !== 'string' || q.trim().length < 2) throw new ArcmiraError('resolve needs a name of 2 or more characters', 'invalid_name');
      if (context !== undefined && typeof context !== 'string') throw new ArcmiraError('context takes the user\'s own words about the name, as one string', 'invalid_request');
      const body = await get('/v1/entities/resolve', { q, type, context, limit });
      return { query: body.query, context: body.context, confidence: body.confidence, best: body.best, suggested: body.suggested, ask: body.ask, candidates: body.candidates, note: body.note };
    },
    async search(options) {
      const { query, channelIds, about, entityIds, speakerIds, kind, after, before, source, limit = 5 } = needOptions('search', options, 'arcmira.search({ query, channelIds?, about?, speakerIds?, kind?, after?, before?, limit? })');
      if (typeof query !== 'string' || query.length < 2) throw new ArcmiraError('search needs query, a topic or phrase of 2 or more characters', 'invalid_query');
      if (kind !== undefined && !SEARCH_KINDS.has(kind)) throw new ArcmiraError('kind is mention, recommendation_sponsored or recommendation_organic', 'invalid_kind');
      return get('/v1/transcripts/search', {
        q: query,
        channel_ids: list(channelIds, needChannelId, 'channelIds', 8),
        about: list(about, needEntityId, 'about', 8),
        entity_ids: list(entityIds, needEntityId, 'entityIds', 8),
        by: list(speakerIds, needEntityId, 'speakerIds', 8),
        kind,
        published_after: isoDay(after, 'after'),
        published_before: dayAfterInclusive(before, 'before'),
        source,
        limit,
      });
    },
    async mentions(options) {
      const { entityId, channelId, after, before, limit = 10, cursor } = needOptions('mentions', options, 'arcmira.mentions({ entityId, channelId?, after?, before?, limit?, cursor? })');
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
        published_before: dayAfterInclusive(before, 'before'),
      });
    },
    async transcript(video, { quality, language, timestamps, start, end } = {}) {
      return get(`/v1/transcripts/${videoIdOf(video)}`, { quality, language, timestamps: timestamps === false ? 'false' : undefined, start, end });
    },
    async occurrences(options) {
      const { channelIds, entityIds, videoIds, types, mode, after, before, limit = 20 } = needOptions('occurrences', options, 'arcmira.occurrences({ channelIds?, entityIds?, videoIds?, types?, after?, before?, limit? })');
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
        published_before: dayAfterInclusive(before, 'before'),
        limit,
      });
    },
    async quote(video) {
      return get(`/v1/transcripts/${videoIdOf(video)}/quote`);
    },
    async prepare(video) {
      const id = videoIdOf(video);
      const q = await get(`/v1/transcripts/${id}/quote`);
      const rows = Number(q?.quote?.rows);
      if (!Number.isInteger(rows) || rows < 0) throw new ArcmiraError(`The quote for ${id} carried no row count, so nothing was bought. Read arcmira.quote("${id}") and retry.`, 'quote_unreadable');
      // The account's on-demand budget is the approval: authorize exactly what the quote says included credits do not cover.
      const cents = q.charge?.from === 'included' ? 0 : Math.max(0, Math.ceil(Number(q.max_on_demand_cents) || 0));
      const body = (await call('/v1/transcriptions', {}, { body: { video_id: id, max_rows: rows, max_on_demand_cents: cents } })).body;
      return body.job ?? body;
    },
    async wait(jobOrId, { timeoutSeconds = MAX_WAIT_SECONDS } = {}) {
      const given = jobOrId?.job ?? jobOrId;
      const id = typeof given === 'string' ? given : given?.id;
      if (typeof id !== 'string' || id === '') throw new ArcmiraError('wait takes a Job from prepare_transcript, the body that carries one (.job), or its id.', 'invalid_request');
      const deadline = now().getTime() + Math.min(Math.max(0, Number(timeoutSeconds) || 0), MAX_WAIT_SECONDS) * 1000;
      for (;;) {
        const { body: job, headers } = await call(`/v1/transcriptions/${encodeURIComponent(id)}`);
        const remaining = deadline - now().getTime();
        if (job.state !== 'pending' || remaining <= 0) return job;
        const poll = Number(job.next_poll_seconds ?? headers.get('retry-after')) || 10;
        await sleep(Math.min(poll * 1000, remaining));
      }
    },
    async status(options) {
      const { channelId, jobId } = needOptions('status', options, 'arcmira.status({ channelId }) or arcmira.status({ jobId })');
      if (channelId) return get(`/v1/channels/${needChannelId(channelId, 'channelId')}/coverage`);
      if (jobId) return get(`/v1/transcriptions/${encodeURIComponent(jobId)}`);
      return get('/v1/me');
    },
    monitors: {
      async list() {
        return get('/v1/monitors');
      },
      async trackers(monitorId) {
        return get(`/v1/monitors/${needMonitorId(monitorId)}/trackers`);
      },
      async create(options) {
        const fields = monitorFields('monitors.create', options, MONITOR_FIELDS);
        if (typeof fields.name !== 'string' || fields.name.trim() === '') throw new ArcmiraError('arcmira.monitors.create needs name, 1 to 100 characters.', 'invalid_request');
        if (fields.notifyFrequency === undefined) throw new ArcmiraError('arcmira.monitors.create needs notifyFrequency: ask the user realtime, hourly or daily (default daily).', 'invalid_request');
        return write('monitors.create', '/v1/monitors', fields);
      },
      async update(monitorId, patch) {
        const path = `/v1/monitors/${needMonitorId(monitorId)}`;
        const fields = monitorFields('monitors.update', patch, MONITOR_UPDATE_FIELDS);
        if (Object.keys(fields).length === 0) throw new ArcmiraError('arcmira.monitors.update needs at least one field to change, like { isPaused: true }.', 'invalid_request');
        return write('monitors.update', path, fields, 'PATCH');
      },
      async addEntities(monitorId, entityIds, options) {
        const path = `/v1/monitors/${needMonitorId(monitorId)}/entities`;
        const ids = Array.isArray(entityIds) ? entityIds : [entityIds];
        if (ids.length === 0 || ids.length > MAX_ENTITY_IDS) throw new ArcmiraError(`arcmira.monitors.addEntities takes 1 to ${MAX_ENTITY_IDS} entity ids; split the call.`, 'too_many');
        const { personMatchMode } = needOptions('monitors.addEntities', options, 'arcmira.monitors.addEntities(monitorId, entityIds, { personMatchMode? })');
        if (personMatchMode !== undefined && !PERSON_MATCH_MODES.has(personMatchMode)) throw new ArcmiraError('personMatchMode is mentions, appearances or both.', 'invalid_request');
        const body = { entity_ids: [...new Set(ids.map((id) => needEntityId(id, 'entityIds')))], ...(personMatchMode ? { person_match_mode: personMatchMode } : {}) };
        return write('monitors.addEntities', path, body);
      },
    },
  };
  return { arcmira, meter };
}
