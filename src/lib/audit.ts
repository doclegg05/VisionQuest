import { prismaAdmin as prisma } from "./db";
import { errorForLog } from "./log-error";
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
 * 500: the failure is logged and swallowed. Returns `{ audited }` so the
 * caller can tell the client when a PII-touching action has no audit row.
 *
 * No student identifier in the log line: actor + action localize the
 * failure (.claude/rules/security.md, Data Privacy).
 */
export async function tryLogAuditEvent(
  input: AuditEventInput,
): Promise<{ audited: boolean }> {
  try {
    await logAuditEvent(input);
    return { audited: true };
  } catch (error: unknown) {
    logger.error("audit write failed", {
      alert: "audit_write_failed",
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      error: errorForLog(error),
    });
    return { audited: false };
  }
}

/** Where in the app the staff member viewed the student's data. */
export type StudentViewSurface =
  | "student_detail"
  | "conversations"
  | "export"
  | "sage_operations"
  | "class_roster"
  /** The full archive download: every chat, file and record in one zip. */
  | "archive"
  /** What Sage remembers about the student. */
  | "memories"
  | "mood"
  /** Staff case notes. */
  | "notes"
  /** Form submissions, structured form responses and one response's answers. */
  | "forms"
  /** AI token usage. */
  | "usage"
  /** The SPOKES record. */
  | "spokes"
  /** Pathway suggestions for one of the student's goals. */
  | "pathway"
  /** One failed extraction's stored conversation snapshot. */
  | "failed_extraction"
  /** A file or signed form the student uploaded, downloaded by staff. */
  | "files"
  /** What Sage has noted about the student (`/api/sage/insights`). */
  | "insights"
  /** The student's orientation checklist progress. */
  | "orientation"
  /** One goal's linked resources and plan. */
  | "goal_resources"
  /** The verified student record Sage reads for a staff chat. */
  | "sage_chat";

/**
 * Surfaces written on every read instead of once a day. The archive download
 * hands over the whole record in one file, so each download is its own event:
 * a second copy taken the same afternoon must leave its own row. These skip
 * the same-day lookup below.
 */
const UNSAMPLED_SURFACES: ReadonlySet<StudentViewSurface> = new Set(["archive"]);

interface StudentViewInput {
  actorId: string;
  actorRole: string;
  targetStudentId: string;
  surface: StudentViewSurface;
}

const STUDENT_VIEW_ACTION_PREFIX = "teacher.student.view";

/** Whether the view is on record (written now, or already written today). */
export interface StudentViewResult {
  recorded: boolean;
}

/**
 * Audit a staff READ of a student's data (students are TANF/SNAP recipients —
 * who viewed whose data is a compliance expectation, not just who changed it).
 *
 * Sampled to at most ONE row per (actor, student, surface) per local day.
 * The sampling exists purely to control audit volume — the first view each
 * day is always recorded, so nothing is concealed. Surfaces in
 * `UNSAMPLED_SURFACES` (the archive download) are written on every call.
 *
 * Never throws into the request path. A failed write on a sampled surface is
 * a warning and the read goes on. A failed write on an unsampled surface is
 * logged with `alert: "audit_write_failed"` (as `tryLogAuditEvent` does) and
 * returns `{ recorded: false }`: the caller must then refuse to hand over the
 * file, because that download would leave no trace at all.
 */
export async function recordStudentView(input: StudentViewInput): Promise<StudentViewResult> {
  const unsampled = UNSAMPLED_SURFACES.has(input.surface);
  try {
    const action = `${STUDENT_VIEW_ACTION_PREFIX}.${input.surface}`;
    if (!unsampled && (await viewedToday(input, action))) return { recorded: true };

    await logAuditEvent({
      actorId: input.actorId,
      actorRole: input.actorRole,
      action,
      targetType: "student",
      targetId: input.targetStudentId,
      summary: `Viewed student data (${input.surface}).`,
      metadata: { surface: input.surface },
    });
    return { recorded: true };
  } catch (error: unknown) {
    // No student identifier here: server logs must stay PII-free
    // (.claude/rules/security.md); actor + surface localize the failure.
    if (unsampled) {
      logger.error("recordStudentView failed", {
        alert: "audit_write_failed",
        actorId: input.actorId,
        actorRole: input.actorRole,
        surface: input.surface,
        error: errorForLog(error),
      });
    } else {
      logger.warn("recordStudentView failed", {
        actorId: input.actorId,
        actorRole: input.actorRole,
        surface: input.surface,
        error: errorForLog(error),
      });
    }
    return { recorded: false };
  }
}

async function viewedToday(input: StudentViewInput, action: string): Promise<boolean> {
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
  return existing !== null;
}
