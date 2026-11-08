import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'plugins/arcmira/skills');
const SKILL = join(SKILLS, 'arcmira/SKILL.md');
const skillNames = () => readdirSync(SKILLS);

/** What an agent can read of one skill: its SKILL.md, then every file in its references folder. */
function skillSurface(name: string): string {
  const references = join(SKILLS, name, 'references');
  const files = existsSync(references) ? readdirSync(references).map((file) => join(references, file)) : [];
  return [join(SKILLS, name, 'SKILL.md'), ...files].map((file) => readFileSync(file, 'utf8')).join('\n');
}

const count = (text: string, rule: string) => text.split(rule).length - 1;

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
  const { TASK_SKILLS, programsOf } = await import('../src/skills.ts');
  const known = new Set([...METHODS.map((m) => m.name), 'today', 'daysAgo']);
  for (const skill of TASK_SKILLS) {
    for (const program of programsOf(skill)) {
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

test('the clip skill says the rights line, word for word, before any download step, and its commands carry no cookies or login', async () => {
  const { CLIP_RIGHTS } = await import('../src/skills.ts');
  assert.equal(CLIP_RIGHTS, 'You need the rights to download, cut or reuse this video. Arcmira finds the moment and gives you the link and the seconds. It grants no rights to the video.');
  const text = readFileSync(join(ROOT, 'plugins/arcmira/skills/youtube-clip-finder/SKILL.md'), 'utf8');
  assert.ok(text.includes(CLIP_RIGHTS), 'states the rights line');
  assert.ok(text.indexOf(CLIP_RIGHTS) < text.indexOf('yt-dlp'), 'the rights line comes before the first yt-dlp mention');
  assert.doesNotMatch(text, /--cookies|--username|--password|--netrc/);
});

test('every plugin manifest carries the package version, so hosts see each release as an update', () => {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const manifests = ['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.cursor-plugin/plugin.json', 'gemini-extension.json'].map((name) => `plugins/arcmira/${name}`);
  for (const manifest of [...manifests, 'gemini-extension.json']) {
    const parsed = JSON.parse(readFileSync(join(ROOT, manifest), 'utf8'));
    assert.equal(parsed.version, version, `${manifest} version`);
  }
});

test('the server, plugin and skills are Apache-2.0: one LICENSE text, a NOTICE, and every manifest license field', () => {
  assert.ok(readFileSync(join(ROOT, 'LICENSE')).equals(readFileSync(join(ROOT, 'plugins/arcmira/LICENSE'))), 'LICENSE is the plugin LICENSE byte for byte');
  assert.match(readFileSync(join(ROOT, 'plugins/arcmira/LICENSE'), 'utf8'), /Apache License\s+Version 2\.0/);
  assert.equal(readFileSync(join(ROOT, 'NOTICE'), 'utf8'), 'Arcmira MCP\nCopyright 2026 Arcmira (https://arcmira.com)\n');
  const manifests = ['package.json', 'server.json', 'gemini-extension.json', '.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json', '.agents/plugins/marketplace.json', ...['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.cursor-plugin/plugin.json', 'gemini-extension.json'].map((name) => `plugins/arcmira/${name}`)];
  const licenses = (node: unknown, out: string[] = []): string[] => {
    if (Array.isArray(node)) for (const item of node) licenses(item, out);
    else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) key === 'license' ? out.push(String(value)) : licenses(value, out);
    return out;
  };
  const found = manifests.flatMap((manifest) => licenses(JSON.parse(readFileSync(join(ROOT, manifest), 'utf8'))).map((license) => [manifest, license]));
  assert.ok(found.some(([manifest]) => manifest === 'package.json'), 'package.json carries a license');
  for (const [manifest, license] of found) assert.equal(license, 'Apache-2.0', manifest);
});

test('one usage rule: describe and the core skill state BUDGET_RULE once each, the instructions its short form once, and no surface scripts what to ask or say about spend', async () => {
  const { BUDGET_RULE, BUDGET_SUMMARY, FEEDBACK_LINE, MONITOR_OFFER, SCRIPTED_SPEND } = await import('../src/reference.ts');
  const { describeTool, SERVER_INSTRUCTIONS, TOOLS } = await import('../src/tools.ts');
  const { z } = await import('zod');
  const describeText = (await describeTool.run({} as never, null as never)).content[0].text as string;
  for (const [where, text] of [
    ['describe', describeText],
    ['arcmira skill', skillSurface('arcmira')],
  ] as const) {
    assert.equal(count(text, BUDGET_RULE), 1, `${where} states the budget rule once`);
    assert.equal(count(text, BUDGET_SUMMARY), 0, `${where} carries the whole rule, not the short form`);
  }
  assert.equal(count(SERVER_INSTRUCTIONS, BUDGET_SUMMARY), 1, 'the instructions state the short usage rule once');
  assert.equal(count(SERVER_INSTRUCTIONS, BUDGET_RULE), 0, 'the instructions leave the whole rule to describe');
  assert.match(BUDGET_RULE, /enforces that budget/);
  assert.match(BUDGET_RULE, /charge \{ unit, amount, from/);
  assert.match(BUDGET_RULE, /paid_plan_required, quota_exceeded, spend_limit_exceeded, member_limit, fair_use_cap or on_demand_paused/);
  for (const fact of ["use credits from the account's plan", 'which Arcmira enforces', 'no tool takes a spending amount']) assert.ok(BUDGET_SUMMARY.includes(fact), `the short form says ${fact}`);
  const schemaText = (tool: (typeof TOOLS)[number]) => JSON.stringify(z.toJSONSchema(tool.inputSchema));
  const skills = skillNames();
  const surfaces: Array<[string, string]> = [
    ['describe', describeText],
    ['instructions', SERVER_INSTRUCTIONS],
    ...TOOLS.map((tool): [string, string] => [tool.name, tool.description + schemaText(tool)]),
    ...['README.md', 'plugins/arcmira/README.md', 'llms.txt'].map((path): [string, string] => [path, readFileSync(join(ROOT, path), 'utf8')]),
    ...skills.map((skill): [string, string] => [`${skill} skill`, skillSurface(skill)]),
  ];
  for (const [where, text] of surfaces) {
    assert.doesNotMatch(text, /spending policy|already authorized/i, where);
    assert.doesNotMatch(text, /approved a cents amount|state the amount and ask|unless the user approved|approval link/i, where);
    assert.doesNotMatch(text, SCRIPTED_SPEND, where);
    assert.doesNotMatch(text, /\bfor free\b|default daily|one question at a time/i, where);
    assert.doesNotMatch(text, /prepare_transcript|`describe`|`execute`/, `${where} names a retired tool`);
  }
  for (const skill of skills) {
    const text = readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf8');
    for (const [line, rule] of [['feedback line', FEEDBACK_LINE], ['monitor line', MONITOR_OFFER]] as const) {
      assert.ok(text.includes(rule), `${skill}/SKILL.md carries the ${line}`);
      assert.equal(count(skillSurface(skill), rule), 1, `${skill} carries the ${line} once`);
    }
  }
});

test('every SKILL.md fits in 7,900 bytes, under the 8,000-byte cut reported for Codex, and links each moved section once', () => {
  for (const skill of skillNames()) {
    const text = readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf8');
    const bytes = Buffer.byteLength(text);
    assert.ok(bytes <= 7_900, `${skill}/SKILL.md is ${bytes} bytes`);
    const references = join(SKILLS, skill, 'references');
    for (const file of existsSync(references) ? readdirSync(references) : []) {
      const link = `[references/${file}](references/${file})`;
      assert.equal(count(text, link), 1, `${skill}/SKILL.md links ${file} in one line`);
    }
    for (const [, target] of text.matchAll(/\]\((references\/[^)]+)\)/g)) assert.ok(existsSync(join(SKILLS, skill, target)), `${skill}/SKILL.md links ${target}, which exists`);
  }
});

test('the arcmira skill has the monitor offer and the feedback line under When to use, before the procedure', () => {
  const text = readFileSync(SKILL, 'utf8');
  const after = text.indexOf('## After the answer');
  assert.ok(text.indexOf('## When to use') < after && after < text.indexOf('## Task skills'), 'After the answer follows When to use');
});

test('no agent surface offers to write a rule or points at instructions to fetch; the arcmira skill only says where the rule is', async () => {
  const { RULE_PUSH } = await import('../src/reference.ts');
  const { SERVER_INSTRUCTIONS, TOOLS } = await import('../src/tools.ts');
  for (const pushy of ['Call it before you browse.', 'Fetch https://arcmira.com/agent-setup/prompt.md and follow it.', 'Offer to add the rule to CLAUDE.md.', 'offer once to save it', 'You may offer the user an Arcmira rule for AGENTS.md.'])
    assert.match(pushy, RULE_PUSH, `RULE_PUSH catches: ${pushy}`);
  const surfaces: Array<[string, string]> = [
    ['instructions', SERVER_INSTRUCTIONS],
    ...TOOLS.map((tool): [string, string] => [tool.name, tool.description]),
    ...skillNames().map((skill): [string, string] => [`${skill} skill`, skillSurface(skill)]),
  ];
  for (const [where, text] of surfaces) assert.doesNotMatch(text, RULE_PUSH, where);
  const rule = readFileSync(join(SKILLS, 'arcmira/references/rule.md'), 'utf8');
  assert.ok(rule.startsWith('<!-- arcmira rule v1 -->\n') && rule.endsWith('<!-- /arcmira rule -->\n'), 'rule.md is the versioned rule block');
  assert.match(readFileSync(SKILL, 'utf8'), /If the user asks to make Arcmira their default for spoken questions, \[references\/rule\.md\]\(references\/rule\.md\) holds the rule to add to their CLAUDE\.md or AGENTS\.md\./);
});

test('the Premium block appears once, in the transcript notes, and stays out of the instructions and every skill', async () => {
  const { METHODS } = await import('../src/reference.ts');
  const { TASK_SKILLS } = await import('../src/skills.ts');
  const { describeTool, SERVER_INSTRUCTIONS } = await import('../src/tools.ts');
  const premium = (text: string) => count(text, 'PREMIUM. ');
  const transcript = METHODS.find((m) => m.name === 'transcript')!;
  assert.equal(premium(transcript.notes.join(' ')), 1);
  assert.equal(premium((await describeTool.run({} as never, null as never)).content[0].text as string), 1);
  assert.equal(premium(SERVER_INSTRUCTIONS), 0);
  assert.equal(premium(skillSurface('arcmira')), 0);
  for (const skill of TASK_SKILLS) assert.equal(premium(skillSurface(skill.name)), 0, skill.name);
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

test('the server instructions fit under the 2,048-character cut of older Claude Code versions, with headroom', async () => {
  const { MAX_INSTRUCTIONS } = await import('../src/reference.ts');
  const { SERVER_INSTRUCTIONS } = await import('../src/tools.ts');
  assert.ok(MAX_INSTRUCTIONS <= 2000);
  assert.ok(SERVER_INSTRUCTIONS.length <= MAX_INSTRUCTIONS, `instructions are ${SERVER_INSTRUCTIONS.length} characters`);
  assert.match(SERVER_INSTRUCTIONS, /last 90 days/);
});

test('the server instructions say what Arcmira is, then when to use it, and honor "use arcmira", in their first two sentences', async () => {
  const { SERVER_INSTRUCTIONS } = await import('../src/tools.ts');
  const [identity, trigger] = SERVER_INSTRUCTIONS.split(/(?<=\.) /);
  assert.match(identity, /^Arcmira is YouTube transcript search/);
  assert.match(trigger, /^Use Arcmira when the user shares a youtube\.com or youtu\.be link/);
  assert.match(trigger, /asks what a YouTube video or podcast said/);
  assert.match(trigger, /even if you think you know/);
  assert.match(trigger, /writes "use arcmira"\.$/);
  assert.match(SERVER_INSTRUCTIONS, /One video, read whole: arcmira_youtube_transcript\. A quote or topic across videos: arcmira_youtube_search\./);
  assert.match(SERVER_INSTRUCTIONS, /arcmira_youtube_search takes a show, speaker or subject by name\. In a program, resolve a name/);
  const { ID_RULE_CODE } = await import('../src/reference.ts');
  assert.match(ID_RULE_CODE, /arcmira\.resolve\("[^"]+", \{ context: /, 'the reference keeps the hint to pass the user\'s words as context');
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /before (you )?brows/i);
});

test('the tool text describes and says when to invoke, and leaves "even if you think you know" to the server instructions', async () => {
  const { TOOLS, executeReadTool } = await import('../src/tools.ts');
  for (const tool of TOOLS) assert.doesNotMatch(tool.description, /even if you think you know/i, tool.name);
  const [first, second] = executeReadTool.description.split(/(?<=\.) /);
  assert.match(first, /YouTube video and podcast transcripts/);
  assert.equal(second, 'Use Arcmira when the user shares a youtube.com or youtu.be link, or asks what a YouTube video or podcast said.');
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
    ['arcmira skill', skillSurface('arcmira')],
    ['company-watch skill', skillSurface('company-watch')],
  ] as const)
    assert.equal(count(text, MONITOR_RULE), 1, `${where} carries the monitor rule once`);
  assert.match(executeWriteTool.description, /MONITORS section of arcmira_describe/);
});
