import type { NormalizedJob } from "./types";

const MIN_DESCRIPTION_LENGTH = 30;

export interface RejectedJob {
  job: NormalizedJob;
  reason: string;
}

export interface JobQualityResult {
  jobs: NormalizedJob[];
  rejected: RejectedJob[];
}

function hasValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function identityKey(job: NormalizedJob): string {
  return [job.title, job.company, job.location]
    .map((part) => part.toLowerCase().replace(/\s+/g, " ").trim())
    .join("|");
}

function rejectionReason(job: NormalizedJob): string | null {
  if (!job.sourceId.trim()) return "missing source id";
  if (!job.title.trim()) return "missing title";
  if (!job.company.trim()) return "missing company";
  if (!job.location.trim()) return "missing location";
  if (!hasValidUrl(job.url)) return "invalid url";
  if (job.description.trim().length < MIN_DESCRIPTION_LENGTH) return "description too short";
  return null;
}

export function filterQualityJobs(jobs: NormalizedJob[]): JobQualityResult {
  const accepted: NormalizedJob[] = [];
  const rejected: RejectedJob[] = [];
  const seenSourceIds = new Set<string>();
  const seenIdentities = new Set<string>();

  for (const job of jobs) {
    const reason = rejectionReason(job);
    if (reason) {
      rejected.push({ job, reason });
      continue;
    }

    if (seenSourceIds.has(job.sourceId)) {
      rejected.push({ job, reason: "duplicate source id" });
      continue;
    }
    seenSourceIds.add(job.sourceId);

    const identity = identityKey(job);
    if (seenIdentities.has(identity)) {
      rejected.push({ job, reason: "duplicate title/company/location" });
      continue;
    }
    seenIdentities.add(identity);

    accepted.push(job);
  }

  return { jobs: accepted, rejected };
}

