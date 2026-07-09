// =============================================================================
// Career Profile ("Career DNA") display shaping
// Reads a student's CareerDiscovery row and shapes it for the /career/profile
// results surface: plain-language RIASEC dimensions, top interests, suggested
// career clusters, and assessment completeness.
// Pure shaping lives in shapeCareerProfile() so it can be unit tested without
// a database; getCareerProfile() is the server-side fetch wrapper.
// =============================================================================

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CareerDiscoveryData } from "@/lib/career-discovery";
import type {
  NationalClusterScore,
  RiasecScores,
  TransferableSkill,
  WorkValue,
} from "@/lib/sage/discovery-extractor";
import { CAREER_CLUSTERS } from "@/lib/spokes/career-clusters";

const careerProfileSelect = {
  id: true,
  status: true,
  hollandCode: true,
  riasecScores: true,
  nationalClusters: true,
  transferableSkills: true,
  workValues: true,
  sageSummary: true,
  completedAt: true,
} satisfies Prisma.CareerDiscoverySelect;

export type CareerDiscoveryRow = Prisma.CareerDiscoveryGetPayload<{
  select: typeof careerProfileSelect;
}>;

export interface RiasecDimensionView {
  key: keyof RiasecScores;
  label: string;
  /** Short nickname students recognize from Holland materials ("Helper"). */
  nickname: string;
  /** 6th-grade-level explanation of what this interest means. */
  plainLanguage: string;
  /** Clamped 0..1. */
  score: number;
  /** Rounded 0..100 for display. */
  percent: number;
}

export interface SuggestedClusterView {
  name: string;
  matchPercent: number;
  spokesClusterIds: string[];
  /** Label of the first mapped SPOKES pathway, when one matches. */
  spokesLabel: string | null;
  /** Up to 4 sample jobs from the first mapped SPOKES pathway. */
  sampleJobs: string[];
}

export interface AssessmentCompleteness {
  completedSections: number;
  totalSections: number;
  percent: number;
  /** Plain-language names of sections Sage still needs to cover. */
  missingSections: string[];
}

export interface CareerProfileView {
  /** Parsed row in the shape the CareerProfile detail component consumes. */
  discovery: CareerDiscoveryData;
  isComplete: boolean;
  /** All six Holland dimensions, highest score first. */
  dimensions: RiasecDimensionView[];
  /** Up to three dimensions with real signal (score > 0). */
  topInterests: RiasecDimensionView[];
  /** Up to three national clusters, best match first, with SPOKES sample jobs. */
  suggestedClusters: SuggestedClusterView[];
  completeness: AssessmentCompleteness;
}

const RIASEC_DIMENSIONS: {
  key: keyof RiasecScores;
  label: string;
  nickname: string;
  plainLanguage: string;
}[] = [
  {
    key: "realistic",
    label: "Realistic",
    nickname: "Doer",
    plainLanguage: "You like hands-on work — building, fixing, and using tools.",
  },
  {
    key: "investigative",
    label: "Investigative",
    nickname: "Thinker",
    plainLanguage: "You like solving problems and figuring out how things work.",
  },
  {
    key: "artistic",
    label: "Artistic",
    nickname: "Creator",
    plainLanguage: "You like making new things and sharing your own ideas.",
  },
  {
    key: "social",
    label: "Social",
    nickname: "Helper",
    plainLanguage: "You like working with people — helping, teaching, and caring.",
  },
  {
    key: "enterprising",
    label: "Enterprising",
    nickname: "Leader",
    plainLanguage: "You like taking charge, sharing ideas, and making things happen.",
  },
  {
    key: "conventional",
    label: "Conventional",
    nickname: "Organizer",
    plainLanguage: "You like clear steps, details, and keeping things in order.",
  },
];

function parseJsonField(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Conservative: a corrupt stored blob renders as "section not covered yet"
    // instead of crashing the results page.
    return null;
  }
}

function clampScore(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, num));
}

function sanitizeRiasec(parsed: unknown): RiasecScores | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  return {
    realistic: clampScore(source.realistic),
    investigative: clampScore(source.investigative),
    artistic: clampScore(source.artistic),
    social: clampScore(source.social),
    enterprising: clampScore(source.enterprising),
    conventional: clampScore(source.conventional),
  };
}

function sanitizeClusters(parsed: unknown): NationalClusterScore[] | null {
  if (!Array.isArray(parsed)) return null;
  const clusters: NationalClusterScore[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.cluster_name !== "string" || candidate.cluster_name.length === 0) {
      continue;
    }
    clusters.push({
      cluster_name: candidate.cluster_name,
      score: clampScore(candidate.score),
      spokes_mapping: Array.isArray(candidate.spokes_mapping)
        ? candidate.spokes_mapping.filter((id): id is string => typeof id === "string")
        : [],
    });
  }
  return clusters.length > 0 ? clusters : null;
}

function sanitizeSkills(parsed: unknown): TransferableSkill[] | null {
  if (!Array.isArray(parsed)) return null;
  const skills: TransferableSkill[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.skill !== "string" || candidate.skill.length === 0) continue;
    skills.push({
      skill: candidate.skill,
      category: typeof candidate.category === "string" ? candidate.category : "general",
      evidence: typeof candidate.evidence === "string" ? candidate.evidence : "",
    });
  }
  return skills.length > 0 ? skills : null;
}

const WORK_VALUE_IMPORTANCE: readonly WorkValue["importance"][] = ["high", "medium", "low"];

function sanitizeValues(parsed: unknown): WorkValue[] | null {
  if (!Array.isArray(parsed)) return null;
  const values: WorkValue[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.value !== "string" || candidate.value.length === 0) continue;
    const importance = WORK_VALUE_IMPORTANCE.find((level) => level === candidate.importance);
    values.push({
      value: candidate.value,
      // Conservative: an unknown importance renders as the middle weight
      // rather than dropping a value the student expressed.
      importance: importance ?? "medium",
    });
  }
  return values.length > 0 ? values : null;
}

/**
 * Shape a raw CareerDiscovery row into display-ready Career DNA data.
 * Pure — safe against malformed/missing JSON fields.
 */
export function shapeCareerProfile(row: CareerDiscoveryRow): CareerProfileView {
  const riasecScores = sanitizeRiasec(parseJsonField(row.riasecScores));
  const nationalClusters = sanitizeClusters(parseJsonField(row.nationalClusters));
  const transferableSkills = sanitizeSkills(parseJsonField(row.transferableSkills));
  const workValues = sanitizeValues(parseJsonField(row.workValues));

  const dimensions: RiasecDimensionView[] = RIASEC_DIMENSIONS.map((dimension) => {
    const score = clampScore(riasecScores?.[dimension.key]);
    return { ...dimension, score, percent: Math.round(score * 100) };
  }).sort((a, b) => b.score - a.score);

  const topInterests = dimensions.filter((dimension) => dimension.score > 0).slice(0, 3);

  const suggestedClusters: SuggestedClusterView[] = (nationalClusters ?? [])
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((cluster) => {
      const spokesMatch = cluster.spokes_mapping
        .map((id) => CAREER_CLUSTERS.find((c) => c.id === id))
        .find(Boolean);
      return {
        name: cluster.cluster_name,
        matchPercent: Math.round(clampScore(cluster.score) * 100),
        spokesClusterIds: cluster.spokes_mapping,
        spokesLabel: spokesMatch?.label ?? null,
        sampleJobs: spokesMatch ? spokesMatch.sampleJobs.slice(0, 4) : [],
      };
    });

  const sections: { label: string; done: boolean }[] = [
    { label: "Interests", done: topInterests.length > 0 },
    { label: "Career matches", done: suggestedClusters.length > 0 },
    { label: "Skills", done: (transferableSkills ?? []).length > 0 },
    { label: "Work values", done: (workValues ?? []).length > 0 },
  ];
  const completedSections = sections.filter((section) => section.done).length;
  const completeness: AssessmentCompleteness = {
    completedSections,
    totalSections: sections.length,
    percent: Math.round((completedSections / sections.length) * 100),
    missingSections: sections.filter((section) => !section.done).map((section) => section.label),
  };

  return {
    discovery: {
      id: row.id,
      status: row.status,
      hollandCode: row.hollandCode,
      riasecScores,
      nationalClusters,
      transferableSkills,
      workValues,
      sageSummary: row.sageSummary,
      completedAt: row.completedAt,
    },
    isComplete: row.status === "complete",
    dimensions,
    topInterests,
    suggestedClusters,
    completeness,
  };
}

/**
 * Fetch and shape the student's Career DNA. Returns null when the student
 * has not started the discovery conversation with Sage yet.
 */
export async function getCareerProfile(studentId: string): Promise<CareerProfileView | null> {
  const row = await prisma.careerDiscovery.findUnique({
    where: { studentId },
    select: careerProfileSelect,
  });

  if (!row) return null;
  return shapeCareerProfile(row);
}
