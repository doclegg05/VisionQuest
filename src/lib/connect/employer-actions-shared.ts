// =============================================================================
// The employer's answer vocabulary — Prisma-free.
//
// The response page's client component renders this list, so it cannot live
// beside the prismaAdmin writes in ./employer-actions.ts. Same split, same
// reason, as every other -shared module in this directory.
// =============================================================================

/**
 * A closed list, not free text.
 *
 * The reason is written by a stranger on an unauthenticated page and read
 * later by staff — a free-text box there is a place to put anything at all.
 * Only "other" carries a note, bounded at 200 characters and sanitized at the
 * route.
 */
export const NOT_NOW_REASONS = [
  "position_filled",
  "not_hiring_now",
  "needs_more_experience",
  "schedule_mismatch",
  "other",
] as const;

export type NotNowReason = (typeof NOT_NOW_REASONS)[number];

export const NOT_NOW_REASON_LABELS: Record<NotNowReason, string> = {
  position_filled: "The job is filled",
  not_hiring_now: "We are not hiring right now",
  needs_more_experience: "We need someone with more experience",
  schedule_mismatch: "The hours do not match",
  other: "Something else",
};
