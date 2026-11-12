import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { TASK_SKILLS } from '../src/skills.ts';

const skill = TASK_SKILLS.find((entry) => entry.name === 'find-quotes');
assert.ok(skill);
const program = skill.programs[0];
assert.ok(program);

const chunk = {
  video_id: 'abcdefghijk', video_title: 'Example episode', channel_name: 'Example show',
  published_at: '2026-11-01', start_seconds: 869, text: 'Search passage',
  watch_url: 'https://arcmira.com/watch?v=abcdefghijk&t=869', speakers_by: [],
};

test('quote program preserves cue precision and links each cue separately from the search passage', async () => {
  const result = await runInNewContext(`(async () => { ${program.code} })()`, {
    arcmira: {
      resolve: async () => ({ best: { id: 'ent_example', name: 'Example speaker' } }),
      search: async () => ({ chunks: [chunk], as_of: '2026-11-06' }),
      transcript: async () => ({ lines: [
        { start: 869.25, end: 872.5, text: 'Earlier context.' },
        { start: 901.58, end: 910.85, text: 'The selected sentence.' },
      ] }),
    },
  });
  const moment = JSON.parse(JSON.stringify(result)).moments[0];
  assert.deepEqual(moment.lines, [
    { start: 869.25, end: 872.5, text: 'Earlier context.', source_url: 'https://www.youtube.com/watch?v=abcdefghijk&t=869' },
    { start: 901.58, end: 910.85, text: 'The selected sentence.', source_url: 'https://www.youtube.com/watch?v=abcdefghijk&t=901' },
  ]);
  assert.equal(moment.passage_url, chunk.watch_url);
  assert.deepEqual(moment.context_window, { start: 869.25, end: 910.85 });
});

test('an unavailable transcript retains passage provenance without inventing a sentence link', async () => {
  const result = await runInNewContext(`(async () => { ${program.code} })()`, {
    arcmira: {
      resolve: async () => ({ best: { id: 'ent_example', name: 'Example speaker' } }),
      search: async () => ({ chunks: [chunk], as_of: '2026-11-06' }),
      transcript: async () => { throw { code: 'transcript_unavailable' }; },
    },
  });
  const moment = JSON.parse(JSON.stringify(result)).moments[0];
  assert.equal(moment.passage_url, chunk.watch_url);
  assert.equal(moment.passage, 'Search passage');
  assert.equal(moment.transcript, 'transcript_unavailable');
  assert.equal(moment.lines, undefined);
  assert.equal(moment.context_window, undefined);
});
