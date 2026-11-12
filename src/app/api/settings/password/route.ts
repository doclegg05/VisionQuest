import { NextRequest, NextResponse } from "next/server";
import { forbidden, withAuth, type Session } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { setSessionCookie } from "@/lib/auth";
import { clientIpAddress } from "@/lib/client-ip";
import { assertNotDemoAccount } from "@/lib/demo/guards";
import { errorForLog } from "@/lib/log-error";
import { studentLogKey } from "@/lib/log-keys";
import { logger } from "@/lib/logger";
import { changeOwnPassword, passwordChangeRefusal } from "@/lib/password-change";
import { changePasswordSchema, parseBody } from "@/lib/schemas";

interface OwnPasswordAudit {
  action: "auth.password.change" | "auth.password.change_failed";
  summary: string;
  ip: string;
}

/**
 * Writes the audit row for a student's own attempt. It is written after the
 * answer is decided, and a failed write must not change that answer: on the
 * success path the password is already changed and the cookie reissued, so a
 * 500 would tell the student it failed and send them back to try a current
 * password that is no longer current. The failure is logged in its place,
 * under the student's log key and never their id.
 */
async function auditOwnAttempt(session: Session, { action, summary, ip }: OwnPasswordAudit): Promise<void> {
  try {
    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action,
      targetType: "student",
      targetId: session.id,
      summary,
      metadata: { ip },
    });
  } catch (error: unknown) {
    logger.error("audit write failed", {
      alert: "audit_write_failed",
      action,
      student: studentLogKey(session.id),
      error: errorForLog(error),
    });
  }
}

/**
 * A signed-in student changes their own password.
 *
 * Staff set a student's first password and every reset, so until the student
 * changes it a staff member knows it. This is the route the change-password
 * screen and the Settings section post to, and the one write a session held
 * to that screen may make (src/lib/password-change-gate.ts).
 *
 * The checks and the write live in src/lib/password-change.ts. On success the
 * old session version is dead, so this response reissues the cookie for the
 * new one, no longer held; every other device is signed out.
 */
export const POST = withAuth(async (session, req: NextRequest) => {
  // First, ahead of everything: a demo account has no password, and a
  // visitor gets the demo wording before any work is done.
  assertNotDemoAccount(session);
  if (session.role !== "student") {
    throw forbidden("Only student accounts can change a password here.");
  }

  // Trims both passwords and applies the length rule, before the budget or
  // the stored password is touched.
  const body = await parseBody(req, changePasswordSchema);
  const result = await changeOwnPassword({
    accountId: session.id,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  });

  const ip = clientIpAddress(req);
  if (result.kind === "wrong_current_password") {
    await auditOwnAttempt(session, {
      action: "auth.password.change_failed",
      summary: "Student tried to change their password with a wrong current password.",
      ip,
    });
  }
  if (result.kind !== "changed") {
    const refusal = passwordChangeRefusal(result);
    return NextResponse.json({ error: refusal.error, code: refusal.code }, { status: refusal.status });
  }

  // Not held to the change-password screen: the write cleared the flag.
  await setSessionCookie(session.id, result.role, result.sessionVersion, { mustChangePassword: false });
  await auditOwnAttempt(session, {
    action: "auth.password.change",
    summary: "Student changed their own password. Their other sessions were signed out.",
    ip,
  });

  return NextResponse.json({ success: true, data: { changed: true } });
});
