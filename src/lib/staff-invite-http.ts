import { NextResponse } from "next/server";
import { forbidden, type Session } from "@/lib/api-error";
import { clientIpBucket } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { STAFF_INVITE_MESSAGES, staffInviteStatus } from "@/lib/staff-invite-messages";
import { StaffInviteRefused } from "@/lib/staff-invites";

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

/** The same limits as `register-teacher`: 5 per IP and a route-wide 20, per 15 minutes. */
const PER_IP_LIMIT = 5;
const ROUTE_LIMIT = 20;
const WINDOW_MS = 15 * 60 * 1000;
const TOO_MANY_ATTEMPTS = "Too many attempts. Please try again later.";

/**
 * Rate-limit an unauthenticated invite route before its body is read. The
 * route-wide ceiling bounds code guessing that spreads across addresses; both
 * limiters refuse with the same answer, so neither can be told from the other.
 * Returns the 429 to send, or null to go on.
 */
export async function limitInviteAttempts(req: Request, prefix: string): Promise<Response | null> {
  const perIp = await rateLimit(`${prefix}:${clientIpBucket(req)}`, PER_IP_LIMIT, WINDOW_MS);
  if (perIp.success) {
    const routeWide = await rateLimit(`${prefix}:global`, ROUTE_LIMIT, WINDOW_MS);
    if (routeWide.success) return null;
  }
  return NextResponse.json({ error: TOO_MANY_ATTEMPTS }, { status: 429 });
}
