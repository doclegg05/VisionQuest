import { bandRankedJobs, type JobBandingContext } from "./banded-matching";
import { parseTransferableSkillNames } from "./recommendation";
import type { JobRecommendation } from "./types";

/**
 * Response-level band tag for a job in GET /api/jobs.
 * `null` means no banding context applies (browse-pool job, or the student
 * has no CareerDiscovery to band against).
 */
export type JobBand = "core" | "stretch" | "wildcard";

/** The CareerDiscovery fields GET /api/jobs already selects. */
export interface JobBandDiscovery {
  readonly topClusters: string[];
  readonly hollandCode: string | null;
  readonly transferableSkills: string | null;
}

export function buildJobBandingContext(discovery: JobBandDiscovery): JobBandingContext {
  return {
    topClusters: discovery.topClusters,
    hollandCode: discovery.hollandCode,
    transferableSkills: parseTransferableSkillNames(discovery.transferableSkills),
  };
}

/**
 * Maps each recommendation's jobListingId to its band by partitioning the
 * already-ranked rankJobs() output with bandRankedJobs(). Withheld wildcard
 * recommendations belong to the wildcard band — the cap only limits the
 * dedicated wildcard display, not the per-job annotation.
 */
export function buildJobBandMap(
  recommendations: readonly JobRecommendation[],
  discovery: JobBandDiscovery,
): ReadonlyMap<string, JobBand> {
  const banded = bandRankedJobs(recommendations, buildJobBandingContext(discovery));
  const entries: Array<[string, JobBand]> = [
    ...banded.core.jobs.map((rec): [string, JobBand] => [rec.jobListingId, "core"]),
    ...banded.stretch.jobs.map((rec): [string, JobBand] => [rec.jobListingId, "stretch"]),
    ...banded.wildcard.jobs.map((rec): [string, JobBand] => [rec.jobListingId, "wildcard"]),
    ...banded.wildcard.withheld.map((rec): [string, JobBand] => [rec.jobListingId, "wildcard"]),
  ];
  return new Map(entries);
}

/**
 * Returns a new array where every job carries a `band`. Jobs without a
 * recommendation (browse-pool rows) and every job when the student has no
 * CareerDiscovery get `band: null`. Input jobs are not mutated; all
 * pre-existing fields are preserved.
 */
export function annotateJobsWithBands<T extends { readonly id: string }>(
  jobs: readonly T[],
  recommendations: readonly JobRecommendation[],
  discovery: JobBandDiscovery | null,
): Array<T & { band: JobBand | null }> {
  if (!discovery) {
    return jobs.map((job) => ({ ...job, band: null }));
  }
  const bandById = buildJobBandMap(recommendations, discovery);
  return jobs.map((job) => ({ ...job, band: bandById.get(job.id) ?? null }));
}
