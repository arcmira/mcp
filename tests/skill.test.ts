import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(ROOT, 'plugins/arcmira/skills/arcmira/SKILL.md');

test('SKILL.md matches what scripts/build-skill.ts writes from src/reference.ts', () => {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/build-skill.ts', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
});

test('SKILL.md frontmatter names the arcmira skill', () => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(SKILL, 'utf8'));
  assert.ok(match, 'frontmatter block');
  const fields = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const at = line.indexOf(': ');
      const value = line.slice(at + 2);
      return [line.slice(0, at), value.startsWith('"') ? JSON.parse(value) : value];
    }),
  );
  assert.equal(fields.name, 'arcmira');
  assert.ok(fields.description.length > 0 && fields.description.length < 200, 'description under 200 characters');
});
