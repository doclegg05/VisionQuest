import type { StaffInviteError } from "@/lib/staff-invites";

/**
 * One plain message and one HTTP status per staff-invite refusal. Every route
 * and page reads this table, so a new reason fails to compile until it has
 * both. Messages stay near a 6th-grade reading level (`.impeccable.md`).
 */
export const STAFF_INVITE_MESSAGES: Record<StaffInviteError, string> = {
  invalid: "This invite link is not valid. Ask the person who invited you to send a new one.",
  expired: "This invite has expired. Ask the person who invited you to send a new one.",
  revoked: "This invite was canceled. Ask the person who invited you to send a new one.",
  used: "This invite was already used. If that was you, sign in.",
  email_mismatch: "That email does not match the invite. Use the email the invite was sent to.",
  not_allowed: "You cannot invite people to that role.",
  region_not_allowed: "You can invite people only to your own region.",
  region_required: "Choose a region for this person.",
  inviter_no_longer_allowed: "This invite is no longer valid. Ask for a new one.",
};

const STAFF_INVITE_STATUSES: Record<StaffInviteError, number> = {
  invalid: 404,
  expired: 410,
  revoked: 410,
  used: 410,
  email_mismatch: 400,
  not_allowed: 403,
  region_not_allowed: 403,
  region_required: 400,
  inviter_no_longer_allowed: 410,
};

export const STAFF_INVITE_REASONS = Object.keys(STAFF_INVITE_MESSAGES) as StaffInviteError[];

export function staffInviteStatus(reason: StaffInviteError): number {
  return STAFF_INVITE_STATUSES[reason];
}

/** Role names as people see them. */
export const STAFF_ROLE_LABELS: Record<string, string> = {
  program_coordinator: "Program coordinator",
  coordinator: "Regional coordinator",
  teacher: "Instructor",
};
