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
      const called = [...program.code.matchAll(/arcmira\.([\w.]+)\(/g)].map((m) => m[1]);
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
  const manifests = ['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.cursor-plugin/plugin.json', 'gemini-extension.json'].map((name) => `plugins/arcmira/${name}`);
  for (const manifest of [...manifests, 'gemini-extension.json']) {
    const parsed = JSON.parse(readFileSync(join(ROOT, manifest), 'utf8'));
    assert.equal(parsed.version, version, `${manifest} version`);
  }
});

test('one usage rule: describe, the instructions and the core skill state it once each, and no surface scripts what to ask or say about spend', async () => {
  const { BUDGET_RULE, FEEDBACK_LINE, MONITOR_OFFER, SCRIPTED_SPEND } = await import('../src/reference.ts');
  const { describeTool, SERVER_INSTRUCTIONS, TOOLS } = await import('../src/tools.ts');
  const { z } = await import('zod');
  const describeText = (await describeTool.run({} as never, null as never)).content[0].text as string;
  for (const [where, text] of [
    ['describe', describeText],
    ['instructions', SERVER_INSTRUCTIONS],
    ['arcmira skill', readFileSync(SKILL, 'utf8')],
  ] as const)
    assert.equal(text.split(BUDGET_RULE).length - 1, 1, `${where} states the budget rule once`);
  assert.match(BUDGET_RULE, /enforces that budget/);
  assert.match(BUDGET_RULE, /charge \{ unit, amount, from/);
  assert.match(BUDGET_RULE, /paid_plan_required, quota_exceeded, spend_limit_exceeded, member_limit, fair_use_cap or on_demand_paused/);
  const schemaText = (tool: (typeof TOOLS)[number]) => JSON.stringify(z.toJSONSchema(tool.inputSchema));
  const skills = spawnSync('ls', [join(ROOT, 'plugins/arcmira/skills')], { encoding: 'utf8' }).stdout.trim().split('\n');
  const surfaces: Array<[string, string]> = [
    ['describe', describeText],
    ['instructions', SERVER_INSTRUCTIONS],
    ...TOOLS.map((tool): [string, string] => [tool.name, tool.description + schemaText(tool)]),
    ...['README.md', 'plugins/arcmira/README.md', 'llms.txt', ...skills.map((s) => `plugins/arcmira/skills/${s}/SKILL.md`)].map(
      (path): [string, string] => [path, readFileSync(join(ROOT, path), 'utf8')],
    ),
  ];
  for (const [where, text] of surfaces) {
    assert.doesNotMatch(text, /spending policy|already authorized/i, where);
    assert.doesNotMatch(text, /approved a cents amount|state the amount and ask|unless the user approved|approval link/i, where);
    assert.doesNotMatch(text, SCRIPTED_SPEND, where);
    assert.doesNotMatch(text, /\bfor free\b|default daily|one question at a time/i, where);
    assert.doesNotMatch(text, /prepare_transcript|`describe`|`execute`/, `${where} names a retired tool`);
  }
  for (const skill of skills) {
    const text = readFileSync(join(ROOT, 'plugins/arcmira/skills', skill, 'SKILL.md'), 'utf8');
    assert.ok(text.trimEnd().endsWith(FEEDBACK_LINE), `${skill} ends with the feedback line`);
    assert.ok(text.includes(MONITOR_OFFER), `${skill} closes with the monitor line`);
  }
});

test('the Premium block appears once, in the transcript notes, and stays out of the instructions and every skill', async () => {
  const { METHODS } = await import('../src/reference.ts');
  const { TASK_SKILLS } = await import('../src/skills.ts');
  const { describeTool, SERVER_INSTRUCTIONS } = await import('../src/tools.ts');
  const count = (text: string) => text.split('PREMIUM. ').length - 1;
  const transcript = METHODS.find((m) => m.name === 'transcript')!;
  assert.equal(count(transcript.notes.join(' ')), 1);
  assert.equal(count((await describeTool.run({} as never, null as never)).content[0].text as string), 1);
  assert.equal(count(SERVER_INSTRUCTIONS), 0);
  assert.equal(count(readFileSync(SKILL, 'utf8')), 0);
  for (const skill of TASK_SKILLS) assert.equal(count(readFileSync(join(ROOT, 'plugins/arcmira/skills', skill.name, 'SKILL.md'), 'utf8')), 0, skill.name);
});

test('README states the whole-reference size the describe input reports', async () => {
  const { REFERENCE_SIZE } = await import('../src/tools.ts');
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes(REFERENCE_SIZE.replace(/^about/, 'About')), `README should say ${REFERENCE_SIZE}`);
});

test('README tools table is one table with every tool, and execute states the real output limits', async () => {
  const { OUTPUT_LIMITS } = await import('../src/output.ts');
  const { TOOLS, executeReadTool } = await import('../src/tools.ts');
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('## Tools'));
  const table = /\| Tool \| Input \| Returns \|\n(\|.*\|\n)+/.exec(section)?.[0] ?? '';
  for (const tool of TOOLS) assert.match(table, new RegExp(`^\\| \`${tool.name}\` \\|`, 'm'), `${tool.name} row in the tools table`);
  assert.equal(OUTPUT_LIMITS, '12,000 characters of output in total, 3,000 per string, and 100 items per array');
  const executeRow = table.split('\n').find((line) => line.startsWith('| `arcmira_execute_read`')) ?? '';
  for (const [where, text] of [['arcmira_execute_read description', executeReadTool.description], ['README arcmira_execute_read row', executeRow]] as const) {
    assert.ok(text.includes(OUTPUT_LIMITS), `${where} states ${OUTPUT_LIMITS}`);
    assert.doesNotMatch(text, /20,000/, where);
  }
  assert.doesNotMatch(readme, /cut at 20,000/);
});

test('the server instructions fit under Claude Code\'s 2,048-character cut, with headroom', async () => {
  const { MAX_INSTRUCTIONS } = await import('../src/reference.ts');
  const { SERVER_INSTRUCTIONS } = await import('../src/tools.ts');
  assert.ok(MAX_INSTRUCTIONS <= 2000);
  assert.ok(SERVER_INSTRUCTIONS.length <= MAX_INSTRUCTIONS, `instructions are ${SERVER_INSTRUCTIONS.length} characters`);
  assert.match(SERVER_INSTRUCTIONS, /last 90 days/);
});

test('describe states the 90-day default, and every worked example that builds a window uses it', async () => {
  const { EXAMPLES } = await import('../src/reference.ts');
  const { describeTool } = await import('../src/tools.ts');
  const describeText = (await describeTool.run({} as never, null as never)).content[0].text as string;
  assert.match(describeText, /With no window from the user, use the last 90 days/);
  for (const example of EXAMPLES) for (const [, days] of example.code.matchAll(/daysAgo\((\d+)\)/g)) assert.equal(days, '90', example.title);
});

test('one monitor procedure: describe, the arcmira skill and company-watch carry MONITOR_RULE, and the write tool points at it', async () => {
  const { MONITOR_RULE } = await import('../src/reference.ts');
  const { describeTool, executeWriteTool } = await import('../src/tools.ts');
  const describeText = (await describeTool.run({} as never, null as never)).content[0].text as string;
  for (const [where, text] of [
    ['describe', describeText],
    ['arcmira skill', readFileSync(SKILL, 'utf8')],
    ['company-watch skill', readFileSync(join(ROOT, 'plugins/arcmira/skills/company-watch/SKILL.md'), 'utf8')],
  ] as const)
    assert.equal(text.split(MONITOR_RULE).length - 1, 1, `${where} carries the monitor rule once`);
  assert.match(executeWriteTool.description, /MONITORS section of arcmira_describe/);
});
