import type { CareerDiscovery, JobListing } from "@prisma/client";
import type { JobMatchReason, JobRecommendation } from "./types";

/**
 * Scores a job listing against a student's CareerDiscovery and resume skill profile.
 *
 * Weights:
 *   Location proximity: 40% (job in student's class region = full points)
 *   Cluster match:      40% (overlap of job clusters with student topClusters)
 *   RIASEC alignment:   20% (job's inferred Holland codes vs student hollandCode)
 *   Skills bonus:       up to 20 extra points, capped at 100 total
 *   Interaction signal: small boost/penalty from saved/applied/withdrawn jobs
 *
 * Students without CareerDiscovery data can still receive resume/skill-based matches.
 */

const WEIGHT_LOCATION = 40;
const WEIGHT_CLUSTER = 40;
const WEIGHT_RIASEC = 20;
const WEIGHT_SKILLS = 20;
const WEIGHT_INTERACTIONS = 12;
const MAX_SKILL_MATCHES = 5;

export interface StudentJobProfile {
  skills: string[];
}

export interface JobInteractionProfile {
  preferredClusters: string[];
  avoidedClusters: string[];
  preferredCompanies: string[];
  preferredSources: string[];
}

export interface BuildJobInteractionProfileInput {
  status: string;
  jobListing: Pick<JobListing, "clusters" | "company" | "source">;
}

export interface BuildStudentJobProfileInput {
  resumeSkills?: string[] | null;
  resumeCertifications?: string[] | null;
  resumeExperienceTitles?: string[] | null;
  discoverySkills?: string[] | null;
}

type ScoredJob = Pick<JobListing, "id" | "location" | "clusters"> &
  Partial<Pick<JobListing, "title" | "company" | "description" | "source" | "workMode">>;

const EMPTY_STUDENT_JOB_PROFILE: StudentJobProfile = { skills: [] };
const EMPTY_JOB_INTERACTION_PROFILE: JobInteractionProfile = {
  preferredClusters: [],
  avoidedClusters: [],
  preferredCompanies: [],
  preferredSources: [],
};

const POSITIVE_INTERACTION_WEIGHTS: Record<string, number> = {
  saved: 1,
  applied: 3,
  interviewing: 4,
  offered: 5,
};

const NEGATIVE_INTERACTION_WEIGHTS: Record<string, number> = {
  withdrawn: 3,
};

const SKILL_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const SHORT_SKILL_TOKENS = new Set(["ai", "bi", "c", "go", "hr", "ml", "qa", "ui", "ux"]);

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

const CLUSTER_LABELS: Record<string, string> = {
  "office-admin": "Office & Admin",
  "finance-bookkeeping": "Finance",
  "tech-digital": "Technology",
  "creative-design": "Creative",
  "customer-service": "Customer Service",
  "career-readiness": "Workforce Ready",
  "language-esl": "ESL",
};

function inferJobHollandCode(clusters: string[]): string {
  if (clusters.length === 0) return "";
  return CLUSTER_RIASEC[clusters[0]] ?? "";
}

export type JobProximity = "local" | "remote" | "regional_onsite";
export type LocalJobPriority = "prefer_local" | "local_only" | "balanced";

function isRemoteJob(job: Pick<ScoredJob, "location" | "workMode">): boolean {
  return job.workMode === "remote" || job.location.toLowerCase().includes("remote");
}

function jobLocationMatchesRegion(jobLocation: string, classRegion: string): boolean {
  if (!classRegion) return false;
  const regionLower = classRegion.toLowerCase().split(",")[0].trim();
  return jobLocation.toLowerCase().includes(regionLower);
}

/**
 * Classifies a job's proximity relative to the class region.
 *
 *   "local"           — onsite or hybrid AND the listed location matches the class region.
 *                       Hybrid roles count as local when the listed city is in-region because
 *                       the in-person portion will be commutable.
 *   "regional_onsite" — onsite or hybrid but the listed location does NOT match the region.
 *                       An in-person job two states away is the worst kind of false positive
 *                       for our students (no transportation), so it is penalized more than remote.
 *   "remote"          — workMode "remote", or any job whose location text contains "remote".
 */
export function classifyJobProximity(
  job: Pick<ScoredJob, "location" | "workMode">,
  classRegion: string,
): JobProximity {
  if (isRemoteJob(job)) return "remote";
  return jobLocationMatchesRegion(job.location ?? "", classRegion) ? "local" : "regional_onsite";
}

// Score multipliers per proximity, per teacher policy.
//   "balanced" reproduces the historical behavior (location proximity = full score for any
//     onsite-region-match or remote role; onsite-far gets nothing).
//   "prefer_local" gives local roles the full weight and gives remote roles half credit.
//     An onsite role outside the commutable region still scores 0 here because, for SPOKES
//     students without transportation, it is functionally inaccessible.
//   "local_only" zeroes out remote entirely (the API also filters remote out at query time).
const PROXIMITY_WEIGHT_MULTIPLIERS: Record<LocalJobPriority, Record<JobProximity, number>> = {
  prefer_local: { local: 1.0, remote: 0.5, regional_onsite: 0 },
  local_only:   { local: 1.0, remote: 0.0, regional_onsite: 0 },
  balanced:     { local: 1.0, remote: 1.0, regional_onsite: 0 },
};

function scoreLocation(
  job: Pick<ScoredJob, "location" | "workMode">,
  classRegion: string,
  priority: LocalJobPriority,
): number {
  const jobLocation = job.location;
  if (!jobLocation) return 0;
  const proximity = classifyJobProximity(job, classRegion);
  if (proximity === "regional_onsite" && !classRegion) return 0;
  return Math.round(WEIGHT_LOCATION * PROXIMITY_WEIGHT_MULTIPLIERS[priority][proximity]);
}

function locationReason(
  job: Pick<ScoredJob, "location" | "workMode">,
  classRegion: string,
): JobMatchReason | null {
  const jobLocation = job.location;
  if (!jobLocation) return null;

  const proximity = classifyJobProximity(job, classRegion);
  if (proximity === "remote") {
    return { type: "remote", label: "Remote role", value: jobLocation };
  }
  if (proximity === "local") {
    return { type: "location", label: `Local — near ${classRegion}`, value: jobLocation };
  }
  // regional_onsite: only worth surfacing if we know the region, otherwise we can't say where
  if (!classRegion) return null;
  return { type: "location", label: "Onsite (outside your region)", value: jobLocation };
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

function normalizeSkillText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function skillTokens(value: string): string[] {
  return normalizeSkillText(value)
    .split(" ")
    .filter((token) => {
      if (!token || SKILL_STOPWORDS.has(token)) return false;
      return token.length >= 3 || SHORT_SKILL_TOKENS.has(token);
    });
}

function dedupeSkills(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];

  for (const value of values) {
    const skill = value?.trim();
    if (!skill) continue;

    const normalized = normalizeSkillText(skill);
    if (!normalized || seen.has(normalized) || skillTokens(skill).length === 0) continue;

    seen.add(normalized);
    skills.push(skill);
  }

  return skills.slice(0, 40);
}

export function parseTransferableSkillNames(raw: string | null | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        if (typeof item !== "object" || item === null) return "";
        const skill = (item as { skill?: unknown }).skill;
        return typeof skill === "string" ? skill : "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function buildStudentJobProfile(input: BuildStudentJobProfileInput): StudentJobProfile {
  return {
    skills: dedupeSkills([
      ...(input.resumeSkills ?? []),
      ...(input.resumeCertifications ?? []),
      ...(input.resumeExperienceTitles ?? []),
      ...(input.discoverySkills ?? []),
    ]),
  };
}

function sortedKeysByScore(scores: Map<string, number>, limit: number): string[] {
  return [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

export function buildJobInteractionProfile(
  interactions: BuildJobInteractionProfileInput[],
): JobInteractionProfile {
  const positiveClusters = new Map<string, number>();
  const negativeClusters = new Map<string, number>();
  const preferredCompanies = new Map<string, number>();
  const preferredSources = new Map<string, number>();

  for (const interaction of interactions) {
    const positiveWeight = POSITIVE_INTERACTION_WEIGHTS[interaction.status] ?? 0;
    const negativeWeight = NEGATIVE_INTERACTION_WEIGHTS[interaction.status] ?? 0;

    for (const cluster of interaction.jobListing.clusters) {
      if (positiveWeight > 0) {
        positiveClusters.set(cluster, (positiveClusters.get(cluster) ?? 0) + positiveWeight);
      }
      if (negativeWeight > 0) {
        negativeClusters.set(cluster, (negativeClusters.get(cluster) ?? 0) + negativeWeight);
      }
    }

    const company = normalizeSkillText(interaction.jobListing.company);
    if (company && positiveWeight >= POSITIVE_INTERACTION_WEIGHTS.applied) {
      preferredCompanies.set(company, (preferredCompanies.get(company) ?? 0) + positiveWeight);
    }

    const source = normalizeSkillText(interaction.jobListing.source);
    if (source && positiveWeight >= POSITIVE_INTERACTION_WEIGHTS.applied) {
      preferredSources.set(source, (preferredSources.get(source) ?? 0) + positiveWeight);
    }
  }

  const preferenceScores = new Map<string, number>();
  const avoidanceScores = new Map<string, number>();
  const allClusters = new Set([...positiveClusters.keys(), ...negativeClusters.keys()]);

  for (const cluster of allClusters) {
    const positive = positiveClusters.get(cluster) ?? 0;
    const negative = negativeClusters.get(cluster) ?? 0;
    if (positive > negative) {
      preferenceScores.set(cluster, positive - negative);
    } else if (negative > 0) {
      avoidanceScores.set(cluster, negative - positive);
    }
  }

  return {
    preferredClusters: sortedKeysByScore(preferenceScores, 6),
    avoidedClusters: sortedKeysByScore(avoidanceScores, 6),
    preferredCompanies: sortedKeysByScore(preferredCompanies, 5),
    preferredSources: sortedKeysByScore(preferredSources, 5),
  };
}

function jobSearchText(job: ScoredJob): string {
  return normalizeSkillText([
    job.title,
    job.company,
    job.location,
    job.description,
    job.clusters.join(" "),
  ].filter(Boolean).join(" "));
}

function skillMatchesText(skill: string, normalizedJobText: string): boolean {
  const normalizedSkill = normalizeSkillText(skill);
  if (!normalizedSkill) return false;

  const paddedJobText = ` ${normalizedJobText} `;
  if (paddedJobText.includes(` ${normalizedSkill} `)) return true;

  const tokens = skillTokens(skill);
  if (tokens.length === 0) return false;
  if (tokens.length === 1) return paddedJobText.includes(` ${tokens[0]} `);

  const matchedTokens = tokens.filter((token) => paddedJobText.includes(` ${token} `)).length;
  return tokens.length <= 2 ? matchedTokens === tokens.length : matchedTokens >= 2;
}

function getSkillOverlap(job: ScoredJob, profile: StudentJobProfile): string[] {
  if (profile.skills.length === 0) return [];

  const normalizedJobText = jobSearchText(job);
  const overlap: string[] = [];

  for (const skill of profile.skills) {
    if (skillMatchesText(skill, normalizedJobText)) {
      overlap.push(skill);
      if (overlap.length >= MAX_SKILL_MATCHES) break;
    }
  }

  return overlap;
}

function scoreSkills(skillOverlap: string[]): number {
  if (skillOverlap.length === 0) return 0;
  if (skillOverlap.length === 1) return 8;
  if (skillOverlap.length === 2) return 14;
  return WEIGHT_SKILLS;
}

function hasInteractionSignals(profile: JobInteractionProfile): boolean {
  return (
    profile.preferredClusters.length > 0 ||
    profile.avoidedClusters.length > 0 ||
    profile.preferredCompanies.length > 0 ||
    profile.preferredSources.length > 0
  );
}

function scoreInteractions(job: ScoredJob, profile: JobInteractionProfile): {
  score: number;
  reasons: JobMatchReason[];
} {
  if (!hasInteractionSignals(profile)) return { score: 0, reasons: [] };

  let score = 0;
  const reasons: JobMatchReason[] = [];
  const preferredCluster = job.clusters.find((cluster) => profile.preferredClusters.includes(cluster));
  const avoidedCluster = job.clusters.find((cluster) => profile.avoidedClusters.includes(cluster));
  const company = job.company ? normalizeSkillText(job.company) : "";
  const source = job.source ? normalizeSkillText(job.source) : "";

  if (preferredCluster) {
    score += 8;
    reasons.push({
      type: "preference",
      label: `Similar to jobs you tracked: ${CLUSTER_LABELS[preferredCluster] ?? preferredCluster}`,
      value: preferredCluster,
    });
  }

  if (company && profile.preferredCompanies.includes(company)) {
    score += 4;
    reasons.push({
      type: "feedback",
      label: `You have moved forward with ${job.company} before`,
      value: company,
    });
  } else if (source && profile.preferredSources.includes(source)) {
    score += 2;
  }

  if (avoidedCluster) {
    score -= 10;
  }

  return {
    score: Math.max(-10, Math.min(WEIGHT_INTERACTIONS, score)),
    reasons: reasons.slice(0, 2),
  };
}

function buildMatchReasons(input: {
  job: ScoredJob;
  discovery: Pick<CareerDiscovery, "topClusters" | "hollandCode"> | null;
  classRegion: string;
  clusterOverlap: string[];
  skillOverlap: string[];
  riasecScore: number;
  interactionReasons: JobMatchReason[];
}): JobMatchReason[] {
  const reasons: JobMatchReason[] = [];
  const location = locationReason(input.job, input.classRegion);
  if (location) reasons.push(location);

  for (const cluster of input.clusterOverlap.slice(0, 3)) {
    reasons.push({
      type: "cluster",
      label: `Matches your career cluster: ${CLUSTER_LABELS[cluster] ?? cluster}`,
      value: cluster,
    });
  }

  if (input.riasecScore > 0 && input.discovery?.hollandCode) {
    reasons.push({
      type: "riasec",
      label: `Aligns with your Holland code: ${input.discovery.hollandCode}`,
      value: input.discovery.hollandCode,
    });
  }

  for (const skill of input.skillOverlap.slice(0, 3)) {
    reasons.push({
      type: "skill",
      label: `Matches your profile skill: ${skill}`,
      value: skill,
    });
  }

  reasons.push(...input.interactionReasons);

  return reasons.slice(0, 6);
}

function emptyRecommendation(jobId: string): JobRecommendation {
  return {
    jobListingId: jobId,
    score: 0,
    matchLabel: null,
    clusterOverlap: [],
    skillOverlap: [],
    matchReasons: [],
  };
}

export function scoreJob(
  job: ScoredJob,
  discovery: Pick<CareerDiscovery, "topClusters" | "hollandCode"> | null,
  classRegion: string,
  profile: StudentJobProfile = EMPTY_STUDENT_JOB_PROFILE,
  interactionProfile: JobInteractionProfile = EMPTY_JOB_INTERACTION_PROFILE,
  priority: LocalJobPriority = "prefer_local",
): JobRecommendation {
  const hasPersonalization =
    Boolean(discovery) || profile.skills.length > 0 || hasInteractionSignals(interactionProfile);
  if (!hasPersonalization) {
    return emptyRecommendation(job.id);
  }

  const locationScore = scoreLocation(job, classRegion, priority);
  const clusterScore = discovery ? scoreCluster(job.clusters, discovery.topClusters) : 0;
  const jobHolland = inferJobHollandCode(job.clusters);
  const riasecScore = discovery ? scoreRiasec(jobHolland, discovery.hollandCode) : 0;
  const skillOverlap = getSkillOverlap(job, profile);
  const skillScore = scoreSkills(skillOverlap);
  const interactionScore = scoreInteractions(job, interactionProfile);
  const totalScore = Math.max(
    0,
    Math.min(100, locationScore + clusterScore + riasecScore + skillScore + interactionScore.score),
  );

  const clusterOverlap = discovery
    ? job.clusters.filter((c) => discovery.topClusters.includes(c))
    : [];
  const matchReasons = buildMatchReasons({
    job,
    discovery,
    classRegion,
    clusterOverlap,
    skillOverlap,
    riasecScore,
    interactionReasons: interactionScore.reasons,
  });

  return {
    jobListingId: job.id,
    score: totalScore,
    matchLabel: getMatchLabel(totalScore),
    clusterOverlap,
    skillOverlap,
    matchReasons,
  };
}

/**
 * Score and rank all jobs for a student. Returns sorted by score descending.
 */
export function rankJobs(
  jobs: ScoredJob[],
  discovery: Pick<CareerDiscovery, "topClusters" | "hollandCode"> | null,
  classRegion: string,
  profile: StudentJobProfile = EMPTY_STUDENT_JOB_PROFILE,
  interactionProfile: JobInteractionProfile = EMPTY_JOB_INTERACTION_PROFILE,
  priority: LocalJobPriority = "prefer_local",
): JobRecommendation[] {
  return jobs
    .map((job) => scoreJob(job, discovery, classRegion, profile, interactionProfile, priority))
    .sort((a, b) => b.score - a.score);
}
