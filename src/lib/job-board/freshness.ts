/** Maximum age (days) a job may have before it is considered stale. */
export const MAX_JOB_AGE_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute an expiry timestamp for a job at ingest time.
 * Prefers the source's posted date; falls back to scrape time.
 */
export function resolveExpiry(
  postedAt: Date | null,
  scrapedAt: Date,
  ttlDays: number = MAX_JOB_AGE_DAYS,
): Date {
  const base = postedAt ?? scrapedAt;
  return new Date(base.getTime() + ttlDays * DAY_MS);
}

/**
 * Whether a job is fresh enough to show. Unknown posted dates are kept
 * (null = keep) so we never silently hide listings whose age we can't verify.
 */
export function isFresh(
  postedAt: Date | null,
  now: Date,
  maxAgeDays: number = MAX_JOB_AGE_DAYS,
): boolean {
  if (postedAt === null) return true;
  return now.getTime() - postedAt.getTime() <= maxAgeDays * DAY_MS;
}
