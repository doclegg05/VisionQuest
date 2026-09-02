import { prismaAdmin as prisma } from "./db";
import { invalidateSessionCache } from "./auth";
import { logAuditEvent } from "./audit";
import { logger } from "./logger";
import { studentLogKey } from "./log-keys";

/**
 * Audit actor for promotions performed with the shared ADMIN_KEY. The key is a
 * registration secret, not an authenticated identity, so the audit row must
 * not be attributed to the promoted account (review 2026-09-01, F11 / SEC-05).
 */
export const ADMIN_KEY_ACTOR = "admin-key";

/** Request fields the promotion path deliberately ignores. */
export const PROMOTION_IGNORED_FIELDS = ["password", "displayName"] as const;

interface PromoteTeacherToAdminInput {
  accountId: string;
  ip: string;
}

export interface PromotedStaffAccount {
  id: string;
  role: string;
}

/**
 * Promote an existing, active teacher to admin on behalf of an ADMIN_KEY
 * holder. Role and sessionVersion only: the request's password and display
 * name are never written, MFA state is untouched, every pre-promotion session
 * dies with the version bump, and no session is issued. The caller has already
 * checked that the row is an active, non-offboarded teacher.
 *
 * The audit row is best-effort. By the time it is written the role change has
 * committed, so a failed audit must not turn a completed promotion into a 500;
 * it is logged with an alert key instead (the after-write pattern from review
 * finding F26).
 */
export async function promoteTeacherToAdmin({
  accountId,
  ip,
}: PromoteTeacherToAdminInput): Promise<PromotedStaffAccount> {
  const promoted = await prisma.student.update({
    where: { id: accountId },
    data: { role: "admin", sessionVersion: { increment: 1 } },
    select: { id: true, role: true },
  });
  invalidateSessionCache(promoted.id);

  try {
    // targetId identifies the row; no email, name, or log-key digest is stored
    // (src/lib/log-keys.ts: the digest is a logging aid, not a stored key).
    await logAuditEvent({
      actorId: ADMIN_KEY_ACTOR,
      actorRole: ADMIN_KEY_ACTOR,
      action: "auth.promote_to_admin",
      targetType: "student",
      targetId: promoted.id,
      summary:
        "Teacher promoted to admin with ADMIN_KEY; " +
        "password, display name and MFA unchanged; existing sessions invalidated.",
      metadata: {
        ip,
        actor: ADMIN_KEY_ACTOR,
        previousRole: "teacher",
        newRole: promoted.role,
        ignoredFields: [...PROMOTION_IGNORED_FIELDS],
      },
    });
  } catch (error: unknown) {
    // No raw id: server logs carry no student identifier (.claude/rules/security.md).
    logger.error("Promotion audit write failed after the role change committed", {
      alert: "audit_write_failed",
      action: "auth.promote_to_admin",
      target: studentLogKey(promoted.id),
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return promoted;
}
