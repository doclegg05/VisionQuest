import { NextResponse } from "next/server";
import { prismaAdmin } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";
import { withErrorHandler } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { getRoleHomePath } from "@/lib/role-home";
import { limitInviteAttempts, withInviteRefusals } from "@/lib/staff-invite-http";
import { acceptStaffInvite, acceptStaffInviteSchema } from "@/lib/staff-invites";

/**
 * Unauthenticated: the person has no account yet. The token is 256 bits of
 * randomness; an emailed invite also needs the 6-digit email code (Ruling
 * R21), so the limiters bound code guessing: 5 per IP and 20 route-wide per
 * 15 minutes, as `register-teacher` does. The proxy's Origin check covers this
 * path; it is not a public exception.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const limited = await limitInviteAttempts(req, "staff-invite-accept");
  if (limited) return limited;

  const body = await parseBody(req, acceptStaffInviteSchema);

  return withInviteRefusals(async () => {
    const { staffId } = await acceptStaffInvite(body);
    const account = await prismaAdmin.student.findUnique({
      where: { id: staffId },
      select: { id: true, role: true, sessionVersion: true },
    });
    if (!account) throw new Error("Accepted staff account was not found.");

    await setSessionCookie(account.id, account.role, account.sessionVersion);
    return NextResponse.json({
      success: true,
      data: { role: account.role, redirectTo: getRoleHomePath(account.role) },
    });
  });
});
