/**
 * Normalized job listing from any source adapter.
 * All adapters must return this shape.
 */
export interface NormalizedJob {
  title: string;
  company: string;
  location: string;
  salary: string | null;
  salaryMin: number | null;
  description: string;
  url: string;
  source: string;
  sourceType: "scrape" | "api";
  sourceId: string;
}

/**
 * Source adapter interface. Each job source implements this.
 * Adapters that require missing env vars should return an empty array.
 */
export interface JobSourceAdapter {
  readonly source: string;
  readonly sourceType: "scrape" | "api";
  isConfigured(): boolean;
  fetchJobs(region: string, radiusMiles: number): Promise<NormalizedJob[]>;
}

/** Status values for StudentSavedJob */
export type SavedJobStatus = "saved" | "applied" | "interviewing" | "offered" | "withdrawn";

/** Recommendation score result */
export interface JobRecommendation {
  jobListingId: string;
  score: number;
  matchLabel: "Strong match" | "Good match" | null;
  clusterOverlap: string[];
}
