// =============================================================================
// Chat-context write-through invalidation — the write side of Sage freshness.
//
// Sage's per-student chat context is cached in layers (`chat:*` keys, see the
// registry in src/lib/cache.ts). Before this module, NO write invalidated
// them, so a native change (teacher confirms a goal, student books an
// appointment) stayed invisible to Sage for the TTL — 180-600s
// (scripts/sage-freshness-eval.mjs Group B documented six such windows).
//
// WHY THE DB CLIENT, NOT PER-HELPER CALLS: the writes that feed these layers
// are scattered across route handlers (POST /api/goals, /api/forms/sign,
// /api/appointments/book, teacher routes), lib helpers (propose-goal,
// orientation-completion, cert-actions, agent write-tools), and background
// extraction (src/lib/chat/post-response.ts). There is no shared lib-helper
// choke point — but every one of those paths writes through the `prisma`
// client in src/lib/db.ts. A query extension there (this module supplies its
// logic) is the single boundary no current or future write path can skip.
//
// Shape: `resolveChatContextInvalidation` is a pure function from a Prisma
// write (model, operation, args, result) to an invalidation scope —
// unit-tested without a DB. `applyChatContextWriteThrough` is the thin
// fire-safe shell db.ts calls AFTER the write resolves: a cache-invalidation
// failure must never fail the write.
//
// Known, accepted races (both bounded by the existing TTLs):
//   - Interactive transactions invalidate per-operation before commit; a
//     concurrent read between invalidation and commit can re-cache pre-commit
//     state.
//   - A read that computes from pre-write DB state can `set` after a
//     concurrent write's invalidation.
// =============================================================================

import { Prisma } from "@prisma/client";
import {
  invalidateAllChatContext,
  invalidateChatContext,
} from "@/lib/cache";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";

export type ChatContextInvalidation =
  | { scope: "none" }
  | { scope: "all" }
  | { scope: "students"; studentIds: string[] }
  // CertRequirement: one student's rows, through their certification. The
  // shell resolves the owners (`CertificationOwners`); unresolved means "all".
  | { scope: "certifications"; certificationIds: string[] };

/** The students who own these certifications, as found in the database. */
export type CertificationOwners = (certificationIds: readonly string[]) => Promise<readonly string[]>;

const NONE: ChatContextInvalidation = { scope: "none" };
const ALL: ChatContextInvalidation = { scope: "all" };

/** Prisma model-level write operations (as named in query extension hooks). */
const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

/**
 * Models with a `studentId` scalar whose rows the chat context assembly reads
 * (src/lib/chat/context.ts, src/lib/sage/situational-snapshot.ts,
 * src/lib/sage/context-bundle.ts via fetch-readiness-data, memory/profile.ts).
 * Typed against Prisma.ModelName so a typo or renamed model fails tsc instead
 * of silently never invalidating.
 */
const STUDENT_SCOPED_MODEL_LIST: readonly Prisma.ModelName[] = [
  "Goal",
  "OrientationProgress",
  "FormSubmission",
  "CareerDiscovery",
  "Appointment",
  "Certification",
  "SageInsight",
  "SageMemory",
  "ResumeData",
  "PortfolioItem",
  "PublicCredentialPage",
  // Progression carries the XP/level state that getSituationalSnapshot
  // renders as "Level N, X XP" INSIDE the cached chat:snapshot layer
  // (situational-snapshot.ts, 180s TTL) via fetchStudentReadinessData. It
  // is safe to watch despite XP moving often, because awardEvent is
  // idempotent on (sourceType, sourceId) and returns before touching
  // Progression on a duplicate — the chat award keys on the conversation
  // id, so it fires once per conversation, not once per turn.
  "Progression",
  // The student layout keeps a satisfied gate per student for 10 minutes
  // (src/lib/dashboard/student-gates.ts, keys under chat:snapshot:). Both are
  // monotonic today, but a future answer reset or consent revocation must
  // reach the gate at once, not after the TTL. Both are rare writes.
  "SecurityQuestionAnswer",
  "ConsentRecord",
];

/**
 * Rows without a per-student scope that shape every student's context
 * (orientation totals, cert requirement templates).
 */
const GLOBAL_MODEL_LIST: readonly Prisma.ModelName[] = [
  "OrientationItem",
  "CertTemplate",
];

/**
 * Keyed by certificationId, not studentId: a write clears the certification's
 * owner, looked up after the write, and everyone when the owner is not found.
 */
const CERT_REQUIREMENT_MODEL: Prisma.ModelName = "CertRequirement";

/**
 * Conversation is special-cased: the context only reads its `summary`
 * (prior-conversation context in chat:base-context). Stage/title/active flip
 * on nearly every turn, and invalidating on those would defeat the cache.
 */
const CONVERSATION_MODEL: Prisma.ModelName = "Conversation";

// Deliberately NOT watched, with reasons:
//   - Message, ProgressionEvent: written on essentially every chat turn. The
//     surfaces they feed (message count, recentEvents) are read through
//     context-bundle.ts, which is NOT wrapped in a `cached("chat:...")` call
//     — so there is no cached copy of them to go stale.
//   - Student: frequent auth/activity writes; no asserted context surface
//     reads mutable Student fields.
//
// Progression used to sit in this list on the same reasoning, and that was a
// bug: XP and level ARE cached, in the chat:snapshot layer. Before adding a
// model here, check every `cached("chat:...")` call site for a transitive
// read of it — situational-snapshot.ts reaches Progression indirectly
// through fetchStudentReadinessData, which is exactly how it was missed.
const STUDENT_SCOPED_MODELS: ReadonlySet<string> = new Set(STUDENT_SCOPED_MODEL_LIST);
const GLOBAL_MODELS: ReadonlySet<string> = new Set(GLOBAL_MODEL_LIST);

/** Cheap gate for the db.ts extension: is this a write we may care about? */
export function isChatContextWrite(
  model: string | undefined,
  operation: string,
): boolean {
  if (!model || !WRITE_OPERATIONS.has(operation)) return false;
  return (
    STUDENT_SCOPED_MODELS.has(model) ||
    GLOBAL_MODELS.has(model) ||
    model === CERT_REQUIREMENT_MODEL ||
    model === CONVERSATION_MODEL
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringProp(value: unknown, key: string): string | null {
  const record = asRecord(value);
  const prop = record?.[key];
  return typeof prop === "string" ? prop : null;
}

/** Collect `key` (studentId, certificationId) from one data/create/update payload or an array of them. */
function collectFromPayload(payload: unknown, into: Set<string>, key = "studentId"): void {
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const id = stringProp(entry, key);
      if (id) into.add(id);
    }
    return;
  }
  const id = stringProp(payload, key);
  if (id) into.add(id);
}

/**
 * Collect studentIds from a write's `where` clause: a plain-string
 * `studentId` (unique or equality filter), or any compound-unique value like
 * `studentId_itemId: { studentId, itemId }`. Filter objects
 * (`studentId: { in: [...] }`) are ignored — the caller falls back to "all".
 */
function collectFromWhere(where: unknown, into: Set<string>, key = "studentId"): void {
  const record = asRecord(where);
  if (!record) return;
  const direct = record[key];
  if (typeof direct === "string") into.add(direct);
  for (const value of Object.values(record)) {
    const nested = stringProp(value, key);
    if (nested) into.add(nested);
  }
}

/** Every `key` value a write names in its args or returned row(s). */
function collectIds(args: unknown, result: unknown, key: string): Set<string> {
  const ids = new Set<string>();
  const argsRecord = asRecord(args);
  if (argsRecord) {
    collectFromPayload(argsRecord.data, ids, key);
    collectFromPayload(argsRecord.create, ids, key); // upsert
    collectFromPayload(argsRecord.update, ids, key); // upsert
    collectFromWhere(argsRecord.where, ids, key);
  }
  // Row-returning operations (create/update/upsert/delete/…AndReturn) carry
  // the id unless the caller's `select` dropped it.
  collectFromPayload(result, ids, key);
  return ids;
}

function conversationWriteTouchesSummary(args: unknown): boolean {
  const record = asRecord(args);
  if (!record) return false;
  for (const key of ["data", "create", "update"]) {
    const payload = asRecord(record[key]);
    if (payload && "summary" in payload) return true;
  }
  return false;
}

/**
 * Pure resolver: which chat-context invalidation does this Prisma write
 * require? Never reads the DB; unknown shapes degrade to "all" (safe
 * over-invalidation), never to a silent "none" on a watched model.
 */
export function resolveChatContextInvalidation(
  model: string | undefined,
  operation: string,
  args: unknown,
  result: unknown,
): ChatContextInvalidation {
  if (!isChatContextWrite(model, operation)) return NONE;
  if (model === CONVERSATION_MODEL && !conversationWriteTouchesSummary(args)) {
    return NONE;
  }
  if (model && GLOBAL_MODELS.has(model)) return ALL;
  if (model === CERT_REQUIREMENT_MODEL) {
    const certificationIds = collectIds(args, result, "certificationId");
    return certificationIds.size > 0 ? { scope: "certifications", certificationIds: [...certificationIds] } : ALL;
  }

  const studentIds = collectIds(args, result, "studentId");
  return studentIds.size > 0
    ? { scope: "students", studentIds: [...studentIds] }
    : ALL;
}

/** The owning students, or null when any certification's owner was not found. */
async function ownersOf(certificationIds: readonly string[], owners: CertificationOwners | undefined): Promise<readonly string[] | null> {
  if (!owners) return null;
  const studentIds = await owners(certificationIds);
  // Fewer owners than certifications can mean one was not found (deleted, or
  // created in a transaction not yet committed): clear everyone instead.
  return studentIds.length >= new Set(certificationIds).size ? studentIds : null;
}

function invalidateStudents(studentIds: readonly string[]): void {
  for (const studentId of studentIds) invalidateChatContext(studentId);
}

/**
 * Fire-safe shell for src/lib/db.ts: resolve and apply the invalidation for a
 * completed write. Never rejects: a cache miss costs a re-query; a failed
 * write costs the user their action. Every scope but "certifications" is
 * applied before the first await, so a caller that does not await still sees
 * it at once. `owners` resolves a CertRequirement write's certifications to
 * students; without it, or when it fails, such a write clears everyone.
 */
export async function applyChatContextWriteThrough(
  model: string | undefined,
  operation: string,
  args: unknown,
  result: unknown,
  owners?: CertificationOwners,
): Promise<void> {
  try {
    const invalidation = resolveChatContextInvalidation(model, operation, args, result);
    if (invalidation.scope === "none") return;
    if (invalidation.scope === "all") return invalidateAllChatContext();
    if (invalidation.scope === "students") return invalidateStudents(invalidation.studentIds);
    const studentIds = await ownersOf(invalidation.certificationIds, owners);
    if (studentIds) invalidateStudents(studentIds);
    else invalidateAllChatContext();
  } catch (error) {
    // A failed owner lookup still clears: over-invalidation is safe.
    invalidateAllChatContext();
    logger.warn("chat-context write-through invalidation failed; write unaffected", {
      model: model ?? "(raw)",
      operation,
      error: errorForLog(error),
    });
  }
}
