import { CAREER_CLUSTERS } from "@/lib/spokes/career-clusters";
import type { NormalizedJob } from "./types";

/**
 * Matches a job listing to SPOKES career clusters using:
 * 1. Signal keyword matching against job title + description
 * 2. Sample job title matching against cluster sampleJobs
 *
 * Returns cluster IDs sorted by relevance (most keywords matched first).
 */
export function matchJobToClusters(job: NormalizedJob): string[] {
  const searchText = `${job.title} ${job.description}`.toLowerCase();

  const scored: { id: string; score: number }[] = [];

  for (const cluster of CAREER_CLUSTERS) {
    let score = 0;

    // Keyword matching: each matching keyword adds 1 point
    for (const keyword of cluster.signalKeywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        score += 1;
      }
    }

    // Sample job title matching: exact title match in the job title adds 5 points
    for (const sampleJob of cluster.sampleJobs) {
      if (job.title.toLowerCase().includes(sampleJob.toLowerCase())) {
        score += 5;
      }
    }

    if (score > 0) {
      scored.push({ id: cluster.id, score });
    }
  }

  // Sort by score descending, return cluster IDs
  return scored
    .sort((a, b) => b.score - a.score)
    .map((s) => s.id);
}

/**
 * Batch match multiple jobs to clusters.
 */
export function matchJobsToClusters(jobs: NormalizedJob[]): Map<string, string[]> {
  const results = new Map<string, string[]>();
  for (const job of jobs) {
    results.set(job.sourceId, matchJobToClusters(job));
  }
  return results;
}
