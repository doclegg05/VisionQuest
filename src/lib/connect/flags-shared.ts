// =============================================================================
// Match & Connect feature flags — Prisma-free half.
//
// Phase 4 ships dark. `connect_enabled_classes` gates the Sage tool, the
// student pending endpoint, the console's connection actions and the employer
// response page; a token for a class that is not enabled renders the same
// neutral page an expired one gets.
//
// The scope shape is deliberately identical to the placement bridge's
// (src/lib/placement-bridge.ts): unset/empty = OFF, "all" = every class,
// otherwise a comma-separated list of SpokesClass ids. One vocabulary for
// every pilot flag in this repo means an operator learns it once.
//
// This module must never import @/lib/db.
// =============================================================================

export const CONNECT_CONFIG_KEY = "connect_enabled_classes" as const;
export const CONNECT_SUBSIDY_LINES_CONFIG_KEY = "connect_subsidy_lines_enabled" as const;

/**
 * Phase 5's second gate, in the same shape and read with the same parser.
 *
 * Separate from `connect_enabled_classes` because texting a student is a
 * bigger step than showing them a lead: a class can pilot Match & Connect on
 * screen for weeks before anyone's phone is involved. Both must be on — the
 * nudge runner takes the intersection — so turning Connect off for a class
 * also stops its texts, with no second switch to remember.
 */
export const SMS_NUDGES_CONFIG_KEY = "sms_nudges_enabled_classes" as const;

export type ConnectScope =
  | { mode: "off" }
  | { mode: "all" }
  | { mode: "classes"; classIds: string[] };

/** Unset, empty, or a list that trims away to nothing all mean OFF. */
export function parseConnectScope(raw: string | null | undefined): ConnectScope {
  const value = raw?.trim();
  if (!value) return { mode: "off" };
  if (value.toLowerCase() === "all") return { mode: "all" };
  const classIds = value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return classIds.length > 0 ? { mode: "classes", classIds } : { mode: "off" };
}

export function isConnectEnabledForClasses(
  scope: ConnectScope,
  activeClassIds: readonly string[],
): boolean {
  if (scope.mode === "off") return false;
  if (scope.mode === "all") return true;
  return activeClassIds.some((classId) => scope.classIds.includes(classId));
}

/**
 * The subsidy-line opt-in. A second gate on top of each rule's `verifiedAt`:
 * both must be satisfied, so an operator can pull every benefits sentence off
 * every employer page with one config row without editing the rule table.
 */
export function isSubsidyLinesEnabled(raw: string | null | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return false;
  return value === "true" || value === "on" || value === "1" || value === "yes";
}
