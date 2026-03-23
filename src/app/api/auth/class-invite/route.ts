import { NextResponse } from "next/server";
import { withErrorHandler, badRequest, notFound } from "@/lib/api-error";
import { findValidClassInviteByToken } from "@/lib/classroom";

export const GET = withErrorHandler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token")?.trim() || "";

  if (!token) {
    throw badRequest("Invite token is required.");
  }

  const invite = await findValidClassInviteByToken(token);
  if (!invite) {
    throw notFound("This class invite is missing, expired, or has already been used.");
  }

  return NextResponse.json({
    invite: {
      classId: invite.class.id,
      className: invite.class.name,
      classCode: invite.class.code,
      email: invite.email,
      displayName: invite.displayName || "",
      suggestedStudentId: invite.suggestedStudentId || "",
      expiresAt: invite.expiresAt,
    },
  });
});
