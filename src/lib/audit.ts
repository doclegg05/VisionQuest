import { prismaAdmin as prisma } from "./db";
import { logger } from "./logger";

interface AuditEventInput {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function logAuditEvent(input: AuditEventInput) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      summary: input.summary ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

/**
 * `logAuditEvent` for a request whose real work has already committed (an
 * archive uploaded, an enrollment moved). AuditLog is admin-only under RLS
 * and lives on the admin client, so it cannot join the caller's transaction;
 * writing it before the work would record actions that then failed. So it is
 * written after, and a failed write must not turn a finished request into a
 * 500: the failure is logged and swallowed. Returns whether the row landed.
 *
 * No student identifier in the log line: actor + action localize the
 * failure (.claude/rules/security.md, Data Privacy).
 */
export async function tryLogAuditEvent(input: AuditEventInput): Promise<boolean> {
  try {
    await logAuditEvent(input);
    return true;
  } catch (error: unknown) {
    logger.warn("audit write failed", {
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Where in the app the staff member viewed the student's data. */
export type StudentViewSurface = "student_detail" | "conversations" | "export" | "sage_operations";

interface StudentViewInput {
  actorId: string;
  actorRole: string;
  targetStudentId: string;
  surface: StudentViewSurface;
}

const STUDENT_VIEW_ACTION_PREFIX = "teacher.student.view";

/**
 * Audit a staff READ of a student's data (students are TANF/SNAP recipients —
 * who viewed whose data is a compliance expectation, not just who changed it).
 *
 * Sampled to at most ONE row per (actor, student, surface) per local day.
 * The sampling exists purely to control audit volume — the first view each
 * day is always recorded, so nothing is concealed.
 *
 * Fire-and-forget safe: never throws into the request path. Failures are
 * logged as warnings and swallowed.
 */
export async function recordStudentView(input: StudentViewInput): Promise<void> {
  try {
    const action = `${STUDENT_VIEW_ACTION_PREFIX}.${input.surface}`;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const existing = await prisma.auditLog.findFirst({
      where: {
        actorId: input.actorId,
        action,
        targetId: input.targetStudentId,
        createdAt: { gte: startOfToday },
      },
      select: { id: true },
    });
    if (existing) return;

    await logAuditEvent({
      actorId: input.actorId,
      actorRole: input.actorRole,
      action,
      targetType: "student",
      targetId: input.targetStudentId,
      summary: `Viewed student data (${input.surface}).`,
      metadata: { surface: input.surface },
    });
  } catch (error: unknown) {
    // Read auditing must never break or delay the request that triggered it.
    // No student identifier here: server logs must stay PII-free
    // (.claude/rules/security.md); actor + surface localize the failure.
    logger.warn("recordStudentView failed", {
      actorId: input.actorId,
      actorRole: input.actorRole,
      surface: input.surface,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
