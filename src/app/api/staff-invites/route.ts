import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { sendStaffInvite } from "@/lib/staff-invite-email";
import { listStaffInvites } from "@/lib/staff-invite-list";
import { assertInviterRole, withInviteRefusals } from "@/lib/staff-invite-http";
import { createStaffInviteSchema } from "@/lib/staff-invites";

function inviteLink(req: Request, token: string): string {
  const base = (process.env.APP_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");
  return `${base}/invite/${token}`;
}

export const GET = withAuth(async (session) => {
  assertInviterRole(session);
  const invites = await listStaffInvites(session);
  return NextResponse.json({ success: true, data: { invites } });
});

/**
 * Create and email an invite. Only an admin gets a link-only invite back when
 * email is not set up or the send failed (Ruling R21); anyone else is refused
 * with `email_required` and nothing is created. The link is never logged.
 */
export const POST = withAuth(async (session, req: Request) => {
  assertInviterRole(session);
  const body = await parseBody(req, createStaffInviteSchema);

  return withInviteRefusals(async () => {
    const { inviteId, expiresAt, delivery, link } = await sendStaffInvite(session, body, (token) =>
      inviteLink(req, token),
    );
    const emailed = delivery === "sent";
    return NextResponse.json({
      success: true,
      data: { inviteId, expiresAt: expiresAt.toISOString(), emailed, delivery, ...(link ? { link } : {}) },
    });
  });
});
