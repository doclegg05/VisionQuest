export type OpportunityType = "job" | "training" | "apprenticeship";

/**
 * Normalized job listing from any source adapter.
 * All adapters must return this shape.
 */
export interface NormalizedJob {
  opportunityType: OpportunityType;
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

export interface ProviderQuotaSnapshot {
  id: string;
  label: string;
  limit: number;
  remaining: number;
  resetTime: number | null;
}

export interface JobFetchResult {
  jobs: NormalizedJob[];
  quotaSnapshots?: ProviderQuotaSnapshot[];
}

export interface JobSearchProfile {
  region: string;
  radiusMiles: number;
  opportunityTypes: OpportunityType[];
  targetRoles: string[];
  excludedEmployers: string[];
  remoteOnly: boolean;
  wageFloor: number | null;
}

/**
 * Source adapter interface. Each job source implements this.
 * Adapters that require missing env vars should return an empty array.
 */
export interface JobSourceAdapter {
  readonly source: string;
  readonly sourceType: "scrape" | "api";
  isConfigured(): boolean;
  fetchJobs(profile: JobSearchProfile): Promise<JobFetchResult>;
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
