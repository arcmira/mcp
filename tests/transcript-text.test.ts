import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderTranscript } from '../src/transcript-text.ts';

const VIDEO = 'dQw4w9WgXcQ';
const WATCH = `https://arcmira.com/watch?v=${VIDEO}`;
const IN_CONTENT_NOTE = 'The transcript is the text block of this result, not this object.';

function linesBody(): Record<string, unknown> {
  return {
    video: { id: VIDEO, title: 'Never Gonna Give You Up', watch_url: WATCH },
    quality: 'captions',
    source: 'third_party_quick',
    language: 'asr-en',
    lines: [
      { start: 0, text: 'we are live' },
      { start: 12.48, text: 'and Ramp is the sponsor' },
    ],
    rows_billed: 10,
    note: 'quote the lines that answer',
    as_of: '2026-08-04',
  };
}

function rendered(body: Record<string, unknown>) {
  const out = renderTranscript(body);
  if (out === null) throw new Error('expected a rendering');
  return out;
}

describe('renderTranscript, lines', () => {
  it('writes the header and one bracketed start per line', () => {
    assert.equal(rendered(linesBody()).text, [
      'Never Gonna Give You Up',
      WATCH,
      'Quality captions, source third_party_quick, language asr-en. 2 lines, 10 rows billed.',
      'quote the lines that answer',
      `Every line below is [start seconds] then the words. Cite one as ${WATCH}&t=<start>.`,
      '',
      '[0] we are live',
      '[12] and Ramp is the sponsor',
    ].join('\n'));
  });

  it('keeps the speaker a premium line carries', () => {
    const out = rendered({
      video: { id: VIDEO, watch_url: WATCH },
      quality: 'premium',
      lines: [
        { start: 4.9, speaker: 'John Coogan', text: 'welcome back' },
        { start: 9, text: 'no speaker on this one' },
      ],
    });
    assert.match(out.text, /^\[4\] John Coogan: welcome back$/m);
    assert.match(out.text, /^\[9\] no speaker on this one$/m);
  });

  it('falls back to the video id and drops the header lines the body does not carry', () => {
    const out = rendered({ video: { id: VIDEO }, lines: [{ start: 30, text: 'one line only' }], rows_billed: 1 });
    assert.equal(out.text, [
      VIDEO,
      '1 line, 1 row billed.',
      'Every line below is [start seconds] then the words.',
      '',
      '[30] one line only',
    ].join('\n'));
  });

  it('prints a zero row count and skips a row with no usable text', () => {
    const out = rendered({ lines: [{ start: 1, text: 'kept' }, { start: 2, text: '' }, { start: 3 }], rows_billed: 0 });
    assert.equal(out.text, [
      '1 line, 0 rows billed.',
      'Every line below is [start seconds] then the words.',
      '',
      '[1] kept',
    ].join('\n'));
    assert.equal((out.structured.transcript_in_content as { count: number }).count, 1);
  });

  it('treats a missing start as zero', () => {
    assert.match(rendered({ lines: [{ text: 'no start here' }] }).text, /^\[0\] no start here$/m);
  });
});

describe('renderTranscript, paragraphs', () => {
  it('separates paragraphs by a blank line and writes no bracketed starts', () => {
    const out = rendered({
      video: { id: VIDEO, title: 'Never Gonna Give You Up' },
      paragraphs: [{ start: 0, text: 'First paragraph.' }, { start: 61, text: 'Second paragraph.' }],
    });
    assert.equal(out.text, [
      'Never Gonna Give You Up',
      '2 paragraphs.',
      'Paragraphs, no timestamps. Call again with timestamps true for per line start seconds.',
      '',
      'First paragraph.',
      '',
      'Second paragraph.',
    ].join('\n'));
    assert.equal(/\[\d+\]/.test(out.text), false, 'no bracketed start when timestamps are off');
  });

  it('lines win when a body carries both forms', () => {
    const out = rendered({ lines: [{ start: 0, text: 'from lines' }], paragraphs: [{ start: 0, text: 'from paragraphs' }] });
    assert.equal((out.structured.transcript_in_content as { form: string }).form, 'lines');
    assert.match(out.text, /from lines/);
    assert.equal(/from paragraphs/.test(out.text), false, 'the losing form is not rendered');
  });
});

describe('renderTranscript, structured content', () => {
  it('lifts the rows out and preserves every other field', () => {
    const body = linesBody();
    const out = rendered(body);
    assert.deepEqual(out.structured, {
      video: { id: VIDEO, title: 'Never Gonna Give You Up', watch_url: WATCH },
      quality: 'captions',
      source: 'third_party_quick',
      language: 'asr-en',
      rows_billed: 10,
      note: 'quote the lines that answer',
      as_of: '2026-08-04',
      transcript_in_content: { form: 'lines', count: 2, note: IN_CONTENT_NOTE },
    });
    assert.ok('lines' in body, 'the caller body is not mutated');
  });

  it('removes paragraphs too', () => {
    const out = rendered({ paragraphs: [{ start: 0, text: 'p' }], access: { code: 'premium_not_enabled' } });
    assert.deepEqual(out.structured, {
      access: { code: 'premium_not_enabled' },
      transcript_in_content: { form: 'paragraphs', count: 1, note: IN_CONTENT_NOTE },
    });
  });
});

describe('renderTranscript, no transcript', () => {
  it('is null for a body with neither form, empty arrays included', () => {
    assert.equal(renderTranscript({ video: { id: VIDEO }, premium_job: { job_id: 'job_7' } }), null);
    assert.equal(renderTranscript({ lines: [], paragraphs: [] }), null);
    assert.equal(renderTranscript({ lines: 'not an array' }), null);
  });
});

describe('renderTranscript, size', () => {
  it('is materially smaller than the serialized body', () => {
    const body = {
      video: { id: VIDEO, title: 'Never Gonna Give You Up', watch_url: WATCH },
      quality: 'captions',
      lines: Array.from({ length: 500 }, (_, i) => ({ start: i * 3.24, end: i * 3.24 + 3, text: 'and Ramp is the sponsor here' })),
      rows_billed: 10,
    };
    const out = rendered(body);
    assert.ok(out.text.length * 1.3 < JSON.stringify(body).length, `rendered ${out.text.length} against serialized ${JSON.stringify(body).length}`);
  });
});
