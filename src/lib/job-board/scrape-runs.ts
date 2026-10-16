import type { Prisma } from "@prisma/client";
import { prismaAdmin } from "@/lib/db";

/**
 * A scrape run older than this is treated as crashed, not in progress.
 * Nothing moves a run that died mid-scrape (a deploy or restart) out of
 * "processing", and one class's scrape takes minutes, so two hours is
 * generous without letting a dead run block the class for good.
 */
export const SCRAPE_RUN_IN_PROGRESS_WINDOW_MS = 2 * 60 * 60 * 1000;

const STALE_RUN_ERROR = "Stopped: no result after two hours. A new refresh replaces it.";

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

/** The BackgroundJob dedupe key for a class's manual refresh. */
export function scrapeJobDedupeKey(classConfigId: string, sources: string[] = []): string {
  const base = `scrape:${classConfigId}`;
  return sources.length > 0 ? `${base}:${sources.join(",")}` : base;
}

/**
 * Fail a class's scrape runs and scrape_jobs background jobs that are older
 * than the in-progress window and still queued, pending or processing.
 *
 * A crash mid-scrape leaves both in "processing" for good. enqueueJob dedupes
 * on any pending or processing job with the same key, and processJobById
 * claims only pending jobs, so without this a replacement run would attach
 * to the dead job and never start. Both writes share one transaction, so a
 * run is never failed while its job keeps the dedupe key. Runs through
 * prismaAdmin because BackgroundJob is admin-only under RLS.
 */
export async function retireStaleScrapeRuns(
  classConfigId: string,
  now: Date,
): Promise<{ runs: number; jobs: number }> {
  const cutoff = new Date(now.getTime() - SCRAPE_RUN_IN_PROGRESS_WINDOW_MS);
  const dedupeKey = scrapeJobDedupeKey(classConfigId);
  const [runs, jobs] = await prismaAdmin.$transaction([
    prismaAdmin.jobScrapeRun.updateMany({
      where: {
        classConfigId,
        status: { in: ["queued", "processing"] },
        createdAt: { lt: cutoff },
      },
      data: { status: "failed", error: STALE_RUN_ERROR, completedAt: now },
    }),
    prismaAdmin.backgroundJob.updateMany({
      where: {
        type: "scrape_jobs",
        status: { in: ["pending", "processing"] },
        createdAt: { lt: cutoff },
        OR: [{ dedupeKey }, { dedupeKey: { startsWith: `${dedupeKey}:` } }],
      },
      data: { status: "failed", error: STALE_RUN_ERROR, completedAt: now },
    }),
  ]);
  return { runs: runs.count, jobs: jobs.count };
}
