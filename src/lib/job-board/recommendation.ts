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
 *
 * Students without CareerDiscovery data can still receive resume/skill-based matches.
 */

const WEIGHT_LOCATION = 40;
const WEIGHT_CLUSTER = 40;
const WEIGHT_RIASEC = 20;
const WEIGHT_SKILLS = 20;
const MAX_SKILL_MATCHES = 5;

export interface StudentJobProfile {
  skills: string[];
}

export interface BuildStudentJobProfileInput {
  resumeSkills?: string[] | null;
  resumeCertifications?: string[] | null;
  resumeExperienceTitles?: string[] | null;
  discoverySkills?: string[] | null;
}

type ScoredJob = Pick<JobListing, "id" | "location" | "clusters"> &
  Partial<Pick<JobListing, "title" | "company" | "description">>;

const EMPTY_STUDENT_JOB_PROFILE: StudentJobProfile = { skills: [] };

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

function scoreLocation(jobLocation: string, classRegion: string): number {
  if (!jobLocation) return 0;
  if (jobLocation.toLowerCase().includes("remote")) return WEIGHT_LOCATION;
  if (!classRegion) return 0;
  // Simple: check if job location contains the class region city/state
  const regionLower = classRegion.toLowerCase().split(",")[0].trim();
  return jobLocation.toLowerCase().includes(regionLower) ? WEIGHT_LOCATION : 0;
}

function locationReason(jobLocation: string, classRegion: string): JobMatchReason | null {
  if (!jobLocation) return null;
  if (jobLocation.toLowerCase().includes("remote")) {
    return { type: "remote", label: "Remote role", value: jobLocation };
  }
  if (!classRegion) return null;

  const regionLower = classRegion.toLowerCase().split(",")[0].trim();
  if (!jobLocation.toLowerCase().includes(regionLower)) return null;

  return { type: "location", label: `Near ${classRegion}`, value: jobLocation };
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

function buildMatchReasons(input: {
  job: ScoredJob;
  discovery: Pick<CareerDiscovery, "topClusters" | "hollandCode"> | null;
  classRegion: string;
  clusterOverlap: string[];
  skillOverlap: string[];
  riasecScore: number;
}): JobMatchReason[] {
  const reasons: JobMatchReason[] = [];
  const location = locationReason(input.job.location, input.classRegion);
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
): JobRecommendation {
  const hasPersonalization = Boolean(discovery) || profile.skills.length > 0;
  if (!hasPersonalization) {
    return emptyRecommendation(job.id);
  }

  const locationScore = scoreLocation(job.location, classRegion);
  const clusterScore = discovery ? scoreCluster(job.clusters, discovery.topClusters) : 0;
  const jobHolland = inferJobHollandCode(job.clusters);
  const riasecScore = discovery ? scoreRiasec(jobHolland, discovery.hollandCode) : 0;
  const skillOverlap = getSkillOverlap(job, profile);
  const skillScore = scoreSkills(skillOverlap);
  const totalScore = Math.min(100, locationScore + clusterScore + riasecScore + skillScore);

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
): JobRecommendation[] {
  return jobs
    .map((job) => scoreJob(job, discovery, classRegion, profile))
    .sort((a, b) => b.score - a.score);
}
