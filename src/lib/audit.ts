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

/** Where in the app the staff member viewed the student's data. */
export type StudentViewSurface = "student_detail" | "conversations" | "export";

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
    logger.warn("recordStudentView failed", {
      targetStudentId: input.targetStudentId,
      surface: input.surface,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
