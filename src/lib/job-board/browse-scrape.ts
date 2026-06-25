import { prismaAdmin as prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { matchJobToClusters } from "./cluster-matcher";
import { filterQualityJobs } from "./job-quality";
import { normalizeJobWorkMode } from "./work-mode";
import { inferEmploymentType } from "./employment-type";
import { resolveExpiry } from "./freshness";
import { browseAdapters } from "./browse-sources";
import type { JobSourceAdapter, NormalizedJob } from "./types";

interface RunBrowseRefreshOptions {
  now?: Date;
  adapters?: JobSourceAdapter[];
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Fetch keyless sources and refresh the program-wide browse pool. */
export async function runBrowseRefresh(
  options: RunBrowseRefreshOptions = {},
): Promise<{ upserted: number; expired: number; failedSources: number }> {
  const now = options.now ?? new Date();
  const adapters = options.adapters ?? browseAdapters();
  const batchId = `browse:${now.getTime()}`;

  const settled = await Promise.allSettled(
    adapters.map((a) => a.fetchJobs("", 0)),
  );

  const allJobs: NormalizedJob[] = [];
  let failedSources = 0;
  for (const r of settled) {
    if (r.status === "fulfilled") allJobs.push(...r.value);
    else {
      failedSources++;
      logger.error("Browse adapter failed", { reason: String(r.reason) });
    }
  }

  const normalized = allJobs.map((job) => ({
    ...job,
    workMode: normalizeJobWorkMode(job.workMode, job),
    employmentType: job.employmentType ?? inferEmploymentType(job),
  }));
  const quality = filterQualityJobs(normalized);

  let upserted = 0;
  for (const job of quality.jobs) {
    const postedAt = toDate(job.postedAt);
    const clusters = matchJobToClusters(job);
    await prisma.jobBrowseListing.upsert({
      where: { source_sourceId: { source: job.source, sourceId: job.sourceId } },
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
        postedAt,
        expiresAt: resolveExpiry(postedAt, now),
        scrapeBatchId: batchId,
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
        postedAt,
        expiresAt: resolveExpiry(postedAt, now),
        scrapeBatchId: batchId,
        updatedAt: now,
      },
    });
    upserted++;
  }

  // Expire anything past its expiresAt — resolveExpiry always sets a concrete date at ingest.
  const expiredResult = await prisma.jobBrowseListing.updateMany({
    where: { status: "active", expiresAt: { lt: now } },
    data: { status: "expired" },
  });

  logger.info("Browse refresh complete", { upserted, failedSources, expired: expiredResult.count });
  return { upserted, expired: expiredResult.count, failedSources };
}
