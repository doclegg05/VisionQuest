import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { matchJobToClusters } from "./cluster-matcher";
import type { JobSourceAdapter, NormalizedJob } from "./types";
import { jsearchAdapter } from "./adapters/jsearch";
import { usajobsAdapter } from "./adapters/usajobs";
import { adzunaAdapter } from "./adapters/adzuna";
import { careerOneStopAdapter } from "./adapters/careeronestop";
import { recordProviderQuotaSnapshots, reserveSourceQuota, type JobSource } from "./limits";
import { buildJobFingerprint, dedupeJobsAcrossSources } from "./dedupe";

/** All registered adapters */
const ALL_ADAPTERS: JobSourceAdapter[] = [
  jsearchAdapter,
  usajobsAdapter,
  adzunaAdapter,
  careerOneStopAdapter,
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
  const configuredAdapters = ALL_ADAPTERS.filter(
    (a) => a.isConfigured() && config.sources.includes(a.source),
  );

  const activeAdapters: JobSourceAdapter[] = [];
  for (const adapter of configuredAdapters) {
    const quota = await reserveSourceQuota(adapter.source as JobSource);
    if (!quota.allowed) {
      logger.warn("Skipping adapter because scrape quota is exhausted", {
        configId,
        source: adapter.source,
        reason: quota.reason,
      });
      continue;
    }
    activeAdapters.push(adapter);
  }

  if (activeAdapters.length === 0) {
    logger.warn("No active adapters for config", { configId, sources: config.sources });
    return 0;
  }

  const batchId = `batch:${configId}:${Date.now()}`;
  let totalUpserted = 0;

  // Fetch from all adapters in parallel
  const adapterResults = await Promise.allSettled(
    activeAdapters.map((adapter) =>
      adapter.fetchJobs(config.region, config.radius).then((result) => ({
        source: adapter.source,
        jobs: result.jobs,
        quotaSnapshots: result.quotaSnapshots ?? [],
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
      await recordProviderQuotaSnapshots(
        result.value.source as JobSource,
        result.value.quotaSnapshots,
      );
      allJobs.push(...result.value.jobs);
    } else {
      logger.error("Adapter failed", { reason: String(result.reason) });
    }
  }

  // First dedupe exact source records, then consolidate cross-provider duplicates.
  const seenSourceIds = new Set<string>();
  const sourceUniqueJobs: NormalizedJob[] = [];
  for (const job of allJobs) {
    if (!seenSourceIds.has(job.sourceId)) {
      seenSourceIds.add(job.sourceId);
      sourceUniqueJobs.push(job);
    }
  }

  const { uniqueJobs, selectedByFingerprint } = dedupeJobsAcrossSources(sourceUniqueJobs);

  // Upsert each job
  for (const job of uniqueJobs) {
    const clusters = matchJobToClusters(job);

    await prisma.jobListing.upsert({
      where: {
        classConfigId_sourceId: {
          classConfigId: configId,
          sourceId: job.sourceId,
        },
      },
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

  const activeListings = await prisma.jobListing.findMany({
    where: {
      classConfigId: configId,
      status: "active",
    },
    select: {
      id: true,
      sourceId: true,
      title: true,
      company: true,
      location: true,
    },
  });

  const duplicateListingIds = activeListings
    .filter((listing) => {
      const fingerprint = buildJobFingerprint(listing);
      const selected = selectedByFingerprint.get(fingerprint);
      return selected && selected.sourceId !== listing.sourceId;
    })
    .map((listing) => listing.id);

  if (duplicateListingIds.length > 0) {
    await prisma.jobListing.updateMany({
      where: {
        id: { in: duplicateListingIds },
      },
      data: { status: "expired" },
    });
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
