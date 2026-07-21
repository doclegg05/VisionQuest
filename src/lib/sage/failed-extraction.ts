import { logger } from "@/lib/logger";

/**
 * Dead-letter store for failed background AI extractions (P2-1).
 *
 * When an extractor (goals, mood, classroom, discovery) exhausts its retries,
 * the input snapshot is persisted to the FailedExtraction table so staff can
 * review it — and, for goal extraction, replay it — instead of the
 * Sage-proposed data vanishing into logs.
 *
 * PRIVACY: `payload` contains student conversation text. That is acceptable —
 * it is the same data as Message rows, stored in the same database behind
 * teacher/admin-only RLS. Retention follows the chat-transcript policy in
 * docs/DATA_RETENTION_POLICY.md.
 */

/** extractorKey for the goal extractor — the only replayable extractor today. */
export const GOAL_EXTRACTION_KEY = "goal_extraction";

/** Hard cap on the persisted input snapshot. */
export const MAX_FAILED_EXTRACTION_PAYLOAD_CHARS = 8000;

const MAX_ERROR_CHARS = 2000;

export interface FailedExtractionInput {
  studentId: string;
  conversationId?: string | null;
  /** Sage message id the goal proposals attribute to — required to replay. */
  sourceMessageId?: string | null;
  /** "goal_extraction" or a retryWithBackoff alertKey ("mood_extraction_exhausted", …). */
  extractorKey: string;
  /** The input snapshot the extractor needed; capped at 8000 chars. */
  payload: string;
  error: string;
  attempts: number;
}

/**
 * Persist a dead-letter row for an exhausted extraction. NEVER throws —
 * dead-lettering a failure must not create a second failure in the
 * fire-and-forget extractor pipeline.
 *
 * Uses `prismaAdmin` (mirrors src/lib/audit.ts): extractors run as
 * fire-and-forget background work and from cron, where the request's RLS
 * context may be gone — the write must not silently fail closed under
 * `vq_app`. The import is lazy so unit tests of the extractors/retry wrapper
 * never instantiate a PrismaClient at module load.
 */
export async function recordFailedExtraction(input: FailedExtractionInput): Promise<void> {
  try {
    const { prismaAdmin } = await import("@/lib/db");
    await prismaAdmin.failedExtraction.create({
      data: {
        studentId: input.studentId,
        conversationId: input.conversationId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        extractorKey: input.extractorKey,
        payload: input.payload.slice(0, MAX_FAILED_EXTRACTION_PAYLOAD_CHARS),
        error: input.error.slice(0, MAX_ERROR_CHARS),
        attempts: input.attempts,
      },
    });
  } catch (error: unknown) {
    logger.warn("Failed to record failed extraction", {
      studentId: input.studentId,
      extractorKey: input.extractorKey,
      error: String(error),
    });
  }
}

// ─── Goal-extraction payload codec ───────────────────────────────────────────
// Both sides of the replay round-trip live here, next to the store: the goal
// extractor serializes its input on exhaustion, and the teacher replay route
// parses it back into extractGoals() arguments.

export interface GoalExtractionSnapshot {
  v: 1;
  stage: string;
  programType: string | null;
  messages: { role: "user" | "model"; content: string }[];
}

/**
 * Serialize the goal extractor's input window into a JSON snapshot that fits
 * the payload cap while STAYING valid JSON (a blind slice would corrupt it
 * and make the row unreplayable). Oldest messages drop first; a single
 * oversized message gets its content halved until the envelope fits.
 */
export function serializeGoalExtractionPayload(
  messages: { role: "user" | "model"; content: string }[],
  stage: string,
  programType: string | null,
): string {
  const encode = (window: GoalExtractionSnapshot["messages"]): string =>
    JSON.stringify({ v: 1, stage, programType, messages: window } satisfies GoalExtractionSnapshot);

  let window = [...messages];
  let json = encode(window);

  while (json.length > MAX_FAILED_EXTRACTION_PAYLOAD_CHARS && window.length > 1) {
    window = window.slice(1);
    json = encode(window);
  }

  let cap = MAX_FAILED_EXTRACTION_PAYLOAD_CHARS;
  while (json.length > MAX_FAILED_EXTRACTION_PAYLOAD_CHARS && cap > 0) {
    cap = Math.floor(cap / 2);
    window = window.map((m) => ({ ...m, content: m.content.slice(0, cap) }));
    json = encode(window);
  }

  return json;
}

function isSnapshotMessage(value: unknown): value is GoalExtractionSnapshot["messages"][number] {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (m.role === "user" || m.role === "model") && typeof m.content === "string";
}

/**
 * Parse a stored goal-extraction payload back into extractGoals() inputs.
 * Returns null for anything malformed — callers treat that as "not
 * replayable" rather than throwing.
 */
export function parseGoalExtractionPayload(payload: string): GoalExtractionSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const p = parsed as Record<string, unknown>;
  if (p.v !== 1 || typeof p.stage !== "string" || !Array.isArray(p.messages)) return null;

  const messages = p.messages.filter(isSnapshotMessage);
  if (messages.length === 0) return null;

  return {
    v: 1,
    stage: p.stage,
    programType: typeof p.programType === "string" ? p.programType : null,
    messages,
  };
}
