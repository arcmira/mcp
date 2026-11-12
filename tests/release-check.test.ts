import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };

const SCRIPT = fileURLToPath(new URL('../scripts/check-release.ts', import.meta.url));
const WORKFLOWS = new URL('../.github/workflows/', import.meta.url);
const MARKED = 'This follows the API change of <date the API refusal is live> that refuses marked requests.';
const DATED = 'This follows the API change of 2026-11-19 that refuses marked requests. Each line reads `[start] Name: text`, or `Speaker <id>`.';
/** The release check as a workflow or package script runs it. */
const CHECK = /pnpm release:check|scripts\/check-release\.ts/;
/** The step that ships, in each workflow that ships a release. */
const SHIPS: Readonly<Record<string, RegExp>> = {
  'deploy.yml': /wrangler deploy/,
  'publish.yml': /mcp-publisher publish/,
  'tessl-publish.yml': /tessl plugin publish/,
};

/** A new folder holding a CHANGELOG whose newest entry is `entry`. */
function release(entry: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'arcmira-release-'));
  writeFileSync(join(dir, 'CHANGELOG.md'), `# Changelog\n\n## 0.10.20: the read tools send the read-only mark\n\n${entry}\n`);
  return dir;
}

/** The release check, run on a CHANGELOG whose newest entry is `entry`. */
function check(entry: string) {
  return spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, join(release(entry), 'CHANGELOG.md')], { encoding: 'utf8' });
}

/** Each step of a workflow's job, in order, as its YAML text. */
function steps(workflow: string): string[] {
  const lines = readFileSync(new URL(workflow, WORKFLOWS), 'utf8').split('\n');
  const at = lines.findIndex((line) => /^\s*steps:\s*$/.test(line));
  const item = `${' '.repeat(lines[at]!.search(/\S/) + 2)}- `;
  const found: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith(item)) found.push(line);
    else if (found.length > 0) found[found.length - 1] += `\n${line}`;
  }
  return found;
}

/** The shell a step runs, from its `run:` line or block. */
function runOf(step: string): string {
  const lines = step.split('\n');
  const at = lines.findIndex((line) => /^\s*-?\s*run:/.test(line));
  const inline = lines[at]!.replace(/^\s*-?\s*run:\s*/, '');
  if (inline !== '|') return inline;
  const block: string[] = [];
  const indent = lines[at + 1]!.search(/\S/);
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== '' && line.search(/\S/) < indent) break;
    block.push(line.slice(indent));
  }
  return block.join('\n');
}

describe('the release check', () => {
  it('fails while the CHANGELOG holds a date marker, and passes once the date is written', () => {
    const marked = check(MARKED);
    assert.equal(marked.status, 1);
    assert.match(marked.stderr, /<date the API refusal is live>/);
    const dated = check(DATED);
    assert.equal(dated.status, 0, dated.stderr);
  });

  it('runs before the step that ships in every workflow that ships a release, which is every workflow but pull request CI', () => {
    const releases = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name) && name !== 'ci.yml');
    assert.deepEqual(releases.sort(), Object.keys(SHIPS).sort());
    for (const [workflow, ships] of Object.entries(SHIPS)) {
      const list = steps(workflow);
      const checked = list.findIndex((step) => CHECK.test(step));
      const shipped = list.findIndex((step) => ships.test(step));
      assert.ok(checked >= 0, `${workflow} ships a release without the release check`);
      assert.ok(shipped >= 0, `${workflow} has no step matching ${ships}`);
      assert.ok(checked < shipped, `${workflow} runs the release check in step ${checked + 1}, after it ships in step ${shipped + 1}`);
      assert.match(list[checked]!, /name: The CHANGELOG holds no unfilled date marker\n/, `${workflow} names the release check step`);
    }
    assert.doesNotMatch(readFileSync(new URL('ci.yml', WORKFLOWS), 'utf8'), CHECK, 'pull request CI must pass while the marker is in place');
  });

  it('runs first in pnpm deploy', () => {
    assert.equal(pkg.scripts.deploy.split('&&')[0]!.trim(), 'pnpm release:check');
  });

  it('runs in the Tessl publish when the released commit has it, and a release from before it passes', () => {
    const run = runOf(steps('tessl-publish.yml').find((step) => CHECK.test(step))!);
    const bash = (dir: string) =>
      spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', run], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` },
      });
    const withCheck = (entry: string) => {
      const dir = release(entry);
      mkdirSync(join(dir, 'scripts'));
      copyFileSync(SCRIPT, join(dir, 'scripts', 'check-release.ts'));
      return dir;
    };
    const marked = bash(withCheck(MARKED));
    assert.equal(marked.status, 1, 'a release with the check and a marker');
    assert.match(marked.stderr, /<date the API refusal is live>/);
    const dated = bash(withCheck(DATED));
    assert.equal(dated.status, 0, `a release with the check and a date: ${dated.stderr}`);
    const older = bash(release('- Tools and results are unchanged.'));
    assert.equal(older.status, 0, `a release from before the check: ${older.stderr}`);
  });
});
