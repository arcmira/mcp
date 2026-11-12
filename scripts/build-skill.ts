import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUDGET_RULE, COVERAGE_GUIDANCE, DOCS, FEEDBACK_LINE, ID_RULE_ANSWERS, ID_RULE_CODE, ID_RULE_HEAD, MONITOR_OFFER, MONITOR_RULE, RULE_PUSH, SCRIPTED_SPEND } from '../src/reference.ts';
import { PICK_STEPS, TASK_SKILLS, type Program, type TaskSkill } from '../src/skills.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, 'plugins/arcmira/skills');

/** A host may cut a long SKILL.md (one report puts Codex at 8,000 bytes), so what does not fit goes to references/. */
export const SKILL_MAX_BYTES = 7_900;

const NAME = 'arcmira';
const DESCRIPTION =
  'YouTube transcript search and monitoring. Use Arcmira when asked what a YouTube video or podcast said, or when the user writes "use arcmira": exact quotes, often who said it, transcripts, sponsors.';

/** The monitor line, where company-watch sets one up, then the feedback line. Task skills end with it; the arcmira skill has it under When to use. */
function closing(name: string, fact?: string): string {
  return `## After the answer

${MONITOR_OFFER}${name === 'company-watch' ? '' : ' The `company-watch` skill sets one up.'}

${fact ? `${fact}\n\n` : ''}${FEEDBACK_LINE}`;
}

/** A file in the skill's references folder: its whole text, and the title its SKILL.md line names it by. */
interface Reference {
  file: string;
  title: string;
  text: string;
}

const referencePath = (r: Reference): string => `references/${r.file}`;
const link = (r: Reference): string => `[${referencePath(r)}](${referencePath(r)})`;
const pointer = (r: Reference): string => `${r.title}: ${link(r)}`;
const page = (title: string, body: string): string => `# ${title}\n\n${body}\n`;

const programBlocks = (programs: readonly Program[]): string =>
  programs.map((p) => `### ${p.title}\n\n\`\`\`javascript\n${p.code}\n\`\`\``).join('\n\n');

/**
 * The arcmira skill's sections that live in references/. The ID rule and the monitor rule are the copies describe also
 * carries, and the procedure calls describe first.
 */
const ROOT_REFERENCES: readonly Reference[] = [
  { file: 'monitors.md', title: 'Monitors', text: page('Monitors', MONITOR_RULE) },
  {
    file: 'id-rule.md',
    title: 'The ID rule',
    text: page('The ID rule', `${ID_RULE_HEAD}\n\n\`\`\`javascript\n${ID_RULE_CODE}\n\`\`\`\n\n${ID_RULE_ANSWERS}`),
  },
  {
    file: 'docs.md',
    title: 'Docs',
    text: page(
      'Docs',
      `- API reference: ${DOCS.api}
- MCP guide: ${DOCS.mcp}
- Error codes: ${DOCS.errors}
- OpenAPI: ${DOCS.openapi}
- Agent index: ${DOCS.llms}`,
    ),
  },
];

/**
 * The rule a user can paste into CLAUDE.md or AGENTS.md. The skill states that the file exists and never offers to
 * write it: Anthropic's Software Directory Policy bars changing Claude's behavior across sessions (1G) and pulling
 * behavioral instructions from external sources (2F).
 */
const RULE_REFERENCE: Reference = {
  file: 'rule.md',
  title: 'The Arcmira rule',
  text: `<!-- arcmira rule v1 -->
## Arcmira: YouTube Transcript Search

Use Arcmira (the arcmira MCP server, tools named arcmira_*) when the user asks what was said in a YouTube video or a podcast on YouTube. That includes a youtube.com or youtu.be link the user wants summarized, quoted or clipped. That covers a quote, when someone said it, which episodes mentioned a person, company or product, and who sponsors a show. Use it even when you think you know the answer, because your training data does not hold last week's episodes and a web page rarely gives the timestamp. When the user writes "use arcmira", call it for that question.

Search covers only the videos Arcmira indexes, so an empty search proves nothing about what was said. Arcmira can still read the transcript of a YouTube video the user names. Arcmira often names who said it; when it doesn't, don't guess the speaker.

Do not use it for a video's view count or upload date alone, for song lyrics, or for a transcript the user already pasted.
<!-- /arcmira rule -->
`,
};

const RULE_FACT = `If the user asks to make Arcmira their default for spoken questions, ${link(RULE_REFERENCE)} holds the rule to add to their CLAUDE.md or AGENTS.md.`;

function taskReference(t: TaskSkill): Reference | null {
  if (!t.reference) return null;
  const { file, title, rule, programs } = t.reference;
  return {
    file,
    title,
    text: page(title, `${rule ? `${rule}\n\n` : ''}Pass each block as one program to the tool its title names, with the names swapped for the user's.\n\n${programBlocks(programs)}`),
  };
}

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

Arcmira indexes YouTube transcripts, podcasts on YouTube included, and keeps a catalog of who is mentioned on which show, who sponsors whom, and who recommends what on air. The arcmira MCP server exposes six tools. \`arcmira_describe\` returns the client reference: every method with its arguments and return fields, worked programs, quirks and error codes. \`arcmira_execute_read\` runs a JavaScript program against the \`arcmira\` client and returns what the program returns, and only reads. \`arcmira_execute_write\` runs the same client plus the monitor writes, and starts Premium transcripts and translations. \`arcmira_youtube_search\` and \`arcmira_youtube_transcript\` search and read transcripts in one call each, with no program. \`arcmira_feedback\` tells Arcmira what went wrong. The arcmira CLI has commands with the same names; \`arcmira <command> --help\`, \`arcmira schema <command>\` and \`arcmira examples\` are its reference.

## When to use

Use Arcmira when the user asks:

- what a show, channel, or episode said about a topic, or for a transcript;
- whether a person, company, or product was mentioned, how often, and where;
- who sponsors a show, or which shows a brand sponsors;
- who recommends a product on air, sponsored or organic;
- whether talk about something is accelerating or fading;
- to be kept posted on a company, person or topic;
- how to use the arcmira MCP server or the arcmira CLI.

Use Arcmira for the indexed transcript research the user requested. Cite returned passages and keep evidence from other sources distinct. An empty result means this query returned no matches.

${closing(NAME, RULE_FACT)}

## Task skills

When the ask matches one of these, load that skill and follow its worked program:

${TASK_SKILLS.map((t) => `- \`${t.name}\`: ${purpose(t)}`).join('\n')}

Anything else (one video's transcript, a topic across shows, who recommends a product on air) follows the procedure below.

## Procedure

1. Call \`arcmira_describe\` once before your first program. It is current on every call; \`arcmira_describe({ topic })\` narrows it to one method.
2. A topic or phrase goes in \`query\` as typed. Resolve a name with \`arcmira.resolve\` when it becomes a filter: who said it, which show, or what it is about. Filters take ids only, as the ID rule says.
3. Before asserting a mention, read its description or passage and say which sense of the name it is (Mercury the bank, not the element).
4. Write one \`arcmira_execute_read\` program per question. Resolve, check, and run every query the question needs inside that one program.
5. Return only the fields the answer needs, not whole responses.
6. ${COVERAGE_GUIDANCE} Build date windows from \`arcmira.today()\` and \`arcmira.daysAgo(n)\`. When the user names no window, use the last 90 days, and narrow it when a name returns more than the answer needs.
7. Link each name in the answer to the \`page\` field the result carries. Do not build arcmira.com URLs by hand.
8. Premium: \`arcmira.transcript(video, { quality: "premium" })\` returns the lines. When the video is not transcribed yet, that read in \`arcmira_execute_write\` starts a transcription. In \`arcmira_execute_read\` it throws \`write_tool_required\`, and nothing is charged. Still pending: \`eta_seconds\` says about how long; read again once it has passed.
9. ${BUDGET_RULE}

## References

${ROOT_REFERENCES.map((r) => `- ${pointer(r)}`).join('\n')}
`;
  return text;
}

function taskSkill(t: TaskSkill): string {
  const reference = taskReference(t);
  return `---
name: ${t.name}
description: ${JSON.stringify(t.description)}
---

# ${t.title}

${t.summary}

Run each program with \`arcmira_execute_read\`; \`arcmira_describe\` has the method reference.

## When to use

Use Arcmira when the user asks:

${t.asks.map((a) => `- ${a}`).join('\n')}

## Pick the entity the user meant

Users give names; filters take ids only (ent_..., UC..., 11-character video ids), and a name where an id belongs throws \`id_required\`.

${PICK_STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n')}

For this task:

${t.ids.map((s) => `- ${s}`).join('\n')}
${t.steps ? `\n## Steps\n\n${t.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n` : ''}${reference ? `\n${pointer(reference)}.\n` : ''}
## Worked program

Pass each block to \`arcmira_execute_read\` as one program (a block marked arcmira_execute_write goes to that tool), with the name swapped for the user's.${t.programs.some((p) => /\bIDS? = /.test(p.code)) ? PICK_INTRO : ''} Build date windows from \`arcmira.daysAgo(n)\` and \`arcmira.today()\`.

${programBlocks(t.programs)}

## A good answer

${t.good.map((g) => `- ${g}`).join('\n')}

## Traps

${t.traps.map((g) => `- ${g}`).join('\n')}

Docs: ${DOCS.mcp}

${closing(t.name)}
`;
}

/**
 * Every file the plugin's skills ship, by path under plugins/arcmira/skills: each SKILL.md and its references,
 * with the checks that keep the always-on listing small and every SKILL.md whole.
 */
export function buildAll(): Map<string, string> {
  const skills = [
    { name: NAME, description: DESCRIPTION, text: buildSkill(), references: [...ROOT_REFERENCES, RULE_REFERENCE] },
    ...TASK_SKILLS.map((t) => ({ name: t.name, description: t.description, text: taskSkill(t), references: [taskReference(t)].filter((r) => r !== null) })),
  ];
  const out = new Map<string, string>();
  const problems: string[] = [];
  for (const { name, description, text, references } of skills) {
    const files: Array<[string, string]> = [[`${name}/SKILL.md`, text], ...references.map((r): [string, string] => [`${name}/${referencePath(r)}`, r.text])];
    const surface = files.map(([, body]) => body).join('\n');
    const bytes = Buffer.byteLength(text);
    if (description.length >= 200) problems.push(`${name}: description is ${description.length} characters, limit 199`);
    if (!/arcmira/i.test(description)) problems.push(`${name}: description must name Arcmira (the CLI refreshes only skills that do)`);
    if (bytes > SKILL_MAX_BYTES) problems.push(`${name}: SKILL.md is ${bytes} bytes, limit ${SKILL_MAX_BYTES}; move a section to references/`);
    if (surface.includes('\u2014')) problems.push(`${name}: contains an em dash`);
    if (surface.split(FEEDBACK_LINE).length !== 2 || !text.includes(FEEDBACK_LINE)) problems.push(`${name}: SKILL.md must carry the feedback line once`);
    if (SCRIPTED_SPEND.test(surface)) problems.push(`${name}: scripts what to ask or say about spend`);
    if (RULE_PUSH.test(surface)) problems.push(`${name}: offers to write a rule or points at instructions to fetch (${surface.match(RULE_PUSH)![0]})`);
    if (text.split('\n').length >= 400) problems.push(`${name}: body is ${text.split('\n').length} lines, limit 399`);
    for (const [path, body] of files) out.set(path, body);
  }
  if (problems.length > 0) throw new Error(`SKILL.md rejected: ${problems.join('; ')}`);
  return out;
}

function main(): void {
  const check = process.argv.includes('--check');
  const files = buildAll();
  const stale: string[] = [];
  for (const [file, next] of files) {
    const path = join(SKILLS_DIR, file);
    let current: string | null = null;
    try {
      current = readFileSync(path, 'utf8');
    } catch {}
    if (current === next) continue;
    if (check) {
      stale.push(path);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
    console.log(`Wrote ${path}`);
  }
  const orphans = readdirSync(SKILLS_DIR, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.md') && !files.has(file));
  if (orphans.length > 0) {
    console.error(`${orphans.map((file) => join(SKILLS_DIR, file)).join(', ')} not generated by scripts/build-skill.ts. Delete it.`);
    process.exit(1);
  }
  if (stale.length > 0) {
    console.error(`${stale.join(', ')} stale. Run pnpm skill:build.`);
    process.exit(1);
  }
  if (check) console.log('Every SKILL.md and reference file is current.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
