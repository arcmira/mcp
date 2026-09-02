export const RECENCY = ['recent', 'quarter', 'year', 'all'] as const;
export type Recency = (typeof RECENCY)[number];

const DAYS: Record<Exclude<Recency, 'all'>, number> = { recent: 30, quarter: 90, year: 365 };

/**
 * The publishedAfter a call sends. An explicit date wins; the shorthand is resolved on server
 * time because the agent's own clock is routinely wrong. Null means the whole index.
 */
export function resolvePublishedAfter(
  input: { recency?: Recency; publishedAfter?: string },
  now = new Date(),
): string | null {
  if (input.publishedAfter) return input.publishedAfter;
  if (!input.recency || input.recency === 'all') return null;
  const day = new Date(now.getTime() - DAYS[input.recency] * 86_400_000);
  return day.toISOString().slice(0, 10);
}
