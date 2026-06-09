/**
 * Normalized job listing from any source adapter.
 * All adapters must return this shape.
 */
export interface NormalizedJob {
  title: string;
  company: string;
  location: string;
  workMode?: JobWorkMode;
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

/** Work mode values for JobListing */
export type JobWorkMode = "onsite" | "remote" | "hybrid";

export type JobScrapeTrigger = "manual" | "auto";
export type JobScrapeRunStatus = "queued" | "processing" | "completed" | "failed";
export type JobScrapeSourceStatus = "queued" | "processing" | "completed" | "failed";

export interface JobScrapeSourceStatusResult {
  id: string;
  source: string;
  status: JobScrapeSourceStatus;
  fetchedCount: number;
  upsertedCount: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface JobScrapeRunStatusResult {
  id: string;
  trigger: JobScrapeTrigger;
  status: JobScrapeRunStatus;
  requestedById: string | null;
  backgroundJobId: string | null;
  totalSources: number;
  completedSources: number;
  failedSources: number;
  totalFetched: number;
  totalUpserted: number;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  sourceResults: JobScrapeSourceStatusResult[];
}

export interface JobSourceHealthResult {
  source: string;
  label: string;
  selected: boolean;
  configured: boolean;
  recentRuns: number;
  successRate: number | null;
  lastStatus: JobScrapeSourceStatus | null;
  lastFetchedCount: number;
  lastUpsertedCount: number;
  lastError: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
}

export type JobMatchReasonType =
  | "location"
  | "remote"
  | "cluster"
  | "riasec"
  | "skill"
  | "preference"
  | "feedback"
  | "source";

export interface JobMatchReason {
  type: JobMatchReasonType;
  label: string;
  value?: string;
}

/** Recommendation score result */
export interface JobRecommendation {
  jobListingId: string;
  score: number;
  matchLabel: "Strong match" | "Good match" | null;
  clusterOverlap: string[];
  skillOverlap: string[];
  matchReasons: JobMatchReason[];
}
