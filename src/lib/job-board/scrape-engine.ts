import type { Prisma } from "@prisma/client";
import { prismaAdmin as prisma } from "@/lib/db";
import { errorForLog } from "@/lib/log-error";
import { retireStaleScrapeRuns, scrapeRunInProgressWhere } from "./scrape-runs";
import { logger } from "@/lib/logger";
import { matchJobToClusters } from "./cluster-matcher";
import { filterQualityJobs } from "./job-quality";
import { groupDuplicateJobs } from "./duplicates";
import { ALL_JOB_SOURCE_ADAPTERS } from "./adapters/registry";
import { classifyJobProximity } from "./recommendation";
import { normalizeJobWorkMode } from "./work-mode";
import { inferEmploymentType } from "./employment-type";
import type { JobScrapeTrigger, NormalizedJob } from "./types";

interface RunScrapeOptions {
  scrapeRunId?: string;
  trigger?: JobScrapeTrigger;
  requestedById?: string | null;
  backgroundJobId?: string | null;
  sourceAllowlist?: string[];
}

/**
 * How one class's scrape ended, for the weekly sweep's counts. Only
 * "completed" refreshed listings; "no_sources" is a class whose sources all
 * need an API key that is not set, expected until those keys exist.
 * "retired" is a run retireStaleScrapeRuns failed while it was still going:
 * its listings were written, but the run stays failed.
 */
type ScrapeOutcome = "completed" | "all_sources_failed" | "no_sources" | "config_missing" | "retired";

interface ScrapeResult {
  outcome: ScrapeOutcome;
  totalUpserted: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createOrStartScrapeRun(
  configId: string,
  options: RunScrapeOptions,
) {
  const now = new Date();
  if (options.scrapeRunId) {
    return prisma.jobScrapeRun.update({
      where: { id: options.scrapeRunId },
      data: {
        status: "processing",
        startedAt: now,
        error: null,
        backgroundJobId: options.backgroundJobId ?? undefined,
      },
    });
  }

  return prisma.jobScrapeRun.create({
    data: {
      classConfigId: configId,
      trigger: options.trigger ?? "auto",
      requestedById: options.requestedById ?? null,
      backgroundJobId: options.backgroundJobId ?? null,
      status: "processing",
      startedAt: now,
    },
  });
}

type ScrapeRunResult = Prisma.JobScrapeRunUpdateManyMutationInput & { status: "completed" | "failed" };

/**
 * Write a run's result, only while the run is still open (queued or
 * processing). retireStaleScrapeRuns fails a run that has gone two hours,
 * and a slow scrape can still be alive when it does; writing anyway would
 * turn the retired run back into "completed" beside the replacement that
 * Refresh queued, or swap the retirement's error for the scrape's. Returns
 * whether the write landed.
 */
async function finishScrapeRun(scrapeRunId: string, result: ScrapeRunResult): Promise<boolean> {
  const { count } = await prisma.jobScrapeRun.updateMany({
    where: { id: scrapeRunId, status: { in: ["queued", "processing"] } },
    data: result,
  });
  if (count === 0) {
    logger.warn("Scrape run already finished; its result was not written", {
      scrapeRunId,
      status: result.status,
    });
  }
  return count > 0;
}

async function markScrapeRunFailed(scrapeRunId: string | null, error: string): Promise<void> {
  if (!scrapeRunId) return;
  await finishScrapeRun(scrapeRunId, { status: "failed", error, completedAt: new Date() });
}

async function startSourceResult(scrapeRunId: string, source: string): Promise<void> {
  await prisma.jobScrapeSourceResult.upsert({
    where: { scrapeRunId_source: { scrapeRunId, source } },
    create: {
      scrapeRunId,
      source,
      status: "processing",
      startedAt: new Date(),
    },
    update: {
      status: "processing",
      fetchedCount: 0,
      upsertedCount: 0,
      error: null,
      startedAt: new Date(),
      completedAt: null,
    },
  });
}

async function completeSourceResult(
  scrapeRunId: string,
  source: string,
  fetchedCount: number,
): Promise<void> {
  await prisma.jobScrapeSourceResult.update({
    where: { scrapeRunId_source: { scrapeRunId, source } },
    data: {
      status: "completed",
      fetchedCount,
      completedAt: new Date(),
    },
  });
}

async function failSourceResult(scrapeRunId: string, source: string, error: string): Promise<void> {
  await prisma.jobScrapeSourceResult.update({
    where: { scrapeRunId_source: { scrapeRunId, source } },
    data: {
      status: "failed",
      error,
      completedAt: new Date(),
    },
  });
}

async function expireDuplicateActiveListings(configId: string): Promise<number> {
  const activeListings = await prisma.jobListing.findMany({
    where: { classConfigId: configId, status: "active" },
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      source: true,
      workMode: true,
      salaryMin: true,
      updatedAt: true,
      _count: { select: { savedByStudents: true } },
    },
  });

  const duplicateIds = groupDuplicateJobs(activeListings).flatMap((group) => {
    if (group.jobs.length <= 1) return [];

    const sorted = [...group.jobs].sort((a, b) => {
      const savedDiff = b._count.savedByStudents - a._count.savedByStudents;
      if (savedDiff !== 0) return savedDiff;
      if (a.id === group.primary.id) return -1;
      if (b.id === group.primary.id) return 1;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    return sorted.slice(1).map((job) => job.id);
  });

  if (duplicateIds.length === 0) return 0;

  await prisma.jobListing.updateMany({
    where: { id: { in: duplicateIds } },
    data: { status: "expired" },
  });

  return duplicateIds.length;
}

/**
 * Run a full scrape cycle for a single JobClassConfig.
 *
 * 1. Fetch jobs from all configured + available adapters
 * 2. Normalize and deduplicate
 * 3. Match to SPOKES career clusters
 * 4. Upsert into database
 * 5. Expire stale jobs not seen in 2 consecutive cycles
 */
async function scrapeConfig(configId: string, options: RunScrapeOptions): Promise<ScrapeResult> {
  const config = await prisma.jobClassConfig.findUnique({
    where: { id: configId },
  });

  if (!config) {
    logger.error("JobClassConfig not found", { configId });
    await markScrapeRunFailed(options.scrapeRunId ?? null, "JobClassConfig not found");
    return { outcome: "config_missing", totalUpserted: 0 };
  }

  const scrapeRun = await createOrStartScrapeRun(configId, options);
  const scrapeRunId = scrapeRun.id;

  // Filter to adapters that are both configured (env vars) and enabled (sources list)
  const allowedSources = options.sourceAllowlist ? new Set(options.sourceAllowlist) : null;
  const activeAdapters = ALL_JOB_SOURCE_ADAPTERS.filter(
    (a) => a.isConfigured() && config.sources.includes(a.source) && (!allowedSources || allowedSources.has(a.source)),
  );

  await prisma.jobScrapeRun.update({
    where: { id: scrapeRunId },
    data: { totalSources: activeAdapters.length },
  });

  if (activeAdapters.length === 0) {
    logger.warn("No active adapters for config", { configId, sources: config.sources });
    await markScrapeRunFailed(scrapeRunId, "No active job sources are configured for this class.");
    return { outcome: "no_sources", totalUpserted: 0 };
  }

  try {
    const batchId = `batch:${configId}:${Date.now()}`;
    let totalUpserted = 0;

    await Promise.all(activeAdapters.map((adapter) => startSourceResult(scrapeRunId, adapter.source)));

    // Fetch from all adapters in parallel
    const adapterResults = await Promise.allSettled(
      activeAdapters.map(async (adapter) => {
        try {
          const jobs = await adapter.fetchJobs(config.region, config.radius);
          await completeSourceResult(scrapeRunId, adapter.source, jobs.length);
          return { source: adapter.source, jobs };
        } catch (error) {
          const message = errorMessage(error);
          await failSourceResult(scrapeRunId, adapter.source, message);
          throw new Error(`${adapter.source}: ${message}`);
        }
      }),
    );

    const allJobs: NormalizedJob[] = [];
    let failedSources = 0;
    for (const result of adapterResults) {
      if (result.status === "fulfilled") {
        logger.info("Adapter fetched jobs", {
          source: result.value.source,
          count: result.value.jobs.length,
        });
        allJobs.push(...result.value.jobs);
      } else {
        failedSources++;
        logger.error("Adapter failed", { reason: errorMessage(result.reason) });
      }
    }

    const normalizedJobs = allJobs.map((job) => ({
      ...job,
      workMode: normalizeJobWorkMode(job.workMode, job),
      employmentType: job.employmentType ?? inferEmploymentType(job),
    }));
    const quality = filterQualityJobs(normalizedJobs);
    if (quality.rejected.length > 0) {
      logger.info("Filtered low-quality job listings", {
        configId,
        rejected: quality.rejected.length,
        reasons: quality.rejected.reduce<Record<string, number>>((counts, entry) => {
          counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
          return counts;
        }, {}),
      });
    }

    // When the class is in "local_only" mode, reject jobs that don't classify
    // as local to the configured region. This stops mixed-mode sources (e.g.
    // SmartRecruiters, Greenhouse) from polluting the database with out-of-
    // region jobs that the teacher has explicitly opted out of.
    const localOnly = config.localJobPriority === "local_only";
    const acceptedJobs = localOnly
      ? quality.jobs.filter((job) => classifyJobProximity(job, config.region) === "local")
      : quality.jobs;
    if (localOnly && acceptedJobs.length < quality.jobs.length) {
      logger.info("Filtered non-local jobs (local_only mode)", {
        configId,
        region: config.region,
        rejected: quality.jobs.length - acceptedJobs.length,
        accepted: acceptedJobs.length,
      });
    }

    const upsertedBySource = new Map<string, number>();

    // Upsert each job
    for (const job of acceptedJobs) {
      const clusters = matchJobToClusters(job);

      await prisma.jobListing.upsert({
        // VQ-R-018: was `{ sourceId: job.sourceId }` alone — a bare,
        // program-wide key whose loose match let one class's scrape
        // overwrite another class's row in place with its own content
        // (see the migration header for the corrected mechanism). Scoped
        // to match the (classConfigId, source, sourceId) compound unique —
        // a true mirror of JobBrowseListing's own (source, sourceId) key.
        where: {
          classConfigId_source_sourceId: {
            classConfigId: configId,
            source: job.source,
            sourceId: job.sourceId,
          },
        },
        create: {
          title: job.title,
          company: job.company,
          location: job.location,
          workMode: job.workMode,
          salary: job.salary,
          salaryMin: job.salaryMin,
          employmentType: job.employmentType,
          description: job.description,
          url: job.url,
          source: job.source,
          sourceType: job.sourceType,
          sourceId: job.sourceId,
          clusters,
          status: "active",
          scrapeBatchId: batchId,
          classConfigId: configId,
        },
        update: {
          title: job.title,
          company: job.company,
          location: job.location,
          workMode: job.workMode,
          salary: job.salary,
          salaryMin: job.salaryMin,
          employmentType: job.employmentType,
          description: job.description,
          clusters,
          status: "active",
          scrapeBatchId: batchId,
          updatedAt: new Date(),
        },
      });
      totalUpserted++;
      upsertedBySource.set(job.source, (upsertedBySource.get(job.source) ?? 0) + 1);
    }

    await Promise.all(
      [...upsertedBySource.entries()].map(([source, upsertedCount]) =>
        prisma.jobScrapeSourceResult.update({
          where: { scrapeRunId_source: { scrapeRunId, source } },
          data: { upsertedCount },
        }),
      ),
    );

    const completedSources = activeAdapters.length - failedSources;
    const finalStatus = completedSources === 0 ? "failed" : "completed";
    const finalError = finalStatus === "failed" ? "All active job sources failed." : null;

    if (completedSources > 0) {
      // Expire jobs not refreshed in this batch (stale from previous cycles)
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      await prisma.jobListing.updateMany({
        where: {
          classConfigId: configId,
          status: "active",
          source: { in: activeAdapters.map((adapter) => adapter.source) },
          scrapeBatchId: { not: batchId },
          updatedAt: { lt: twoWeeksAgo },
        },
        data: { status: "expired" },
      });

      const expiredDuplicates = await expireDuplicateActiveListings(configId);
      if (expiredDuplicates > 0) {
        logger.info("Expired duplicate active job listings", { configId, expiredDuplicates });
      }

      // Expire any active jobs that no longer match local_only policy. This
      // handles the case where a teacher switches from prefer_local to
      // local_only with previously-scraped non-local jobs already in the DB —
      // without this, those Dallas jobs would persist until the 2-week stale
      // sweep removes them.
      if (localOnly) {
        const remainingActive = await prisma.jobListing.findMany({
          where: { classConfigId: configId, status: "active" },
          select: { id: true, location: true, workMode: true, source: true },
        });
        const nonLocalIds = remainingActive
          .filter((job) => classifyJobProximity(job, config.region) !== "local")
          .map((job) => job.id);
        if (nonLocalIds.length > 0) {
          await prisma.jobListing.updateMany({
            where: { id: { in: nonLocalIds } },
            data: { status: "expired" },
          });
          logger.info("Expired non-local active jobs (local_only mode)", {
            configId,
            expired: nonLocalIds.length,
          });
        }
      }

      // Update config timestamp only when at least one source responded.
      await prisma.jobClassConfig.update({
        where: { id: configId },
        data: { lastScrapedAt: new Date() },
      });
    }

    const finished = await finishScrapeRun(scrapeRunId, {
      status: finalStatus,
      completedSources,
      failedSources,
      totalFetched: allJobs.length,
      totalUpserted,
      error: finalError,
      completedAt: new Date(),
    });

    logger.info("Scrape complete", { configId, totalUpserted });
    if (!finished) return { outcome: "retired", totalUpserted };
    return { outcome: finalStatus === "failed" ? "all_sources_failed" : "completed", totalUpserted };
  } catch (error) {
    const message = errorMessage(error);
    logger.error("Scrape failed", { configId, scrapeRunId, error: message });
    await markScrapeRunFailed(scrapeRunId, message);
    throw error;
  }
}

/** Scrape one class and return how many listings it upserted. */
export async function runScrapeForConfig(configId: string, options: RunScrapeOptions = {}): Promise<number> {
  return (await scrapeConfig(configId, options)).totalUpserted;
}

export interface AutoRefreshSummary {
  totalJobs: number;
  scrapedConfigs: number;
  /** Classes with a recent run already queued or processing. */
  skippedConfigs: number;
  /** Classes whose scrape threw or whose every source failed; logged, and the sweep went on. */
  failedConfigs: number;
  /** Classes with no source that can run (an API key is not set). Not a failure. */
  unconfiguredConfigs: number;
}

async function hasRunInProgress(configId: string, now: Date): Promise<boolean> {
  const run = await prisma.jobScrapeRun.findFirst({
    where: scrapeRunInProgressWhere(configId, now),
    select: { id: true },
  });
  return run !== null;
}

const EMPTY_SUMMARY: AutoRefreshSummary = {
  totalJobs: 0,
  scrapedConfigs: 0,
  skippedConfigs: 0,
  failedConfigs: 0,
  unconfiguredConfigs: 0,
};

function withOutcome(summary: AutoRefreshSummary, configId: string, result: ScrapeResult): AutoRefreshSummary {
  const totalJobs = summary.totalJobs + result.totalUpserted;
  if (result.outcome === "completed") {
    return { ...summary, totalJobs, scrapedConfigs: summary.scrapedConfigs + 1 };
  }
  if (result.outcome === "no_sources") {
    return { ...summary, totalJobs, unconfiguredConfigs: summary.unconfiguredConfigs + 1 };
  }
  logger.error("Auto-refresh scrape failed for class config", { configId, outcome: result.outcome });
  return { ...summary, totalJobs, failedConfigs: summary.failedConfigs + 1 };
}

async function refreshOneConfig(summary: AutoRefreshSummary, configId: string): Promise<AutoRefreshSummary> {
  try {
    const now = new Date();
    await retireStaleScrapeRuns(configId, now);
    if (await hasRunInProgress(configId, now)) {
      return { ...summary, skippedConfigs: summary.skippedConfigs + 1 };
    }
    return withOutcome(summary, configId, await scrapeConfig(configId, {}));
  } catch (error) {
    logger.error("Auto-refresh scrape failed for class config", {
      configId,
      error: errorForLog(error),
    });
    return { ...summary, failedConfigs: summary.failedConfigs + 1 };
  }
}

/**
 * Run scrape for all auto-refresh configs. Called weekly by the pg_cron job
 * `job-board-scrape` through POST /api/internal/jobs/scrape.
 *
 * One class's failure is logged and counted, and the sweep moves on to the
 * next class. A class whose teacher just pressed Refresh is skipped, as the
 * manual route does (src/app/api/teacher/jobs/refresh/route.ts); a run more
 * than two hours old is failed first, with its background job, so it never
 * blocks the class or the teacher's next Refresh. A class
 * whose sources all lack an API key is counted apart from failures, so the
 * job does not read as broken while the CareerOneStop and Talroo keys are
 * pending.
 */
export async function runAllAutoRefreshScrapes(): Promise<AutoRefreshSummary> {
  const configs = await prisma.jobClassConfig.findMany({
    where: { autoRefresh: true },
    select: { id: true },
  });

  let summary = EMPTY_SUMMARY;
  for (const config of configs) {
    summary = await refreshOneConfig(summary, config.id);
  }
  return summary;
}
