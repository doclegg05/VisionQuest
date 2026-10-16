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

type AgeFilter = { lt: Date } | { gte: Date };

/**
 * A run or job's age counts from when work on it began: its claim (startedAt)
 * once it is processing, its creation while it still waits. A job queued for
 * an hour and claimed a minute ago is live, so it is judged by the minute.
 * Runs and jobs use the same clock, so a run is never retired while its job
 * stays live and keeps the dedupe key.
 */
function runAgeWhere(age: AgeFilter): Prisma.JobScrapeRunWhereInput[] {
  return [
    { status: "queued", createdAt: age },
    { status: "processing", startedAt: age },
  ];
}

function scrapeJobAgeWhere(age: AgeFilter): Prisma.BackgroundJobWhereInput[] {
  return [
    { status: "pending", createdAt: age },
    { status: "processing", startedAt: age },
  ];
}

function windowStart(now: Date): Date {
  return new Date(now.getTime() - SCRAPE_RUN_IN_PROGRESS_WINDOW_MS);
}

/**
 * Where-clause for "this class already has a scrape queued or running".
 * Shared by the weekly sweep (scrape-engine.ts), which skips such a class,
 * and the teacher's Refresh route, which re-kicks the existing run instead
 * of queuing another. It is the complement of what retireStaleScrapeRuns
 * fails, so after retirement every queued or processing run counts here.
 */
export function scrapeRunInProgressWhere(classConfigId: string, now: Date): Prisma.JobScrapeRunWhereInput {
  return { classConfigId, OR: runAgeWhere({ gte: windowStart(now) }) };
}

/** The BackgroundJob dedupe key for a class's manual refresh. */
export function scrapeJobDedupeKey(classConfigId: string, sources: string[] = []): string {
  const base = `scrape:${classConfigId}`;
  return sources.length > 0 ? `${base}:${sources.join(",")}` : base;
}

/**
 * Fail a class's scrape runs and scrape_jobs background jobs that are still
 * queued, pending or processing past the in-progress window, counted from
 * when work on each began (runAgeWhere).
 *
 * A crash mid-scrape leaves both in "processing" for good. enqueueJob dedupes
 * on any pending or processing job with the same key, and processJobById
 * claims only pending jobs, so without this a replacement run would attach
 * to the dead job and never start. Both writes share one transaction, so a
 * run is never failed while its job keeps the dedupe key. Runs through
 * prismaAdmin because BackgroundJob is admin-only under RLS.
 *
 * This cannot stop a handler that is still alive. The processor writes a
 * job's result only while its claim holds the row (finishClaimedJob in
 * src/lib/jobs.ts), so a late handler leaves the retired job failed.
 */
export async function retireStaleScrapeRuns(
  classConfigId: string,
  now: Date,
): Promise<{ runs: number; jobs: number }> {
  const stale = { lt: windowStart(now) };
  const dedupeKey = scrapeJobDedupeKey(classConfigId);
  const [runs, jobs] = await prismaAdmin.$transaction([
    prismaAdmin.jobScrapeRun.updateMany({
      where: { classConfigId, OR: runAgeWhere(stale) },
      data: { status: "failed", error: STALE_RUN_ERROR, completedAt: now },
    }),
    prismaAdmin.backgroundJob.updateMany({
      where: {
        type: "scrape_jobs",
        AND: [
          { OR: [{ dedupeKey }, { dedupeKey: { startsWith: `${dedupeKey}:` } }] },
          { OR: scrapeJobAgeWhere(stale) },
        ],
      },
      data: { status: "failed", error: STALE_RUN_ERROR, completedAt: now },
    }),
  ]);
  return { runs: runs.count, jobs: jobs.count };
}
