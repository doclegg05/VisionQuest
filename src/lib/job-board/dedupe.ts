import type { NormalizedJob } from "./types";

const SOURCE_PRIORITY: Record<string, number> = {
  careeronestop: 1,
  usajobs: 2,
  jsearch: 3,
  adzuna: 4,
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function buildJobFingerprint(
  job: Pick<NormalizedJob, "opportunityType" | "title" | "company" | "location">,
) {
  return [
    normalizeText(job.opportunityType),
    normalizeText(job.title),
    normalizeText(job.company),
    normalizeText(job.location),
  ].join("|");
}

function getSourcePriority(source: string) {
  return SOURCE_PRIORITY[source] ?? 99;
}

function scoreJob(job: NormalizedJob) {
  return {
    sourcePriority: getSourcePriority(job.source),
    descriptionLength: job.description?.length ?? 0,
    hasSalary: job.salary != null ? 1 : 0,
    hasLocation: job.location ? 1 : 0,
  };
}

function shouldReplaceCandidate(nextJob: NormalizedJob, currentJob: NormalizedJob) {
  const next = scoreJob(nextJob);
  const current = scoreJob(currentJob);

  if (next.sourcePriority !== current.sourcePriority) {
    return next.sourcePriority < current.sourcePriority;
  }
  if (next.hasSalary !== current.hasSalary) {
    return next.hasSalary > current.hasSalary;
  }
  if (next.descriptionLength !== current.descriptionLength) {
    return next.descriptionLength > current.descriptionLength;
  }
  if (next.hasLocation !== current.hasLocation) {
    return next.hasLocation > current.hasLocation;
  }

  return nextJob.sourceId < currentJob.sourceId;
}

export function dedupeJobsAcrossSources(jobs: NormalizedJob[]) {
  const selectedByFingerprint = new Map<string, NormalizedJob>();

  for (const job of jobs) {
    const fingerprint = buildJobFingerprint(job);
    const current = selectedByFingerprint.get(fingerprint);
    if (!current || shouldReplaceCandidate(job, current)) {
      selectedByFingerprint.set(fingerprint, job);
    }
  }

  return {
    uniqueJobs: Array.from(selectedByFingerprint.values()),
    selectedByFingerprint,
  };
}
