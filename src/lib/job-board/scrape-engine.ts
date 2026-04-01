import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { matchJobToClusters } from "./cluster-matcher";
import type { JobSourceAdapter, NormalizedJob } from "./types";
import { jsearchAdapter } from "./adapters/jsearch";
import { usajobsAdapter } from "./adapters/usajobs";
import { adzunaAdapter } from "./adapters/adzuna";

/** All registered adapters */
const ALL_ADAPTERS: JobSourceAdapter[] = [
  jsearchAdapter,
  usajobsAdapter,
  adzunaAdapter,
];

/**
 * Run a full scrape cycle for a single JobClassConfig.
 *
 * 1. Fetch jobs from all configured + available adapters
 * 2. Normalize and deduplicate
 * 3. Match to SPOKES career clusters
 * 4. Upsert into database
 * 5. Expire stale jobs not seen in 2 consecutive cycles
 */
export async function runScrapeForConfig(configId: string): Promise<number> {
  const config = await prisma.jobClassConfig.findUnique({
    where: { id: configId },
  });

  if (!config) {
    logger.error("JobClassConfig not found", { configId });
    return 0;
  }

  // Filter to adapters that are both configured (env vars) and enabled (sources list)
  const activeAdapters = ALL_ADAPTERS.filter(
    (a) => a.isConfigured() && config.sources.includes(a.source),
  );

  if (activeAdapters.length === 0) {
    logger.warn("No active adapters for config", { configId, sources: config.sources });
    return 0;
  }

  const batchId = `batch:${configId}:${Date.now()}`;
  let totalUpserted = 0;

  // Fetch from all adapters in parallel
  const adapterResults = await Promise.allSettled(
    activeAdapters.map((adapter) =>
      adapter.fetchJobs(config.region, config.radius).then((jobs) => ({
        source: adapter.source,
        jobs,
      })),
    ),
  );

  const allJobs: NormalizedJob[] = [];
  for (const result of adapterResults) {
    if (result.status === "fulfilled") {
      logger.info("Adapter fetched jobs", {
        source: result.value.source,
        count: result.value.jobs.length,
      });
      allJobs.push(...result.value.jobs);
    } else {
      logger.error("Adapter failed", { reason: String(result.reason) });
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
  }

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

  // Update config timestamp
  await prisma.jobClassConfig.update({
    where: { id: configId },
    data: { lastScrapedAt: new Date() },
  });

  logger.info("Scrape complete", { configId, totalUpserted });
  return totalUpserted;
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
