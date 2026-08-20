/**
 * Sage operation ledger (Phase 3, TEKTON pattern).
 *
 * Every write tool execution records a SageOperation row + an AuditLog entry.
 * Deterministic ids (op-{timestamp}-{slug}) make retried tool invocations
 * idempotent: re-recording the same operation id is a no-op update, not a
 * duplicate row.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

export type OperationStatus = "proposed" | "confirmed" | "executed" | "failed" | "rejected";
export type OperationActorType = "student" | "teacher" | "admin" | "system";

/** Deterministic id; clock injected for testability (no Date.now() inline). */
export function operationIdFor(slug: string, clock: Date): string {
  const normalizedSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `op-${clock.getTime()}-${normalizedSlug}`;
}

export interface RecordOperationParams {
  id: string;
  actorType: OperationActorType;
  actorId: string;
  actorRole: string;
  /**
   * The student the operation acted ON. Equals actorId for student
   * self-service writes; the target student for staff on-behalf-of writes.
   * Null when the operation has no student target.
   */
  targetStudentId?: string | null;
  toolName: string;
  status: OperationStatus;
  payload: Prisma.InputJsonValue;
  resultSummary?: string;
}

export async function recordOperation(params: RecordOperationParams): Promise<void> {
  await prisma.sageOperation.upsert({
    where: { id: params.id },
    create: {
      id: params.id,
      actorType: params.actorType,
      actorId: params.actorId,
      targetStudentId: params.targetStudentId ?? null,
      toolName: params.toolName,
      status: params.status,
      payload: params.payload,
      resultSummary: params.resultSummary ?? null,
    },
    update: {
      status: params.status,
      resultSummary: params.resultSummary ?? null,
    },
  });

  await logAuditEvent({
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: `sage_tool.${params.toolName}.${params.status}`,
    targetType: "sage_operation",
    targetId: params.id,
    summary: params.resultSummary ?? `${params.toolName} ${params.status}`,
  });
}

// =============================================================================
// Teacher-facing ledger viewer (read side).
//
// SCOPE GUARD: `SageOperation.payload` and `.resultSummary` are raw tool
// arguments / generated summaries. Several write tools embed quoted
// user-authored free text in them — e.g. update_goal_status's confirm
// summary includes `goal.content.slice(0, 80)`, and propose_resume_edit's
// includes a preview of the student's actual resume section text. The
// crisis-era "no transcript access" decision (MEMORY.md 2026-07-20) means a
// teacher-facing ledger view must never surface conversation-adjacent free
// text, so the functions below are built ONLY from `toolName`, `status`,
// and `actorType` — payload and resultSummary are never selected out of the
// database for this surface, let alone rendered.
// =============================================================================

/**
 * Plain-language description of what a write tool changed, keyed by the
 * exact tool names in src/lib/sage/agent/write-tools.ts and
 * src/lib/sage/agent/career-tools.ts (the only two modules that call
 * recordOperation). An unrecognized tool name (a future tool this map
 * hasn't been updated for) falls back to a humanized version of the raw
 * name rather than failing closed.
 */
const OPERATION_TARGET_LABELS: Record<string, string> = {
  submit_form: "Filed a signed orientation form",
  file_document: "Filed an uploaded document",
  update_goal_status: "Updated a goal's status",
  save_job: "Saved a job listing",
  add_portfolio_item: "Added a portfolio item",
  edit_portfolio_item: "Edited a portfolio item",
  delete_portfolio_item: "Removed a portfolio item",
  book_appointment: "Booked an appointment",
  mark_certification_complete: "Marked a certification requirement complete",
  update_application_status: "Updated a job application's status",
  propose_resume_edit: "Edited a resume section",
  tailor_application: "Created a tailored resume and cover letter",
};

const OPERATION_STATUS_LABELS: Record<OperationStatus, string> = {
  proposed: "Proposed — awaiting confirmation",
  confirmed: "Confirmed",
  executed: "Completed",
  failed: "Failed",
  rejected: "Rejected",
};

const OPERATION_ACTOR_LABELS: Record<OperationActorType, string> = {
  student: "Student",
  teacher: "Teacher",
  admin: "Admin",
  system: "System",
};

function humanizeIdentifier(raw: string): string {
  const spaced = raw.replace(/_/g, " ").trim();
  if (!spaced) return raw;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function describeOperationTarget(toolName: string): string {
  return OPERATION_TARGET_LABELS[toolName] ?? humanizeIdentifier(toolName);
}

export function describeOperationStatus(status: string): string {
  return OPERATION_STATUS_LABELS[status as OperationStatus] ?? humanizeIdentifier(status);
}

export function describeOperationActor(actorType: string): string {
  return OPERATION_ACTOR_LABELS[actorType as OperationActorType] ?? humanizeIdentifier(actorType);
}

/** Safe, allowlisted shape of a ledger row for the teacher-facing viewer. */
export interface SageOperationLedgerRow {
  id: string;
  toolName: string;
  targetSummary: string;
  status: string;
  statusLabel: string;
  actorRole: string;
  actorRoleLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface FetchOperationsForStudentOptions {
  /** 1-indexed page number. Defaults to 1. */
  page?: number;
  /** Rows per page, clamped to [1, 100]. Defaults to 20. */
  limit?: number;
}

export interface FetchOperationsForStudentResult {
  operations: SageOperationLedgerRow[];
  hasMore: boolean;
}

const DEFAULT_OPERATION_PAGE_LIMIT = 20;
const MAX_OPERATION_PAGE_LIMIT = 100;

/**
 * Sage write-operation ledger for one student, newest first.
 *
 * Scoped to `actorType: "student", actorId: studentId` — the only reliable
 * student linkage SageOperation supports today (there is no
 * `targetStudentId` column on the model). Three tools (submit_form,
 * file_document, update_goal_status) allow a teacher to invoke them "as"
 * a student via chat's targetStudentId; those rows persist with the
 * teacher as actor, so they are NOT attributed to the student here. See
 * the Known Issues / Open Items note this ships with for the follow-up.
 */
export async function fetchOperationsForStudent(
  studentId: string,
  options: FetchOperationsForStudentOptions,
): Promise<FetchOperationsForStudentResult> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_OPERATION_PAGE_LIMIT, 1), MAX_OPERATION_PAGE_LIMIT);
  const page = Math.max(options.page ?? 1, 1);

  const rows = await prisma.sageOperation.findMany({
    where: { actorType: "student", actorId: studentId },
    select: {
      id: true,
      toolName: true,
      status: true,
      actorType: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * limit,
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    operations: pageRows.map((row) => ({
      id: row.id,
      toolName: row.toolName,
      targetSummary: describeOperationTarget(row.toolName),
      status: row.status,
      statusLabel: describeOperationStatus(row.status),
      actorRole: row.actorType,
      actorRoleLabel: describeOperationActor(row.actorType),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    hasMore,
  };
}
