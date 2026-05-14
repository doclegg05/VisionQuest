import { prismaAdmin as prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { matchJobToClusters } from "./cluster-matcher";
import type { JobScrapeTrigger, JobSourceAdapter, NormalizedJob } from "./types";
import { jsearchAdapter } from "./adapters/jsearch";
import { usajobsAdapter } from "./adapters/usajobs";
import { adzunaAdapter } from "./adapters/adzuna";
import { remotiveAdapter } from "./adapters/remotive";
import { remoteOkAdapter } from "./adapters/remoteok";
import { weWorkRemotelyAdapter } from "./adapters/weworkremotely";
import { arbeitnowAdapter } from "./adapters/arbeitnow";
import { ashbyAdapter, greenhouseAdapter, leverAdapter } from "./adapters/ats";
import { smartRecruitersAdapter } from "./adapters/smartrecruiters";

/** All registered adapters */
const ALL_ADAPTERS: JobSourceAdapter[] = [
  remotiveAdapter,
  remoteOkAdapter,
  weWorkRemotelyAdapter,
  arbeitnowAdapter,
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  smartRecruitersAdapter,
  jsearchAdapter,
  usajobsAdapter,
  adzunaAdapter,
];

interface RunScrapeOptions {
  scrapeRunId?: string;
  trigger?: JobScrapeTrigger;
  requestedById?: string | null;
  backgroundJobId?: string | null;
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

async function markScrapeRunFailed(scrapeRunId: string | null, error: string): Promise<void> {
  if (!scrapeRunId) return;
  await prisma.jobScrapeRun.update({
    where: { id: scrapeRunId },
    data: {
      status: "failed",
      error,
      completedAt: new Date(),
    },
  });
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

/**
 * Run a full scrape cycle for a single JobClassConfig.
 *
 * 1. Fetch jobs from all configured + available adapters
 * 2. Normalize and deduplicate
 * 3. Match to SPOKES career clusters
 * 4. Upsert into database
 * 5. Expire stale jobs not seen in 2 consecutive cycles
 */
export async function runScrapeForConfig(
  configId: string,
  options: RunScrapeOptions = {},
): Promise<number> {
  const config = await prisma.jobClassConfig.findUnique({
    where: { id: configId },
  });

  if (!config) {
    logger.error("JobClassConfig not found", { configId });
    await markScrapeRunFailed(options.scrapeRunId ?? null, "JobClassConfig not found");
    return 0;
  }

  const scrapeRun = await createOrStartScrapeRun(configId, options);
  const scrapeRunId = scrapeRun.id;

  // Filter to adapters that are both configured (env vars) and enabled (sources list)
  const activeAdapters = ALL_ADAPTERS.filter(
    (a) => a.isConfigured() && config.sources.includes(a.source),
  );

  await prisma.jobScrapeRun.update({
    where: { id: scrapeRunId },
    data: { totalSources: activeAdapters.length },
  });

  if (activeAdapters.length === 0) {
    logger.warn("No active adapters for config", { configId, sources: config.sources });
    await markScrapeRunFailed(scrapeRunId, "No active job sources are configured for this class.");
    return 0;
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

    // Deduplicate by sourceId
    const seen = new Set<string>();
    const uniqueJobs: NormalizedJob[] = [];
    for (const job of allJobs) {
      if (!seen.has(job.sourceId)) {
        seen.add(job.sourceId);
        uniqueJobs.push(job);
      }
    }

    const upsertedBySource = new Map<string, number>();

    // Upsert each job
    for (const job of uniqueJobs) {
      const clusters = matchJobToClusters(job);

      await prisma.jobListing.upsert({
        where: { sourceId: job.sourceId },
        create: {
          title: job.title,
          company: job.company,
          location: job.location,
          salary: job.salary,
          salaryMin: job.salaryMin,
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
          salary: job.salary,
          salaryMin: job.salaryMin,
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
          scrapeBatchId: { not: batchId },
          updatedAt: { lt: twoWeeksAgo },
        },
        data: { status: "expired" },
      });

      // Update config timestamp only when at least one source responded.
      await prisma.jobClassConfig.update({
        where: { id: configId },
        data: { lastScrapedAt: new Date() },
      });
    }

    await prisma.jobScrapeRun.update({
      where: { id: scrapeRunId },
      data: {
        status: finalStatus,
        completedSources,
        failedSources,
        totalFetched: allJobs.length,
        totalUpserted,
        error: finalError,
        completedAt: new Date(),
      },
    });

    logger.info("Scrape complete", { configId, totalUpserted });
    return totalUpserted;
  } catch (error) {
    const message = errorMessage(error);
    logger.error("Scrape failed", { configId, scrapeRunId, error: message });
    await markScrapeRunFailed(scrapeRunId, message);
    throw error;
  }
}

/**
 * Run scrape for all auto-refresh configs. Called by cron.
 */
export async function runAllAutoRefreshScrapes(): Promise<number> {
  const configs = await prisma.jobClassConfig.findMany({
    where: { autoRefresh: true },
    select: { id: true },
  });

  let total = 0;
  for (const config of configs) {
    total += await runScrapeForConfig(config.id);
  }
  return total;
}
