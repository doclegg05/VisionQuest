import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  computeHollandCode,
  type RiasecScores,
  type NationalClusterScore,
  type TransferableSkill,
  type WorkValue,
} from "@/lib/sage/discovery-extractor";
import { isAssessedProfileSource } from "@/lib/career-provenance";
import { parseAndNormalizeStoredNationalClusters } from "@/lib/spokes/national-clusters";

export interface CareerDiscoveryData {
  id: string;
  status: string;
  hollandCode: string | null;
  riasecScores: RiasecScores | null;
  nationalClusters: NationalClusterScore[] | null;
  transferableSkills: TransferableSkill[] | null;
  workValues: WorkValue[] | null;
  sageSummary: string | null;
  completedAt: Date | null;
  /** Provenance union (see src/lib/career-provenance.ts). */
  profileSource: string;
  assessedAt: Date | null;
}

function parseJsonField<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function getCareerDiscovery(
  studentId: string,
): Promise<CareerDiscoveryData | null> {
  const record = await prisma.careerDiscovery.findUnique({
    where: { studentId },
    select: {
      id: true,
      status: true,
      hollandCode: true,
      riasecScores: true,
      nationalClusters: true,
      transferableSkills: true,
      workValues: true,
      sageSummary: true,
      completedAt: true,
      profileSource: true,
      assessedAt: true,
    },
  });

  if (!record) return null;

  // Read-time normalization: legacy 16-framework rows render as their
  // modernized clusters everywhere this data is displayed.
  const normalizedClusters = parseAndNormalizeStoredNationalClusters(
    record.nationalClusters,
  ).map((cluster) => ({ ...cluster, spokes_mapping: cluster.spokes_mapping ?? [] }));

  return {
    id: record.id,
    status: record.status,
    hollandCode: record.hollandCode,
    riasecScores: parseJsonField<RiasecScores>(record.riasecScores),
    nationalClusters: normalizedClusters.length > 0 ? normalizedClusters : null,
    transferableSkills: parseJsonField<TransferableSkill[]>(record.transferableSkills),
    workValues: parseJsonField<WorkValue[]>(record.workValues),
    sageSummary: record.sageSummary,
    completedAt: record.completedAt,
    profileSource: record.profileSource,
    assessedAt: record.assessedAt,
  };
}

// =============================================================================
// Discovery-extractor persistence
// =============================================================================

/**
 * The payload shape the background discovery extractor produces for a
 * CareerDiscovery upsert (see handlePostResponse in
 * src/lib/chat/post-response.ts). All JSON fields arrive pre-stringified.
 */
export interface DiscoveryExtractionData {
  interests: string;
  strengths: string;
  subjects: string;
  problems: string;
  values: string;
  circumstances: string;
  clusterScores: string;
  sageSummary: string | null;
  riasecScores: string;
  hollandCode: string | null;
  nationalClusters: string;
  transferableSkills: string;
  workValues: string;
  assessmentSummary: string | null;
  conversationId: string;
}

/**
 * GUARD: strip the inferred RIASEC fields from an extraction payload when the
 * stored profile is assessed (student-reported or API-fetched). Without this,
 * every background extraction pass would silently overwrite a real assessment
 * with model inference while profileSource still claimed assessed provenance.
 * Pure and immutable — returns a new object, never mutates the input.
 */
export function guardDiscoveryExtractionData(
  existingProfileSource: string | null | undefined,
  data: DiscoveryExtractionData,
): DiscoveryExtractionData | Omit<DiscoveryExtractionData, "riasecScores" | "hollandCode"> {
  if (!existingProfileSource || !isAssessedProfileSource(existingProfileSource)) {
    return data;
  }
  const { riasecScores: _riasecScores, hollandCode: _hollandCode, ...rest } = data;
  return rest;
}

/**
 * Persist a background discovery-extraction pass. Pass `completion` when the
 * extractor reported `stage_complete` — it marks the row complete and stamps
 * topClusters/completedAt, exactly like the two inline upserts this helper
 * replaces in post-response.ts.
 *
 * The extractor never writes provenance fields (profileSource, assessedAt,
 * assessmentPayload) — new rows are born "sage_inferred" via the schema
 * default, and only record_assessment_results (or the future COS API path)
 * may move a row off it. On rows that ARE assessed, the update is guarded so
 * inference can never displace the assessed RIASEC profile (see
 * guardDiscoveryExtractionData above).
 */
export async function upsertDiscoveryFromExtraction(
  studentId: string,
  data: DiscoveryExtractionData,
  completion?: { topClusters: string[]; completedAt: Date },
): Promise<void> {
  const existing = await prisma.careerDiscovery.findUnique({
    where: { studentId },
    select: { profileSource: true },
  });
  const guarded = guardDiscoveryExtractionData(existing?.profileSource, data);

  const completionFields = completion
    ? {
        status: "complete",
        topClusters: completion.topClusters,
        completedAt: completion.completedAt,
      }
    : {};

  await prisma.careerDiscovery.upsert({
    where: { studentId },
    // A row created here never pre-existed, so the full payload applies —
    // it is born sage_inferred via the schema default.
    create: { studentId, ...data, ...completionFields },
    update: { ...guarded, ...completionFields },
  });
}

// =============================================================================
// Assessed-profile writes (record_assessment_results / future COS API)
// =============================================================================

export interface RecordAssessedCareerProfileParams {
  studentId: string;
  /** Which assessed pipeline produced this write. */
  source: "student_reported_cos" | "cos_api";
  assessedAt: Date;
  /** The raw reported results, stored verbatim for audit/re-derivation. */
  payload: Prisma.InputJsonValue;
  /**
   * Assessed RIASEC scores (0..1). Dimensions the student did not report
   * fill to 0, matching the extractor's own convention. When present they
   * REPLACE the inferred scores and re-derive hollandCode; when absent the
   * stored profile is left alone and only provenance is stamped.
   */
  riasec?: Partial<RiasecScores>;
}

function fullRiasec(partial: Partial<RiasecScores>): RiasecScores {
  return {
    realistic: partial.realistic ?? 0,
    investigative: partial.investigative ?? 0,
    artistic: partial.artistic ?? 0,
    social: partial.social ?? 0,
    enterprising: partial.enterprising ?? 0,
    conventional: partial.conventional ?? 0,
  };
}

/**
 * Record a real assessment result onto the student's CareerDiscovery row.
 *
 * DELIBERATE SEAM — no occupation→cluster inference: topClusters,
 * clusterScores, and nationalClusters stay untouched even when the reported
 * occupations clearly belong to a cluster. Mapping student-reported
 * occupations onto SPOKES/national clusters is a separate, future unit; the
 * raw occupations are preserved in assessmentPayload for it.
 */
export async function recordAssessedCareerProfile(
  params: RecordAssessedCareerProfileParams,
): Promise<void> {
  const { studentId, source, assessedAt, payload, riasec } = params;

  const scores = riasec ? fullRiasec(riasec) : null;
  const data = {
    profileSource: source,
    assessedAt,
    assessmentPayload: payload,
    ...(scores
      ? {
          riasecScores: JSON.stringify(scores),
          hollandCode: computeHollandCode(scores),
        }
      : {}),
  };

  await prisma.careerDiscovery.upsert({
    where: { studentId },
    create: { studentId, ...data },
    update: data,
  });
}
