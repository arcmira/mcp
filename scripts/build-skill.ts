import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCESS_GUIDANCE, BUDGET_RULE, COVERAGE_GUIDANCE, DOCS, FEEDBACK_LINE, ID_RULE, MONITOR_RULE } from '../src/reference.ts';
import { PICK_STEPS, SAVE_OFFER, TASK_SKILLS, type TaskSkill } from '../src/skills.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, 'plugins/arcmira/skills');

const NAME = 'arcmira';
const DESCRIPTION =
  'Answers what YouTube shows and podcasts said: transcripts, who was mentioned, sponsors, recommendations, momentum. Use for the arcmira MCP server or CLI.';

/** How every skill ends (rules 5 and 6b): the save-to-monitor offer, then the feedback line. */
const CLOSING = `## After the answer

${SAVE_OFFER}

${FEEDBACK_LINE}`;

/** How a program that opens with the pick block is rerun after an ask. */
const PICK_INTRO = " It opens with the pick: set `CONTEXT` to the user's own words about the name. When several entities fit it returns `ask` and runs nothing else. Show those options to the user, then run it again with `ID` set to the pick.";

/** The task skill's listing line without its trailing "Uses arcmira.", so the routing list says what each one is for. */
const purpose = (t: TaskSkill): string => t.description.replace(/\s*Uses arcmira\.$/, '');

/**
 * The core skill carries the procedure and points at describe for the method reference, so a host that
 * loads both pays for the reference once. Gemini CLI loads this file as always-on context.
 */
function buildSkill(): string {
  const text = `---
name: ${NAME}
description: ${JSON.stringify(DESCRIPTION)}
---

# Arcmira

Arcmira indexes YouTube and podcast transcripts and keeps a catalog of who is mentioned on which show, who sponsors whom, and who recommends what on air. The arcmira MCP server exposes four tools. \`arcmira_describe\` returns the client reference: every method with its arguments and return fields, worked programs, quirks and error codes. \`arcmira_execute_read\` runs a JavaScript program against the \`arcmira\` client and returns what the program returns; Premium transcripts included. \`arcmira_execute_write\` runs the same client plus the monitor writes. \`arcmira_feedback\` tells Arcmira what went wrong. The arcmira CLI has commands with the same names; \`arcmira <command> --help\`, \`arcmira schema <command>\` and \`arcmira examples\` are its reference.

## When to use

Use this skill when the user asks:

- what a show, channel, or episode said about a topic, or for a transcript;
- whether a person, company, or product was mentioned, how often, and where;
- who sponsors a show, or which shows a brand sponsors;
- who recommends a product on air, sponsored or organic;
- whether talk about something is accelerating or fading;
- to be kept posted on a company, person or topic;
- how to use the arcmira MCP server or the arcmira CLI.

Use Arcmira for the indexed transcript research the user requested. Cite returned passages and keep evidence from other sources distinct. An empty result means this query returned no matches.

## Task skills

When the ask matches one of these, load that skill and follow its worked program:

${TASK_SKILLS.map((t) => `- \`${t.name}\`: ${purpose(t)}`).join('\n')}

Anything else (one video's transcript, a topic across shows, who recommends a product on air) follows the procedure below.

## Procedure

1. Call \`arcmira_describe\` once before your first program. It is current on every call; \`arcmira_describe({ topic })\` narrows it to one method.
2. Resolve every name in the question with \`arcmira.resolve\`, passing the user's own words about the name as \`context\` when they gave any. Filters take ids only.
3. Act on the one answer resolve gives. \`best\`: use it and name it. \`suggested\`: use it and tell the user you assumed it, quoting \`suggested.evidence\`. \`ask\`: return \`ask.options\` for the user to pick and stop, or check every option id against the data in one program and answer per row. None of the three: the name is not in the index; say so and ask for another spelling or a link. Say in the answer which entity you used.
4. Before asserting a mention, read its description or passage and say which sense of the name it is (Mercury the bank, not the element).
5. Write one \`arcmira_execute_read\` program per question. Resolve, check, and run every query the question needs inside that one program.
6. Return only the fields the answer needs, not whole responses.
7. ${COVERAGE_GUIDANCE} Build date windows from \`arcmira.today()\` and \`arcmira.daysAgo(n)\`. When the user names no window, use the last 30 days; a week of the index is often thin.
8. Link each name in the answer to the \`page\` field the result carries. Do not build arcmira.com URLs by hand.
9. Premium: \`arcmira.transcript(video, { quality: "premium" })\` returns the lines. When the video is not transcribed yet, that read uses credits from the user's plan, then the on-demand budget. A Premium request is the go-ahead; do not ask. Still pending: tell the user the \`eta_seconds\` it returns, then read again once it has passed.
10. ${BUDGET_RULE}

## Monitors

${MONITOR_RULE}

## The ID rule

\`\`\`
${ID_RULE}
\`\`\`

## Access

${ACCESS_GUIDANCE}

## Docs

- API reference: ${DOCS.api}
- MCP guide: ${DOCS.mcp}
- Error codes: ${DOCS.errors}
- OpenAPI: ${DOCS.openapi}
- Agent index: ${DOCS.llms}

${CLOSING}
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

Use it through the arcmira MCP server (\`arcmira_describe\`, then \`arcmira_execute_read\` with a program) or the arcmira CLI, whose commands have the same names. \`arcmira_describe\` carries the full method reference (CLI: \`arcmira <command> --help\`), and the \`arcmira\` skill the shared procedure.

## When to use

${t.asks.map((a) => `- ${a}`).join('\n')}

## Pick the entity the user meant

Users give names; filters take ids only (ent_..., UC..., 11-character video ids), and a name where an id belongs throws \`id_required\`.

${PICK_STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n')}

For this task:

${t.ids.map((s) => `- ${s}`).join('\n')}
${t.steps ? `\n## Steps\n\n${t.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n` : ''}
## Worked program

Pass each block to \`arcmira_execute_read\` as one program (a block marked arcmira_execute_write goes to that tool), with the name swapped for the user's.${t.programs.some((p) => /\bIDS? = /.test(p.code)) ? PICK_INTRO : ''} When the result carries \`assumed: true\`, tell the user which entity was assumed and why (\`why\`). Build date windows from \`arcmira.daysAgo(n)\` and \`arcmira.today()\`.

${t.programs.map((p) => `### ${p.title}\n\n\`\`\`javascript\n${p.code}\n\`\`\``).join('\n\n')}

## A good answer

${t.good.map((g) => `- ${g}`).join('\n')}

## Traps

${t.traps.map((g) => `- ${g}`).join('\n')}

${ACCESS_GUIDANCE}

${COVERAGE_GUIDANCE}

Keep outside evidence separate from Arcmira results. Docs: ${DOCS.mcp}

${CLOSING}
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
    if (!text.trimEnd().endsWith(FEEDBACK_LINE)) problems.push(`${name}: does not end with the feedback line`);
    if (/approved a cents amount|state the amount and ask/i.test(text)) problems.push(`${name}: asks the user for a cents amount`);
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
