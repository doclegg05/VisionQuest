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

/**
 * The class ids a student must be enrolled in to satisfy BOTH scopes, or
 * `null` when neither scope names classes (so no filter is needed).
 *
 * This exists because a `take` on the roster query is applied by Postgres
 * BEFORE the in-memory flag check that decides who is in scope. With
 * `sms_nudges_enabled_classes = "all"` and one pilot class in
 * `connect_enabled_classes`, the first N enrollment rows are just the first N
 * students in the program — quite possibly none of them in the pilot — and the
 * weekly text then goes to nobody, with no error anywhere. Filtering in the
 * query means the rows that come back are already the right ones.
 *
 * An `off` scope yields an empty list rather than null: nothing satisfies it,
 * and `classId: { in: [] }` matches no rows, which is the correct answer.
 */
export function intersectScopeClassIds(...scopes: ConnectScope[]): string[] | null {
  if (scopes.some((scope) => scope.mode === "off")) return [];
  const lists = scopes
    .filter((scope): scope is { mode: "classes"; classIds: string[] } => scope.mode === "classes")
    .map((scope) => scope.classIds);
  if (lists.length === 0) return null; // every scope is "all"
  const [first, ...rest] = lists;
  return first.filter((id) => rest.every((other) => other.includes(id)));
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
