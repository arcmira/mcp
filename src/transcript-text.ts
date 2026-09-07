type Row = Record<string, unknown>;

interface Segment {
  start: number;
  text: string;
  speaker: string | null;
}

interface Form {
  form: 'lines' | 'paragraphs';
  rows: readonly Segment[];
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function rowOf(value: unknown): Row {
  return typeof value === 'object' && value !== null ? (value as Row) : {};
}

function startOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
}

/** Null for an absent or empty array, so the caller reads the two transcript forms in one pass. */
function segments(value: unknown): Segment[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: Segment[] = [];
  for (const item of value) {
    const row = rowOf(item);
    const text = stringOf(row.text);
    if (text === null) continue;
    out.push({ start: startOf(row.start), text, speaker: stringOf(row.speaker) });
  }
  return out;
}

function resolveForm(body: Record<string, unknown>): Form | null {
  const lines = segments(body.lines);
  if (lines !== null) return { form: 'lines', rows: lines };
  const paragraphs = segments(body.paragraphs);
  if (paragraphs !== null) return { form: 'paragraphs', rows: paragraphs };
  return null;
}

function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function metadata(body: Record<string, unknown>, form: Form): string {
  const facts: string[] = [];
  const quality = stringOf(body.quality);
  if (quality !== null) facts.push(`Quality ${quality}`);
  const source = stringOf(body.source);
  if (source !== null) facts.push(`source ${source}`);
  const language = stringOf(body.language);
  if (language !== null) facts.push(`language ${language}`);
  const sizes = [counted(form.rows.length, form.form === 'lines' ? 'line' : 'paragraph')];
  if (typeof body.rows_billed === 'number') sizes.push(`${counted(body.rows_billed, 'row')} billed`);
  const sentences = [`${sizes.join(', ')}.`];
  if (facts.length > 0) sentences.unshift(`${facts.join(', ')}.`);
  return sentences.join(' ');
}

function formatLine(form: Form['form'], watchUrl: string | null): string {
  if (form === 'paragraphs') return 'Paragraphs, no timestamps. Call again with timestamps true for per line start seconds.';
  const cite = watchUrl === null ? '' : ` Cite one as ${watchUrl}&t=<start>.`;
  return `Every line below is [start seconds] then the words.${cite}`;
}

function transcriptText(form: Form): string {
  if (form.form === 'paragraphs') return form.rows.map((row) => row.text).join('\n\n');
  return form.rows.map((row) => `[${row.start}] ${row.speaker === null ? '' : `${row.speaker}: `}${row.text}`).join('\n');
}

function structuredOf(body: Record<string, unknown>, form: Form): Record<string, unknown> {
  const structured = { ...body };
  delete structured.lines;
  delete structured.paragraphs;
  structured.transcript_in_content = {
    form: form.form,
    count: form.rows.length,
    note: 'The transcript is the text block of this result, not this object.',
  };
  return structured;
}

/**
 * The transcript as prose for the model, plus the rest of the body with the rows lifted out.
 * Null when the body carries no transcript, which is how a pending premium job comes back.
 */
export function renderTranscript(body: Record<string, unknown>): { text: string; structured: Record<string, unknown> } | null {
  const form = resolveForm(body);
  if (form === null) return null;
  const video = rowOf(body.video);
  const watchUrl = stringOf(video.watch_url);
  const header = [
    stringOf(video.title) ?? stringOf(video.id),
    watchUrl,
    metadata(body, form),
    stringOf(body.note),
    formatLine(form.form, watchUrl),
  ].filter((line): line is string => line !== null);
  return { text: `${header.join('\n')}\n\n${transcriptText(form)}`, structured: structuredOf(body, form) };
}
