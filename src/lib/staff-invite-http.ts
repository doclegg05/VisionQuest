import { NextResponse } from "next/server";
import { forbidden, type Session } from "@/lib/api-error";
import { clientIpBucket } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { STAFF_INVITE_MESSAGES, staffInviteStatus } from "@/lib/staff-invite-messages";
import { hashToken, StaffInviteRefused } from "@/lib/staff-invites";

/** Roles that may send or revoke invites. The per-role rule lives in `canInviteRole`. */
const INVITER_ROLES: readonly string[] = ["admin", "program_coordinator", "coordinator"];

export function assertInviterRole(session: Session): void {
  if (!INVITER_ROLES.includes(session.role)) throw forbidden();
}

/** Run `work`; turn a refusal into its plain message and status. */
export async function withInviteRefusals(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof StaffInviteRefused) {
      return NextResponse.json(
        { error: STAFF_INVITE_MESSAGES[err.reason] },
        { status: staffInviteStatus(err.reason) },
      );
    }
    throw err;
  }
}

/** 5 per IP and 20 per invite, per 15 minutes. */
const PER_IP_LIMIT = 5;
const PER_INVITE_LIMIT = 20;
const WINDOW_MS = 15 * 60 * 1000;
const TOO_MANY_ATTEMPTS = "Too many attempts. Please try again later.";

function tooManyAttempts(): Response {
  return NextResponse.json({ error: TOO_MANY_ATTEMPTS }, { status: 429 });
}

/**
 * Rate-limit an unauthenticated invite route by client IP, before its body is
 * read. Returns the 429 to send, or null to go on.
 */
export async function limitInviteAttemptsByIp(req: Request, prefix: string): Promise<Response | null> {
  const perIp = await rateLimit(`${prefix}:${clientIpBucket(req)}`, PER_IP_LIMIT, WINDOW_MS);
  return perIp.success ? null : tooManyAttempts();
}

/**
 * Rate-limit by invite, keyed on the token's hash. There is no shared
 * route-wide bucket: the client IP can be spoofed, so a shared ceiling let one
 * client lock out every invitee with junk tokens. A junk token spends only its
 * own bucket. Code guessing is already capped at 5 tries per invite inside
 * `acceptStaffInvite`. Same answer as the IP limiter, so neither can be told
 * from the other.
 */
export async function limitInviteAttemptsByToken(prefix: string, token: string): Promise<Response | null> {
  const perInvite = await rateLimit(`${prefix}:invite:${hashToken(token)}`, PER_INVITE_LIMIT, WINDOW_MS);
  return perInvite.success ? null : tooManyAttempts();
}
