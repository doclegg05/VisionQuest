import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandler } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { requestStaffInviteCode } from "@/lib/staff-invite-email";
import { limitInviteAttemptsByIp, limitInviteAttemptsByToken } from "@/lib/staff-invite-http";

const requestCodeSchema = z.object({ token: z.string().min(1).max(128) });

/**
 * Unauthenticated: email a 6-digit accept code for an emailed invite (Ruling
 * R21). The answer is the same whether or not the token is real, usable or
 * emailed, so the route reveals nothing about invites. Limited like accept.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const limitedByIp = await limitInviteAttemptsByIp(req, "staff-invite-code");
  if (limitedByIp) return limitedByIp;

  const { token } = await parseBody(req, requestCodeSchema);
  const limitedByInvite = await limitInviteAttemptsByToken("staff-invite-code", token);
  if (limitedByInvite) return limitedByInvite;
  await requestStaffInviteCode(token);
  return NextResponse.json({ success: true, data: { sent: true } });
});
