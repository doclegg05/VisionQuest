import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { isEmailDeliveryConfigured, sendEmail } from "@/lib/email";
import { buildStaffInviteEmail } from "@/lib/email-templates";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { parseBody } from "@/lib/schemas";
import { listStaffInvites, regionNameFor } from "@/lib/staff-invite-list";
import { assertInviterRole, withInviteRefusals } from "@/lib/staff-invite-http";
import { STAFF_ROLE_LABELS } from "@/lib/staff-invite-messages";
import { createStaffInvite, createStaffInviteSchema } from "@/lib/staff-invites";

function inviteLink(req: Request, token: string): string {
  const base = (process.env.APP_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");
  return `${base}/invite/${token}`;
}

export const GET = withAuth(async (session) => {
  assertInviterRole(session);
  const invites = await listStaffInvites(session);
  return NextResponse.json({ success: true, data: { invites } });
});

export const POST = withAuth(async (session, req: Request) => {
  assertInviterRole(session);
  const body = await parseBody(req, createStaffInviteSchema);

  return withInviteRefusals(async () => {
    const { inviteId, token, expiresAt } = await createStaffInvite(session, body);
    const link = inviteLink(req, token);

    let emailed = false;
    if (isEmailDeliveryConfigured()) {
      const message = buildStaffInviteEmail({
        roleLabel: STAFF_ROLE_LABELS[body.role] ?? body.role,
        regionName: await regionNameFor(body.regionId),
        inviterName: session.displayName,
        link,
        expiresOn: expiresAt.toDateString(),
      });
      try {
        await sendEmail({ to: body.email, ...message });
        emailed = true;
      } catch (error) {
        // The error is logged by name only. It never carries the link.
        logger.error("staff_invite_email_failed", { inviteId, error: errorForLog(error) });
      }
    }

    // The link goes back only when no email reached the person, so the
    // inviter can pass it on. It is never logged.
    return NextResponse.json({
      success: true,
      data: { inviteId, expiresAt: expiresAt.toISOString(), emailed, ...(emailed ? {} : { link }) },
    });
  });
});
