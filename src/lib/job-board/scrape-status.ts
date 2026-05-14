import type { JobScrapeRun, JobScrapeSourceResult } from "@prisma/client";
import type {
  JobSourceHealthResult,
  JobScrapeRunStatus,
  JobScrapeRunStatusResult,
  JobScrapeSourceStatus,
  JobScrapeTrigger,
} from "./types";
import type { JobSourceConfigurationStatus } from "./source-health";

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

export function buildSourceHealth(
  sourceConfig: JobSourceConfigurationStatus[],
  runs: ScrapeRunWithSources[],
): JobSourceHealthResult[] {
  return sourceConfig.map((config) => {
    const sourceResults = runs
      .flatMap((run) => run.sourceResults)
      .filter((source) => source.source === config.source)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const completedOrFailed = sourceResults.filter((source) =>
      source.status === "completed" || source.status === "failed"
    );
    const successCount = completedOrFailed.filter((source) => source.status === "completed").length;
    const latest = sourceResults[0] ?? null;

    return {
      source: config.source,
      label: config.label,
      selected: config.selected,
      configured: config.configured,
      recentRuns: completedOrFailed.length,
      successRate: completedOrFailed.length > 0
        ? Math.round((successCount / completedOrFailed.length) * 100)
        : null,
      lastStatus: latest ? latest.status as JobScrapeSourceStatus : null,
      lastFetchedCount: latest?.fetchedCount ?? 0,
      lastUpsertedCount: latest?.upsertedCount ?? 0,
      lastError: latest?.error ?? null,
      lastStartedAt: latest?.startedAt?.toISOString() ?? null,
      lastCompletedAt: latest?.completedAt?.toISOString() ?? null,
    };
  });
}
