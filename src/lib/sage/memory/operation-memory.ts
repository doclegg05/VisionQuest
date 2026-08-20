/**
 * Memories that come from what staff DID, not from what anyone said.
 *
 * Sage's picture of a student was built entirely out of chat until now, so the
 * moments that matter most in this program — an instructor confirming a goal,
 * verifying a certification requirement, unblocking a stalled career discovery
 * — were invisible to it. A student could come back the next day and Sage
 * would not know their goal had been made real.
 *
 * These memories are TEMPLATED, never model-generated. The operations are
 * already ledgered in SageOperation/AuditLog; the memory layer's job is to put
 * them in front of Sage at conversation time, and a template keeps that
 * faithful — no paraphrase, no invention, no LLM cost, no latency on a teacher
 * action.
 *
 * Subject is the STUDENT (subjectType "student"), because the fact is about
 * the student's plan. sourceType is "operation" so consolidation, the teacher
 * memory review UI, and any future audit can tell a recorded action apart from
 * an inferred one.
 *
 * Every writer here is fire-and-forget safe: it returns a status and never
 * throws, so a memory failure can never fail the teacher's action.
 */

import { logger } from "@/lib/logger";
import {
  looksLikeInstructionToSage,
  memoryCandidateSchema,
  type MemoryCandidate,
} from "./schema";
import { storeMemoryCandidates } from "./store";

/** Schema caps content at 500 chars; leave room for the surrounding template. */
const MAX_QUOTED_CHARS = 300;

export type OperationMemoryResult = "stored" | "duplicate" | "skipped";

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function quote(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > MAX_QUOTED_CHARS ? `${trimmed.slice(0, MAX_QUOTED_CHARS - 1)}…` : trimmed;
}

// ─── Templates (pure — unit-tested without a DB) ────────────────────────────

export function goalConfirmedMemoryContent(params: {
  level: string;
  content: string;
  at: Date;
}): string {
  return `Teacher confirmed the ${params.level} goal "${quote(params.content)}" on ${isoDate(params.at)}.`;
}

export function certVerifiedMemoryContent(params: {
  requirementLabel: string;
  certLabel: string;
  at: Date;
}): string {
  return `Teacher verified "${quote(params.requirementLabel)}" toward the ${quote(params.certLabel)} certification on ${isoDate(params.at)}.`;
}

export function discoveryOverrideMemoryContent(params: {
  clusterLabel: string | null;
  at: Date;
}): string {
  const base = `Teacher marked career discovery complete on ${isoDate(params.at)}`;
  return params.clusterLabel
    ? `${base} and set the ${quote(params.clusterLabel)} career cluster.`
    : `${base}.`;
}

// ─── Write path ─────────────────────────────────────────────────────────────

interface RecordOperationMemoryParams {
  studentId: string;
  content: string;
  category: MemoryCandidate["category"];
  /** Stable per-event key, so a replayed operation dedupes on sourceHash. */
  sourceId: string;
}

/**
 * Store one deterministic operation memory.
 *
 * `semanticDedupe: false` is the load-bearing choice here. The embedding-
 * distance probe exists to catch a model rephrasing a fact it already wrote;
 * templated sentences are near-identical by construction, so leaving it on
 * would mean the second confirmed goal of the week silently vanished. The
 * sourceHash pre-check plus the partial unique index still make a replayed
 * operation idempotent, which is the dedupe that actually applies.
 */
async function recordOperationMemory({
  studentId,
  content,
  category,
  sourceId,
}: RecordOperationMemoryParams): Promise<OperationMemoryResult> {
  try {
    // The quoted fragment is student- or Sage-authored text. It cannot reach
    // the prompt as an instruction (retrieve.ts frames memory as data), but a
    // template is not a licence to skip the write gate.
    if (looksLikeInstructionToSage(content)) {
      logger.info("sage.operation_memory.rejected_instruction", { sourceId });
      return "skipped";
    }

    const candidate = memoryCandidateSchema.parse({
      subjectType: "student",
      subjectId: studentId,
      kind: "episodic",
      content,
      category,
      // Recorded fact, not an inference — the highest confidence in the vocab.
      confidence: 1,
      sourceType: "operation",
      sourceId,
    });

    const { stored } = await storeMemoryCandidates([candidate], {
      usage: { studentId, callSite: "sage_operation_memory" },
      semanticDedupe: false,
    });
    return stored > 0 ? "stored" : "duplicate";
  } catch (error) {
    logger.error("Operation memory write failed (non-fatal)", {
      sourceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "skipped";
  }
}

export async function recordGoalConfirmationMemory(params: {
  studentId: string;
  goalId: string;
  level: string;
  content: string;
  at?: Date;
}): Promise<OperationMemoryResult> {
  const at = params.at ?? new Date();
  return recordOperationMemory({
    studentId: params.studentId,
    content: goalConfirmedMemoryContent({ level: params.level, content: params.content, at }),
    category: "goal",
    sourceId: `goal:${params.goalId}`,
  });
}

export async function recordCertVerificationMemory(params: {
  studentId: string;
  requirementId: string;
  requirementLabel: string;
  certLabel: string;
  at?: Date;
}): Promise<OperationMemoryResult> {
  const at = params.at ?? new Date();
  return recordOperationMemory({
    studentId: params.studentId,
    content: certVerifiedMemoryContent({
      requirementLabel: params.requirementLabel,
      certLabel: params.certLabel,
      at,
    }),
    category: "progress",
    sourceId: `cert-requirement:${params.requirementId}`,
  });
}

export async function recordDiscoveryOverrideMemory(params: {
  studentId: string;
  clusterLabel: string | null;
  at?: Date;
}): Promise<OperationMemoryResult> {
  const at = params.at ?? new Date();
  return recordOperationMemory({
    studentId: params.studentId,
    content: discoveryOverrideMemoryContent({ clusterLabel: params.clusterLabel, at }),
    category: "progress",
    // One override per student — a re-override updates the same fact.
    sourceId: `discovery-override:${params.studentId}`,
  });
}
