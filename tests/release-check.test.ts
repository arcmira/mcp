import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/check-release.ts', import.meta.url));

/** The release check, run on a CHANGELOG whose newest entry is `entry`. */
function check(entry: string) {
  const changelog = join(mkdtempSync(join(tmpdir(), 'arcmira-release-')), 'CHANGELOG.md');
  writeFileSync(changelog, `# Changelog\n\n## 0.10.20: the read tools send the read-only mark\n\n${entry}\n`);
  return spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, changelog], { encoding: 'utf8' });
}

describe('the release check', () => {
  it('fails while the CHANGELOG holds a date marker, and passes once the date is written', () => {
    const marked = check('This follows the API change of <date the API refusal is live> that refuses marked requests.');
    assert.equal(marked.status, 1);
    assert.match(marked.stderr, /<date the API refusal is live>/);
    const dated = check('This follows the API change of 2026-11-19 that refuses marked requests. Each line reads `[start] Name: text`, or `Speaker <id>`.');
    assert.equal(dated.status, 0, dated.stderr);
  });
});
