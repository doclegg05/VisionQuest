import { NextResponse } from "next/server";
import { prismaAdmin } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";
import { withErrorHandler } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { getRoleHomePath } from "@/lib/role-home";
import { limitInviteAttemptsByIp, limitInviteAttemptsByToken, withInviteRefusals } from "@/lib/staff-invite-http";
import { acceptStaffInvite, acceptStaffInviteSchema } from "@/lib/staff-invites";

/**
 * Unauthenticated: the person has no account yet. The token is 256 bits of
 * randomness; an emailed invite also needs the 6-digit email code (Ruling
 * R21). Limits: 5 per IP before the body is read, then 20 per invite, per 15
 * minutes; code guessing is capped per invite. The proxy's Origin check covers this
 * path; it is not a public exception.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const limitedByIp = await limitInviteAttemptsByIp(req, "staff-invite-accept");
  if (limitedByIp) return limitedByIp;

  const body = await parseBody(req, acceptStaffInviteSchema);
  const limitedByInvite = await limitInviteAttemptsByToken("staff-invite-accept", body.token);
  if (limitedByInvite) return limitedByInvite;

  return withInviteRefusals(async () => {
    const { staffId } = await acceptStaffInvite(body);
    const account = await prismaAdmin.student.findUnique({
      where: { id: staffId },
      select: { id: true, role: true, sessionVersion: true },
    });
    if (!account) throw new Error("Accepted staff account was not found.");

    // The new staff member typed this password just now, so nobody else knows it.
    await setSessionCookie(account.id, account.role, account.sessionVersion, { mustChangePassword: false });
    return NextResponse.json({
      success: true,
      data: { role: account.role, redirectTo: getRoleHomePath(account.role) },
    });
  });
});
