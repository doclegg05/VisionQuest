import type { NormalizedJob } from "./types";
import { jobDuplicateKey } from "./duplicates";

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

/**
 * VQ-R-015: senior/leadership title tokens, word-boundary matched so "lead"
 * never fires on "Leader"/"Leadership" and "vp" never fires inside "MVP".
 * The default audience is SPOKES students entering the workforce — a
 * "Staff Engineer" or "Director" posting is noise for them no matter which
 * source produced it, so the quality filter rejects it centrally.
 */
const SENIORITY_TITLE_PATTERN = /\b(?:senior|staff|principal|lead|director|vp|head of|architect)\b/i;

/**
 * Elder-care titles ("Senior Care Assistant", "Senior Living Caregiver") are
 * entry-level jobs FOR seniors' care, not senior-level roles. Neutralize only
 * the "senior <care-context>" phrase before testing, so a remaining
 * leadership token ("Senior Living Community Director") still rejects.
 */
const SENIOR_CARE_CONTEXT_PATTERN = /\bsenior\s+(?:care\b|caregiver|caregiving|living|center|centre|companion)/gi;

export function isSeniorLevelTitle(title: string): boolean {
  const scrubbed = title.replace(SENIOR_CARE_CONTEXT_PATTERN, " ");
  return SENIORITY_TITLE_PATTERN.test(scrubbed);
}

function rejectionReason(job: NormalizedJob): string | null {
  if (!job.sourceId.trim()) return "missing source id";
  if (!job.title.trim()) return "missing title";
  if (!job.company.trim()) return "missing company";
  if (!job.location.trim()) return "missing location";
  if (!hasValidUrl(job.url)) return "invalid url";
  if (job.description.trim().length < MIN_DESCRIPTION_LENGTH) return "description too short";
  if (isSeniorLevelTitle(job.title)) return "senior-level title";
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

    const identity = jobDuplicateKey(job);
    if (seenIdentities.has(identity)) {
      rejected.push({ job, reason: "duplicate job posting" });
      continue;
    }
    seenIdentities.add(identity);

    accepted.push(job);
  }

  return { jobs: accepted, rejected };
}
