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

test('task skill programs call only methods the reference documents', async () => {
  const { METHODS } = await import('../src/reference.ts');
  const { TASK_SKILLS } = await import('../src/skills.ts');
  const known = new Set([...METHODS.map((m) => m.name), 'today', 'daysAgo']);
  for (const skill of TASK_SKILLS) {
    for (const program of skill.programs) {
      const called = [...program.code.matchAll(/arcmira\.(\w+)\(/g)].map((m) => m[1]);
      assert.ok(called.length > 0, `${skill.name}: ${program.title} calls the client`);
      for (const name of called) assert.ok(known.has(name), `${skill.name}: ${program.title} calls arcmira.${name}, which describe does not document`);
    }
  }
});

test('every task skill has a short always-on description and a folder under its own name', async () => {
  const { TASK_SKILLS } = await import('../src/skills.ts');
  const names = new Set<string>();
  for (const skill of TASK_SKILLS) {
    assert.match(skill.name, /^[a-z][a-z0-9-]{2,63}$/);
    assert.ok(!names.has(skill.name), `${skill.name} is unique`);
    names.add(skill.name);
    assert.ok(skill.description.length <= 160, `${skill.name}: description is ${skill.description.length} characters, keep it at 160 or under`);
    const text = readFileSync(join(ROOT, 'plugins/arcmira/skills', skill.name, 'SKILL.md'), 'utf8');
    assert.ok(text.startsWith(`---\nname: ${skill.name}\n`), `${skill.name}/SKILL.md frontmatter`);
  }
});

test('every plugin manifest carries the package version, so hosts see each release as an update', () => {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  for (const manifest of ['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.cursor-plugin/plugin.json', 'gemini-extension.json']) {
    const parsed = JSON.parse(readFileSync(join(ROOT, 'plugins/arcmira', manifest), 'utf8'));
    assert.equal(parsed.version, version, `plugins/arcmira/${manifest} version`);
  }
});

test('one dollar rule: the prepare surfaces state it and no surface defers to an account spending policy', async () => {
  const { DOLLAR_RULE } = await import('../src/reference.ts');
  const { describeTool, prepareTranscriptTool, SERVER_INSTRUCTIONS, TOOLS } = await import('../src/tools.ts');
  const { z } = await import('zod');
  assert.equal(
    DOLLAR_RULE,
    'max_on_demand_cents is 0 unless the user approved a cents amount in this conversation; a quote above 0 means included credits do not cover it: state the amount and ask.',
  );
  const describeText = (await describeTool.run({} as never, null)).content[0].text as string;
  const schemaText = (tool: (typeof TOOLS)[number]) => JSON.stringify(z.toJSONSchema(tool.inputSchema));
  const prepareSchema = z.toJSONSchema(prepareTranscriptTool.inputSchema) as { properties: Record<string, { description: string }> };
  for (const [where, text] of [
    ['describe', describeText],
    ['instructions', SERVER_INSTRUCTIONS],
    ['prepare_transcript description', prepareTranscriptTool.description],
    ['max_on_demand_cents', prepareSchema.properties.max_on_demand_cents.description],
  ] as const)
    assert.ok(text.includes(DOLLAR_RULE), `${where} states the dollar rule`);
  const skills = spawnSync('ls', [join(ROOT, 'plugins/arcmira/skills')], { encoding: 'utf8' }).stdout.trim().split('\n');
  const surfaces: Array<[string, string]> = [
    ['describe', describeText],
    ['instructions', SERVER_INSTRUCTIONS],
    ...TOOLS.map((tool): [string, string] => [tool.name, tool.description + schemaText(tool)]),
    ...['README.md', 'plugins/arcmira/README.md', 'llms.txt', ...skills.map((s) => `plugins/arcmira/skills/${s}/SKILL.md`)].map(
      (path): [string, string] => [path, readFileSync(join(ROOT, path), 'utf8')],
    ),
  ];
  for (const [where, text] of surfaces) assert.doesNotMatch(text, /spending policy|already authorized/i, where);
});

test('the Premium block appears once, in the transcript notes, and stays out of the instructions and task skills', async () => {
  const { METHODS } = await import('../src/reference.ts');
  const { TASK_SKILLS } = await import('../src/skills.ts');
  const { describeTool, SERVER_INSTRUCTIONS } = await import('../src/tools.ts');
  const count = (text: string) => text.split('PREMIUM PREPARATION').length - 1;
  const transcript = METHODS.find((m) => m.name === 'transcript')!;
  assert.equal(count(transcript.notes.join(' ')), 1);
  assert.equal(count((await describeTool.run({} as never, null)).content[0].text as string), 1);
  assert.equal(count(SERVER_INSTRUCTIONS), 0);
  assert.equal(count(readFileSync(SKILL, 'utf8')), 1);
  for (const skill of TASK_SKILLS) assert.equal(count(readFileSync(join(ROOT, 'plugins/arcmira/skills', skill.name, 'SKILL.md'), 'utf8')), 0, skill.name);
});

test('README states the whole-reference size the describe input reports', async () => {
  const { REFERENCE_SIZE } = await import('../src/tools.ts');
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes(REFERENCE_SIZE.replace(/^about/, 'About')), `README should say ${REFERENCE_SIZE}`);
});
