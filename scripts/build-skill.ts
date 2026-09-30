import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS, ERRORS, EXAMPLES, ID_RULE, METHODS, QUIRKS } from '../src/reference.ts';
import { PICK_STEPS, TASK_SKILLS, type TaskSkill } from '../src/skills.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, 'plugins/arcmira/skills');

const NAME = 'arcmira';
const DESCRIPTION =
  'Answers what YouTube shows and podcasts said: transcripts, who was mentioned, sponsors, recommendations, momentum. Use for the arcmira MCP server or CLI.';

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function methodTable(): string {
  const rows = METHODS.map(
    (m) => `| \`${m.name}\` | \`${cell(m.signature)}\` | \`${cell(m.returns)}\` | ${cell(m.notes.join(' ')) || ' '} |`,
  );
  return ['| Method | Call | Returns | Notes |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

function examples(): string {
  return EXAMPLES.map((e) => `### ${e.title}\n\n\`\`\`javascript\n${e.code}\n\`\`\``).join('\n\n');
}

function buildSkill(): string {
  const text = `---
name: ${NAME}
description: ${JSON.stringify(DESCRIPTION)}
---

# Arcmira

Arcmira indexes YouTube and podcast transcripts and keeps a catalog of who is mentioned on which show, who sponsors whom, and who recommends what on air. The arcmira MCP server exposes two tools. \`describe\` returns the client reference. \`execute\` runs a JavaScript program against the \`arcmira\` client and returns what the program returns.

## When to use

Use this skill when the user asks:

- what a show, channel, or episode said about a topic, or for a transcript;
- whether a person, company, or product was mentioned, how often, and where;
- who sponsors a show, or which shows a brand sponsors;
- who recommends a product on air, sponsored or organic;
- whether talk about something is accelerating or fading;
- how to use the arcmira MCP server or the arcmira CLI.

This server holds the transcript data. For anything said on a show, use it before any web search, and answer from Arcmira, not the open web. An empty result means the index has no match.

## Procedure

1. Resolve every name in the question with \`arcmira.resolve\`. Filters take ids only.
2. Check each \`r.best\` against what the user meant and against the other candidates: the type (person, organization, product, topic, channel), the name, and the appearance count. When \`r.best\` is null or a close candidate competes, show the user a short list (name, type, one distinguishing fact) or check each candidate against the data. A bare first name is always ambiguous: list the people it could be with their counts. A name that resolves to nothing, or only to a similar name, is not in the index: say so and offer the nearest names. Say in the answer which entity you used.
3. Before asserting a mention, read its description or passage and say which sense of the name it is (Mercury the bank, not the element).
4. Write one \`execute\` program per question. Resolve, check, and run every query the question needs inside that one program.
5. Return only the fields the answer needs, not whole responses.
6. State the date the index runs through (\`indexed_through\` or \`as_of\`). Build date windows from \`arcmira.today()\` and \`arcmira.daysAgo(n)\`, not from a guessed current date.
7. Link each name in the answer to the \`page\` field the result carries. Do not build arcmira.com URLs by hand.

## The ID rule

\`\`\`
${ID_RULE}
\`\`\`

## Methods

Every method is async and returns parsed JSON. The program runs as the body of an async function with \`arcmira\` and \`ArcmiraError\` in scope. \`arcmira.today()\` returns "YYYY-MM-DD" on the server clock. \`arcmira.daysAgo(n)\` returns the ISO date n days ago.

${methodTable()}

The arcmira CLI (npm package \`arcmira\`) has commands with the same names. \`arcmira sponsors UC... --min-ad-reads 3\` is the shell form of \`arcmira.sponsors(id, { minAdReads: 3 })\`.

## Worked examples

Each block is a complete program to pass to the \`execute\` tool.

${examples()}

## Quirks

${QUIRKS.map((q) => `- ${q}`).join('\n')}

## Errors

${ERRORS}

## Docs

- API reference: ${DOCS.api}
- MCP guide: ${DOCS.mcp}
- Error codes: ${DOCS.errors}
- OpenAPI: ${DOCS.openapi}
- Agent index: ${DOCS.llms}
`;
  return text;
}

function taskSkill(t: TaskSkill): string {
  return `---
name: ${t.name}
description: ${JSON.stringify(t.description)}
---

# ${t.title}

${t.summary}

Use it through the arcmira MCP server (\`describe\`, then \`execute\` with a program) or the arcmira CLI, whose commands have the same names. The \`arcmira\` skill and \`describe\` carry the full method reference.

## When to use

${t.asks.map((a) => `- ${a}`).join('\n')}

## Pick the entity the user meant

Users give names; filters take ids only (ent_..., UC..., 11-character video ids), and a name where an id belongs throws \`id_required\`.

${PICK_STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n')}

For this task:

${t.ids.map((s) => `- ${s}`).join('\n')}

## Worked program

Pass each block to \`execute\` as one program, with the name swapped for the user's. It opens with the pick: when close candidates compete it returns \`choose\` and runs nothing else. Pick from that list by the user's context or ask them, then run it again with \`ID\` set to the pick. Build date windows from \`arcmira.daysAgo(n)\` and \`arcmira.today()\`.

${t.programs.map((p) => `### ${p.title}\n\n\`\`\`javascript\n${p.code}\n\`\`\``).join('\n\n')}

## A good answer

${t.good.map((g) => `- ${g}`).join('\n')}

## Traps

${t.traps.map((g) => `- ${g}`).join('\n')}

Plan gates throw with \`.unlock.url\`: relay the link. Never fill a gap from memory or the web. Docs: ${DOCS.mcp}
`;
}

/** Every skill the plugin ships, by folder name, with the checks that keep the always-on listing small. */
export function buildAll(): Map<string, string> {
  const out = new Map<string, string>([[NAME, buildSkill()], ...TASK_SKILLS.map((t) => [t.name, taskSkill(t)] as [string, string])]);
  const problems: string[] = [];
  for (const [name, text] of out) {
    const description = name === NAME ? DESCRIPTION : TASK_SKILLS.find((t) => t.name === name)!.description;
    if (description.length >= 200) problems.push(`${name}: description is ${description.length} characters, limit 199`);
    if (!/arcmira/i.test(description)) problems.push(`${name}: description must name Arcmira (the CLI refreshes only skills that do)`);
    if (text.includes('\u2014')) problems.push(`${name}: contains an em dash`);
    if (text.split('\n').length >= 400) problems.push(`${name}: body is ${text.split('\n').length} lines, limit 399`);
  }
  if (problems.length > 0) throw new Error(`SKILL.md rejected: ${problems.join('; ')}`);
  return out;
}

function main(): void {
  const stale: string[] = [];
  for (const [name, next] of buildAll()) {
    const path = join(SKILLS_DIR, name, 'SKILL.md');
    let current: string | null = null;
    try {
      current = readFileSync(path, 'utf8');
    } catch {}
    if (current === next) continue;
    if (process.argv.includes('--check')) {
      stale.push(path);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
    console.log(`Wrote ${path}`);
  }
  if (stale.length > 0) {
    console.error(`${stale.join(', ')} stale. Run pnpm skill:build.`);
    process.exit(1);
  }
  if (process.argv.includes('--check')) console.log('Every SKILL.md is current.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
