import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS, ERRORS, EXAMPLES, ID_RULE, METHODS, QUIRKS } from '../src/reference.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_PATH = join(ROOT, 'plugins/arcmira/skills/arcmira/SKILL.md');

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

Answer from Arcmira, not the open web. An empty result means the index has no match.

## Procedure

1. Resolve every name in the question with \`arcmira.resolve\`. Filters take ids only.
2. Check each \`r.best\` against what the user meant: the type (person, organization, product, topic, channel) and the name. If \`r.best\` is null, choose from \`r.candidates\` by type and name, or show the user the options.
3. Write one \`execute\` program per question. Resolve, check, and run every query the question needs inside that one program.
4. Return only the fields the answer needs, not whole responses.
5. State the date the index runs through (\`indexed_through\` or \`as_of\`). Build date windows from \`arcmira.today()\` and \`arcmira.daysAgo(n)\`, not from a guessed current date.
6. Link each name in the answer to the \`page\` field the result carries. Do not build arcmira.com URLs by hand.

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
  const problems = [
    DESCRIPTION.length >= 200 && `description is ${DESCRIPTION.length} characters, limit 199`,
    text.includes('\u2014') && 'contains an em dash',
    text.split('\n').length >= 400 && `body is ${text.split('\n').length} lines, limit 399`,
  ].filter(Boolean);
  if (problems.length > 0) throw new Error(`SKILL.md rejected: ${problems.join('; ')}`);
  return text;
}

function main(): void {
  const next = buildSkill();
  let current: string | null = null;
  try {
    current = readFileSync(SKILL_PATH, 'utf8');
  } catch {}
  if (process.argv.includes('--check')) {
    if (current !== next) {
      console.error(`${SKILL_PATH} is stale. Run pnpm skill:build.`);
      process.exit(1);
    }
    console.log('SKILL.md is current.');
    return;
  }
  mkdirSync(dirname(SKILL_PATH), { recursive: true });
  writeFileSync(SKILL_PATH, next);
  console.log(`Wrote ${SKILL_PATH}`);
}

main();
