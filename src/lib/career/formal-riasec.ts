/**
 * Shared write path for formal Interest Profiler results (Path A O*NET Mini-IP
 * and Path B manual import). Updates live CareerDiscovery (0..1 coaching scale)
 * and inserts an immutable CareerAssessmentSnapshot for audit reprint.
 */

import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { RiasecScores } from "@/lib/sage/discovery-extractor";
import {
  type FormalRiasecSource,
  isFormalRiasecSource,
} from "@/lib/career/riasec-lock";
import { RIASEC_KEYS } from "@/lib/career/riasec-keys";

export { RIASEC_KEYS } from "@/lib/career/riasec-keys";

/** Mini-IP: 5 items per RIASEC area × max answer 5 → max area score 25. */
export const ONET_MINI_IP_AREA_MAX = 25;

const HOLLAND_LETTER: Record<keyof RiasecScores, string> = {
  realistic: "R",
  investigative: "I",
  artistic: "A",
  social: "S",
  enterprising: "E",
  conventional: "C",
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Normalize O*NET integer area scores to the 0..1 Career DNA scale.
 * Uses Mini-IP max (25) unless a score exceeds it (Short Form / manual),
 * in which case we divide by max(observed, 25).
 */
export function normalizeOnetScores(raw: RiasecScores): RiasecScores {
  const observedMax = Math.max(
    ONET_MINI_IP_AREA_MAX,
    ...RIASEC_KEYS.map((key) => raw[key] || 0),
  );
  const out = {} as RiasecScores;
  for (const key of RIASEC_KEYS) {
    out[key] = clamp01((raw[key] || 0) / observedMax);
  }
  return out;
}

/**
 * Manual import: values already in 0..1 stay as-is; any value > 1 is treated
 * as an O*NET-style integer score and normalized.
 */
export function coerceManualScores(input: RiasecScores): {
  raw: RiasecScores;
  normalized: RiasecScores;
} {
  const raw = {} as RiasecScores;
  for (const key of RIASEC_KEYS) {
    const n = Number(input[key]);
    raw[key] = Number.isFinite(n) ? n : 0;
  }
  const looksIntegerScale = RIASEC_KEYS.some((key) => raw[key] > 1);
  if (looksIntegerScale) {
    return { raw, normalized: normalizeOnetScores(raw) };
  }
  const normalized = {} as RiasecScores;
  for (const key of RIASEC_KEYS) {
    normalized[key] = clamp01(raw[key]);
  }
  return { raw, normalized };
}

export function computeHollandCode(scores: RiasecScores): string {
  return RIASEC_KEYS.filter((key) => (scores[key] || 0) > 0)
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, 3)
    .map((key) => HOLLAND_LETTER[key])
    .join("");
}

export function parseHollandCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase();
  if (!/^[RIASEC]{1,3}$/.test(cleaned)) return null;
  return cleaned;
}

export interface WriteFormalRiasecInput {
  studentId: string;
  source: FormalRiasecSource;
  instrument: string;
  raw: RiasecScores;
  normalized: RiasecScores;
  hollandCode?: string | null;
  note?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
}

export interface WriteFormalRiasecResult {
  hollandCode: string;
  normalized: RiasecScores;
  snapshotId: string;
  discoveryId: string;
}

export async function writeFormalRiasec(
  input: WriteFormalRiasecInput,
): Promise<WriteFormalRiasecResult> {
  if (!isFormalRiasecSource(input.source)) {
    throw new Error(`Invalid formal RIASEC source: ${input.source}`);
  }

  const hollandCode =
    parseHollandCode(input.hollandCode) || computeHollandCode(input.normalized);
  const assessedAt = new Date();
  const rawJson = JSON.stringify(input.raw);
  const normalizedJson = JSON.stringify(input.normalized);

  const discoveryData = {
    riasecScores: normalizedJson,
    hollandCode: hollandCode || null,
    riasecSource: input.source,
    riasecInstrument: input.instrument,
    riasecAssessedAt: assessedAt,
    status: "complete" as const,
    completedAt: assessedAt,
  };

  const [discovery, snapshot] = await prisma.$transaction([
    prisma.careerDiscovery.upsert({
      where: { studentId: input.studentId },
      create: {
        studentId: input.studentId,
        ...discoveryData,
      },
      update: discoveryData,
      select: { id: true },
    }),
    prisma.careerAssessmentSnapshot.create({
      data: {
        studentId: input.studentId,
        instrument: input.instrument,
        source: input.source,
        hollandCode: hollandCode || null,
        riasecScoresRaw: rawJson,
        riasecScoresNormalized: normalizedJson,
        note: input.note ?? null,
      },
      select: { id: true },
    }),
  ]);

  await logAuditEvent({
    actorId: input.actorId ?? input.studentId,
    actorRole: input.actorRole ?? "student",
    action: "student.career.interest_profiler.submit",
    targetType: "CareerDiscovery",
    targetId: discovery.id,
    summary: `Formal Interest Profiler (${input.source}) recorded`,
    metadata: {
      source: input.source,
      instrument: input.instrument,
      snapshotId: snapshot.id,
      hollandCode,
    },
  });

  return {
    hollandCode,
    normalized: input.normalized,
    snapshotId: snapshot.id,
    discoveryId: discovery.id,
  };
}
