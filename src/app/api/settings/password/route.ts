import { NextRequest, NextResponse } from "next/server";
import { forbidden, withAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { setSessionCookie } from "@/lib/auth";
import { clientIpBucket } from "@/lib/client-ip";
import { assertNotDemoAccount } from "@/lib/demo/guards";
import { changeOwnPassword, passwordChangeRefusal } from "@/lib/password-change";
import { changePasswordSchema, parseBody } from "@/lib/schemas";

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

  const ip = clientIpBucket(req);
  if (result.kind === "wrong_current_password") {
    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "auth.password.change_failed",
      targetType: "student",
      targetId: session.id,
      summary: "Student tried to change their password with a wrong current password.",
      metadata: { ip },
    });
  }
  if (result.kind !== "changed") {
    const refusal = passwordChangeRefusal(result);
    return NextResponse.json({ error: refusal.error, code: refusal.code }, { status: refusal.status });
  }

  // Not held to the change-password screen: the write cleared the flag.
  await setSessionCookie(session.id, result.role, result.sessionVersion, { mustChangePassword: false });
  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "auth.password.change",
    targetType: "student",
    targetId: session.id,
    summary: "Student changed their own password. Their other sessions were signed out.",
    metadata: { ip },
  });

  return NextResponse.json({ success: true, data: { changed: true } });
});
