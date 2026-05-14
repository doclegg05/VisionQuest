import type { JobScrapeRun, JobScrapeSourceResult } from "@prisma/client";
import type {
  JobScrapeRunStatus,
  JobScrapeRunStatusResult,
  JobScrapeSourceStatus,
  JobScrapeTrigger,
} from "./types";

type ScrapeRunWithSources = JobScrapeRun & {
  sourceResults: JobScrapeSourceResult[];
};

export function serializeScrapeRun(run: ScrapeRunWithSources): JobScrapeRunStatusResult {
  return {
    id: run.id,
    trigger: run.trigger as JobScrapeTrigger,
    status: run.status as JobScrapeRunStatus,
    requestedById: run.requestedById,
    backgroundJobId: run.backgroundJobId,
    totalSources: run.totalSources,
    completedSources: run.completedSources,
    failedSources: run.failedSources,
    totalFetched: run.totalFetched,
    totalUpserted: run.totalUpserted,
    error: run.error,
    queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    sourceResults: run.sourceResults.map((source) => ({
      id: source.id,
      source: source.source,
      status: source.status as JobScrapeSourceStatus,
      fetchedCount: source.fetchedCount,
      upsertedCount: source.upsertedCount,
      error: source.error,
      startedAt: source.startedAt?.toISOString() ?? null,
      completedAt: source.completedAt?.toISOString() ?? null,
    })),
  };
}
