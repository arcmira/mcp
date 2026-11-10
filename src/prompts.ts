import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

/**
 * Weekly jobs a user picks as a slash command (`/arcmira:weekly-brand-watch` in Claude Code, the + menu in
 * claude.ai). Each returns one user message: run the job once now, then hand back the job text and the steps to
 * schedule it. The user creates the schedule; nothing here creates one or tells a host to.
 */
export interface WeeklyJob {
  name: string;
  title: string;
  description: string;
  arg: { name: string; description: string };
  /** index: the last 7 days of search and mentions need a paid plan. transcripts: works on Free. */
  reads: 'index' | 'transcripts';
  /** Ad-read data is served in full on some plans only. */
  sponsors?: true;
  job: (value: string) => string;
}

const EACH = 'the exact line, who said it when Arcmira knows, the show, the date and the timestamped watch link';

export const WEEKLY_JOBS: readonly WeeklyJob[] = [
  {
    name: 'weekly-brand-watch',
    title: 'Weekly brand watch',
    description: 'A weekly job that finds what was said about your brands on YouTube and video podcasts, with the steps to schedule it.',
    arg: { name: 'names', description: 'Brand or company names, separated by commas' },
    reads: 'index',
    job: (names) =>
      `Use Arcmira to find what was said about ${names} on YouTube and video podcasts in the last 7 days. Leave out ad reads. Give me up to 5 moments per name. For each, show ${EACH}. If nothing new was said about a name, say so in one line.`,
  },
  {
    name: 'weekly-competitor-reads',
    title: 'Weekly competitor reads',
    description: "A weekly job that splits competitors' YouTube ad reads from unpaid recommendations, with the steps to schedule it.",
    arg: { name: 'names', description: 'Competitor names, separated by commas' },
    reads: 'index',
    sponsors: true,
    job: (names) =>
      `Use Arcmira to find ad reads and unpaid recommendations for ${names} on YouTube and video podcasts in the last 7 days. Split them into paid reads and organic mentions. For each, show the show, the date, the exact line, any promo code and the timestamped watch link. Flag any show that read an ad for one of them for the first time in 90 days.`,
  },
  {
    name: 'weekly-person-tracker',
    title: 'Weekly person tracker',
    description: 'A weekly job that collects what a person said, and what was said about them, on YouTube and video podcasts, with the steps to schedule it.',
    arg: { name: 'names', description: "People's names, separated by commas" },
    reads: 'index',
    job: (names) =>
      `Use Arcmira to find what ${names} said on YouTube and video podcasts in the last 7 days, and what others said about them. For each quote, show ${EACH}. Mark which lines are theirs and which are about them.`,
  },
  {
    name: 'weekly-sponsor-scout',
    title: 'Weekly sponsor scout',
    description: 'A weekly job that lists the brands that read ads on chosen YouTube channels and which are new, with the steps to schedule it.',
    arg: { name: 'channels', description: 'YouTube channel names or URLs, separated by commas' },
    reads: 'index',
    sponsors: true,
    job: (channels) =>
      `Use Arcmira to find which brands read ads on these YouTube channels in the last 7 days: ${channels}. Mark the brands that are new to each channel. For each read, show the brand, the channel, the date, the exact line and the timestamped watch link.`,
  },
  {
    name: 'weekly-show-digest',
    title: 'Weekly show digest',
    description: 'A weekly job that reads the new episodes of chosen shows and returns their most quotable lines, with the steps to schedule it.',
    arg: { name: 'shows', description: 'Show or channel names, separated by commas' },
    reads: 'transcripts',
    job: (shows) =>
      `Find the episodes these shows published on YouTube in the last 7 days: ${shows}. Use Arcmira's episode list, or a web search when that list doesn't reach this week. Read each new episode's transcript with Arcmira. For each episode, give me one sentence on what it covered and its 3 most quotable lines, each with the timestamped watch link.`,
  },
  {
    name: 'weekly-monitor-roundup',
    title: 'Weekly monitor roundup',
    description: 'A weekly job that rounds up the last 7 days for every name your Arcmira monitors follow, with the steps to schedule it.',
    arg: { name: 'slack_channel', description: 'Optional Slack channel to post the roundup to, such as #market-intel' },
    reads: 'index',
    job: (channel) =>
      `List my Arcmira monitors and the names each one follows. For each name, find what was said on YouTube and video podcasts in the last 7 days. Group the moments by name, at most 3 per name, each with ${EACH}.` +
      (channel ? ` Post the roundup to ${channel} with my Slack connector.` : ''),
  },
];

/** Checked against the Claude Code scheduled-tasks docs on 2026-11-07. */
export const SCHEDULE_STEPS = [
  'In Claude: open claude.ai/code/routines, click New task, paste the job, choose a weekly schedule, and pick a time a few minutes past the hour, such as 9:07. In Claude Code, /schedule does the same.',
  "Scheduled runs use claude.ai connectors. Add Arcmira at claude.ai/customize/connectors if it isn't there. A server added only with `claude mcp add` doesn't appear in scheduled runs.",
  'Scheduled tasks need a paid Claude plan. Each run also uses credits from my Arcmira plan.',
  "On another assistant, tell me how it schedules a task, or say it can't.",
];

const SPONSOR_NOTE = "If Arcmira says my plan can't read this, say so in one line and use what it did return.";

const FREE_INDEX_NOTE =
  "If Arcmira says my plan can't read those dates, say so in one line, then run the same search over the newest 7 days it can read.";

export function weeklyJobMessage(job: WeeklyJob, value: string): string {
  const given = value.trim();
  const optional = job.name === 'weekly-monitor-roundup';
  const job_text =
    job.job(given || (optional ? '' : `{${job.arg.name}}`)) +
    (job.reads === 'index' ? ` ${FREE_INDEX_NOTE}` : '') +
    (job.sponsors ? ` ${SPONSOR_NOTE}` : '');
  return [
    `I want a weekly Arcmira job: ${job.title}.`,
    optional ? '' : `${job.arg.description}: ${given || '(none given)'}. If none are given, or they look cut off, ask me for them before anything else.`,
    '1. Run the job below once now, so I can see what a week of it looks like.',
    '2. Then give me the job as one block I can paste into a scheduled task, with my names filled in.',
    '3. Then show me these steps for running it every week:',
    ...SCHEDULE_STEPS.map((step) => `   - ${step}`),
    '',
    'The job:',
    job_text,
  ]
    .filter((line, i) => line !== '' || i > 1)
    .join('\n');
}

export function registerWeeklyJobs(server: McpServer): void {
  for (const job of WEEKLY_JOBS) {
    server.registerPrompt(
      job.name,
      {
        title: job.title,
        description: job.description,
        argsSchema: z.object({ [job.arg.name]: z.string().optional().describe(job.arg.description) }),
      },
      (args: Record<string, string | undefined>) => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: weeklyJobMessage(job, args[job.arg.name] ?? '') } }],
      }),
    );
  }
}
