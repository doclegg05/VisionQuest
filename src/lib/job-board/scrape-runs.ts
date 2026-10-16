import type { Prisma } from "@prisma/client";

/**
 * A scrape run older than this is treated as crashed, not in progress.
 * Nothing moves a run that died mid-scrape (a deploy or restart) out of
 * "processing", and one class's scrape takes minutes, so two hours is
 * generous without letting a dead run block the class for good.
 */
export const SCRAPE_RUN_IN_PROGRESS_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Where-clause for "this class already has a scrape queued or running".
 * Shared by the weekly sweep (scrape-engine.ts), which skips such a class,
 * and the teacher's Refresh route, which re-kicks the existing run instead
 * of queuing another.
 */
export function scrapeRunInProgressWhere(classConfigId: string, now: Date): Prisma.JobScrapeRunWhereInput {
  return {
    classConfigId,
    status: { in: ["queued", "processing"] },
    createdAt: { gte: new Date(now.getTime() - SCRAPE_RUN_IN_PROGRESS_WINDOW_MS) },
  };
}
