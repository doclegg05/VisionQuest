import type { JobSearchProfile, NormalizedJob, OpportunityType } from "./types";

const VALID_OPPORTUNITY_TYPES: OpportunityType[] = ["job", "training", "apprenticeship"];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeProfileEntries(values: string[] | null | undefined) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export function buildSearchProfile(config: {
  region: string;
  radius: number;
  opportunityTypes?: string[];
  targetRoles?: string[];
  excludedEmployers?: string[];
  remoteOnly?: boolean;
  wageFloor?: number | null;
}): JobSearchProfile {
  return {
    region: config.region,
    radiusMiles: config.radius,
    opportunityTypes: normalizeOpportunityTypes(config.opportunityTypes),
    targetRoles: normalizeProfileEntries(config.targetRoles),
    excludedEmployers: normalizeProfileEntries(config.excludedEmployers),
    remoteOnly: config.remoteOnly ?? false,
    wageFloor: typeof config.wageFloor === "number" ? config.wageFloor : null,
  };
}

export function normalizeOpportunityTypes(values: string[] | null | undefined): OpportunityType[] {
  const normalized = Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim().toLowerCase())
        .filter((value): value is OpportunityType =>
          VALID_OPPORTUNITY_TYPES.includes(value as OpportunityType),
        ),
    ),
  );

  return normalized.length > 0 ? normalized : ["job", "training", "apprenticeship"];
}

export function getPrimarySearchTerm(profile: JobSearchProfile) {
  return profile.targetRoles[0] ?? null;
}

export function filterJobsForProfile(jobs: NormalizedJob[], profile: JobSearchProfile) {
  return jobs.filter((job) => matchesSearchProfile(job, profile));
}

export function matchesSearchProfile(job: NormalizedJob, profile: JobSearchProfile) {
  if (!profile.opportunityTypes.includes(job.opportunityType)) {
    return false;
  }

  const company = normalizeText(job.company);
  if (profile.excludedEmployers.some((entry) => company.includes(normalizeText(entry)))) {
    return false;
  }

  if (profile.wageFloor != null && job.salaryMin != null && job.salaryMin < profile.wageFloor) {
    return false;
  }

  if (profile.remoteOnly) {
    const remoteHaystack = normalizeText(`${job.title} ${job.location} ${job.description}`);
    const looksRemote =
      remoteHaystack.includes("remote") ||
      remoteHaystack.includes("work from home") ||
      remoteHaystack.includes("telecommute") ||
      remoteHaystack.includes("virtual");
    if (!looksRemote) {
      return false;
    }
  }

  if (profile.targetRoles.length > 0) {
    const roleHaystack = normalizeText(`${job.title} ${job.description}`);
    const matchesRole = profile.targetRoles.some((role) =>
      roleHaystack.includes(normalizeText(role)),
    );
    if (!matchesRole) {
      return false;
    }
  }

  return true;
}
