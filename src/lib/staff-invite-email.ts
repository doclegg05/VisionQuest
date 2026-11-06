import { randomInt } from "node:crypto";
import { prismaAdmin } from "@/lib/db";
import type { Session } from "@/lib/api-error";
import { isEmailDeliveryConfigured, sendEmail } from "@/lib/email";
import { buildStaffInviteCodeEmail, buildStaffInviteEmail } from "@/lib/email-templates";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { inviteNeedsRegion } from "@/lib/org-roles";
import { regionNameFor } from "@/lib/staff-invite-list";
import { STAFF_ROLE_LABELS } from "@/lib/staff-invite-messages";
import {
  createStaffInvite,
  hashInviteCode,
  hashToken,
  STAFF_INVITE_CODE_MAX_ATTEMPTS,
  STAFF_INVITE_CODE_TTL_MINUTES,
  type CreateStaffInviteInput,
  type InviteDeliverer,
  type InviteDelivery,
} from "@/lib/staff-invites";

/**
 * The email side of staff invites (Ruling R21): sending the invite link, and
 * sending the 6-digit code an emailed invite needs at accept. Tokens, links
 * and codes are written only into messages, never into logs.
 */

export interface SentStaffInvite {
  inviteId: string;
  expiresAt: Date;
  delivery: InviteDelivery;
  /** The link, only when no email reached the person (admin link-only invite). */
  link: string | null;
}

export async function sendStaffInvite(
  inviter: Session,
  input: CreateStaffInviteInput,
  linkFor: (token: string) => string,
): Promise<SentStaffInvite> {
  const deliver: InviteDeliverer | null = isEmailDeliveryConfigured()
    ? async (token, expiresAt) => {
        const message = buildStaffInviteEmail({
          roleLabel: STAFF_ROLE_LABELS[input.role] ?? input.role,
          regionName: inviteNeedsRegion(input.role) ? await regionNameFor(input.regionId) : null,
          inviterName: inviter.displayName,
          link: linkFor(token),
          expiresOn: expiresAt.toDateString(),
        });
        await sendEmail({ to: input.email.trim(), ...message });
      }
    : null;

  const { inviteId, token, expiresAt, delivery } = await createStaffInvite(inviter, input, deliver);
  return { inviteId, expiresAt, delivery, link: delivery === "sent" ? null : linkFor(token) };
}

const CODE_SPACE = 1_000_000;
const MS_PER_MINUTE = 60_000;

/**
 * Email a fresh accept code for an emailed invite that can still be used.
 * Says nothing either way: an unknown token, a link-only, used or locked
 * invite returns the same as a sent code, so the route can answer identically.
 * A new code replaces the old one but keeps the invite's try count (Ruling
 * R23), so asking again never buys more guesses.
 */
export async function requestStaffInviteCode(token: string): Promise<void> {
  const invite = await prismaAdmin.staffInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, email: true, deliveredByEmail: true },
  });
  if (!invite?.deliveredByEmail || !isEmailDeliveryConfigured()) return;

  const code = randomInt(0, CODE_SPACE).toString().padStart(6, "0");
  const now = new Date();
  const stored = await prismaAdmin.staffInvite.updateMany({
    where: {
      id: invite.id,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
      codeAttempts: { lt: STAFF_INVITE_CODE_MAX_ATTEMPTS },
    },
    data: {
      codeHash: hashInviteCode(invite.id, code),
      codeExpiresAt: new Date(now.getTime() + STAFF_INVITE_CODE_TTL_MINUTES * MS_PER_MINUTE),
    },
  });
  if (stored.count !== 1) return;

  try {
    await sendEmail({ to: invite.email, ...buildStaffInviteCodeEmail({ code, minutes: STAFF_INVITE_CODE_TTL_MINUTES }) });
  } catch (error) {
    logger.error("staff_invite_code_email_failed", { inviteId: invite.id, error: errorForLog(error) });
  }
}
