import type { JobRecommendation } from "./types";

export const CORE_SCORE_THRESHOLD = 75;
export const DEFAULT_WILDCARD_CAP = 3;

export interface JobBandingContext {
  readonly topClusters: readonly string[];
  readonly hollandCode: string | null;
  readonly transferableSkills: readonly string[];
}

export interface RankedJobBand {
  readonly label: "Core" | "Stretch";
  readonly jobs: readonly JobRecommendation[];
}

export interface WildcardJobBand {
  readonly label: "Wildcard";
  readonly jobs: readonly JobRecommendation[];
  readonly withheld: readonly JobRecommendation[];
  readonly cap: number;
  readonly withheldCount: number;
}

export interface BandedJobRecommendations {
  readonly core: RankedJobBand;
  readonly stretch: RankedJobBand;
  readonly wildcard: WildcardJobBand;
}

function normalizeSignal(value: string): string {
  return value.trim().toLowerCase();
}

function hasDirectClusterOverlap(
  recommendation: JobRecommendation,
  topClusters: ReadonlySet<string>,
): boolean {
  return recommendation.clusterOverlap.some((cluster) => topClusters.has(cluster));
}

function hasTransferableSkillOverlap(
  recommendation: JobRecommendation,
  transferableSkills: ReadonlySet<string>,
): boolean {
  return recommendation.skillOverlap.some((skill) =>
    transferableSkills.has(normalizeSignal(skill)),
  );
}

function hasRiasecAlignment(
  recommendation: JobRecommendation,
  hollandCode: string | null,
): boolean {
  return Boolean(hollandCode) && recommendation.matchReasons.some((reason) => reason.type === "riasec");
}

/**
 * Partitions the already-ranked output of rankJobs() without changing its order.
 *
 * The wildcard band's `jobs` collection is the capped, displayable selection.
 * Remaining wildcard recommendations stay assigned to that same band in
 * `withheld`, with `withheldCount` making the cap explicit and auditable.
 */
export function bandRankedJobs(
  recommendations: readonly JobRecommendation[],
  context: JobBandingContext,
  wildcardCap: number = DEFAULT_WILDCARD_CAP,
): BandedJobRecommendations {
  if (!Number.isInteger(wildcardCap) || wildcardCap < 0) {
    throw new RangeError("wildcardCap must be a non-negative integer");
  }

  const topClusters = new Set(context.topClusters);
  const transferableSkills = new Set(
    context.transferableSkills.map(normalizeSignal).filter(Boolean),
  );

  const isCore = (recommendation: JobRecommendation): boolean =>
    hasDirectClusterOverlap(recommendation, topClusters) &&
    recommendation.score >= CORE_SCORE_THRESHOLD;

  const isStretch = (recommendation: JobRecommendation): boolean => {
    if (hasDirectClusterOverlap(recommendation, topClusters)) return false;
    return (
      hasTransferableSkillOverlap(recommendation, transferableSkills) ||
      hasRiasecAlignment(recommendation, context.hollandCode)
    );
  };

  const core = recommendations.filter(isCore);
  const stretch = recommendations.filter(isStretch);
  const wildcardCandidates = recommendations.filter(
    (recommendation) => !isCore(recommendation) && !isStretch(recommendation),
  );
  const wildcardJobs = wildcardCandidates.slice(0, wildcardCap);
  const withheld = wildcardCandidates.slice(wildcardCap);

  return {
    core: { label: "Core", jobs: core },
    stretch: { label: "Stretch", jobs: stretch },
    wildcard: {
      label: "Wildcard",
      jobs: wildcardJobs,
      withheld,
      cap: wildcardCap,
      withheldCount: withheld.length,
    },
  };
}
