import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { sendStaffInvite } from "@/lib/staff-invite-email";
import { listStaffInvites } from "@/lib/staff-invite-list";
import { assertInviterRole, withInviteRefusals } from "@/lib/staff-invite-http";
import { createStaffInviteSchema } from "@/lib/staff-invites";

/**
 * The base for emailed invite links. Never the request's own origin: that
 * comes from the Host header, and the server refuses to boot without
 * APP_BASE_URL anyway (validateRuntimeEnv).
 */
function inviteLinkBase(): string {
  const base = process.env.APP_BASE_URL;
  if (!base) throw new Error("APP_BASE_URL is not set; refusing to build an invite link.");
  return base.replace(/\/$/, "");
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

  const base = inviteLinkBase();

  return withInviteRefusals(async () => {
    const { inviteId, expiresAt, delivery, link } = await sendStaffInvite(
      session,
      body,
      (token) => `${base}/invite/${token}`,
    );
    const emailed = delivery === "sent";
    return NextResponse.json({
      success: true,
      data: { inviteId, expiresAt: expiresAt.toISOString(), emailed, delivery, ...(link ? { link } : {}) },
    });
  });
});
