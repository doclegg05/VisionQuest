import type { CareerDiscovery, JobListing } from "@prisma/client";
import type { JobRecommendation } from "./types";

/**
 * Scores a job listing against a student's CareerDiscovery profile.
 *
 * Weights:
 *   Location proximity: 40% (job in student's class region = full points)
 *   Cluster match:      40% (overlap of job clusters with student topClusters)
 *   RIASEC alignment:   20% (job's inferred Holland codes vs student hollandCode)
 *
 * Students without CareerDiscovery data get score = 0 (no recommendations).
 */

const WEIGHT_LOCATION = 40;
const WEIGHT_CLUSTER = 40;
const WEIGHT_RIASEC = 20;

/**
 * Simple RIASEC inference for a job based on its cluster IDs.
 * Maps clusters to their most likely Holland codes.
 */
const CLUSTER_RIASEC: Record<string, string> = {
  "office-admin": "CSE",
  "finance-bookkeeping": "CEI",
  "tech-digital": "IRC",
  "creative-design": "AES",
  "customer-service": "SEC",
  "career-readiness": "SCE",
  "language-esl": "SAC",
};

function inferJobHollandCode(clusters: string[]): string {
  if (clusters.length === 0) return "";
  return CLUSTER_RIASEC[clusters[0]] ?? "";
}

function scoreLocation(jobLocation: string, classRegion: string): number {
  if (!classRegion || !jobLocation) return 0;
  // Simple: check if job location contains the class region city/state
  const regionLower = classRegion.toLowerCase().split(",")[0].trim();
  return jobLocation.toLowerCase().includes(regionLower) ? WEIGHT_LOCATION : 0;
}

function scoreCluster(jobClusters: string[], studentTopClusters: string[]): number {
  if (studentTopClusters.length === 0 || jobClusters.length === 0) return 0;
  const overlap = jobClusters.filter((c) => studentTopClusters.includes(c));
  const ratio = Math.min(overlap.length / Math.max(studentTopClusters.length, 1), 1);
  return Math.round(ratio * WEIGHT_CLUSTER);
}

function scoreRiasec(jobHolland: string, studentHolland: string | null): number {
  if (!studentHolland || !jobHolland) return 0;
  const jobChars = jobHolland.split("");
  const studentChars = studentHolland.split("");
  const overlap = jobChars.filter((c) => studentChars.includes(c));
  const ratio = overlap.length / Math.max(jobChars.length, 1);
  return Math.round(ratio * WEIGHT_RIASEC);
}

function getMatchLabel(score: number): "Strong match" | "Good match" | null {
  if (score >= 75) return "Strong match";
  if (score >= 50) return "Good match";
  return null;
}

export function scoreJob(
  job: Pick<JobListing, "id" | "location" | "clusters">,
  discovery: Pick<CareerDiscovery, "topClusters" | "hollandCode"> | null,
  classRegion: string,
): JobRecommendation {
  if (!discovery) {
    return { jobListingId: job.id, score: 0, matchLabel: null, clusterOverlap: [] };
  }

  const locationScore = scoreLocation(job.location, classRegion);
  const clusterScore = scoreCluster(job.clusters, discovery.topClusters);
  const jobHolland = inferJobHollandCode(job.clusters);
  const riasecScore = scoreRiasec(jobHolland, discovery.hollandCode);
  const totalScore = locationScore + clusterScore + riasecScore;

  const clusterOverlap = job.clusters.filter((c) => discovery.topClusters.includes(c));

  return {
    jobListingId: job.id,
    score: totalScore,
    matchLabel: getMatchLabel(totalScore),
    clusterOverlap,
  };
}

/**
 * Score and rank all jobs for a student. Returns sorted by score descending.
 */
export function rankJobs(
  jobs: Pick<JobListing, "id" | "location" | "clusters">[],
  discovery: Pick<CareerDiscovery, "topClusters" | "hollandCode"> | null,
  classRegion: string,
): JobRecommendation[] {
  return jobs
    .map((job) => scoreJob(job, discovery, classRegion))
    .sort((a, b) => b.score - a.score);
}
