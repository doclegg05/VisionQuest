import { NextResponse } from "next/server";
import { forbidden, type Session } from "@/lib/api-error";
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
