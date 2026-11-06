import { NextResponse } from "next/server";
import { prismaAdmin } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";
import { clientIpBucket } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { withErrorHandler } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { getRoleHomePath } from "@/lib/role-home";
import { withInviteRefusals } from "@/lib/staff-invite-http";
import { acceptStaffInvite, acceptStaffInviteSchema } from "@/lib/staff-invites";

const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Unauthenticated: the person has no account yet. The token is the credential,
 * 256 bits of randomness, so the IP limiter only slows abuse of the endpoint.
 * The proxy's Origin check covers this path; it is not a public exception.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const rl = await rateLimit(`staff-invite-accept:${clientIpBucket(req)}`, ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

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
