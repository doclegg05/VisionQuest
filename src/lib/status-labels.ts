/**
 * Human-readable labels for stored status values, mirroring
 * `goalStatusLabel()` in src/lib/goals.ts. Statuses are persisted as
 * snake_case strings (e.g. "under_review"); raw values must never reach
 * users — this app serves a low-literacy audience (WCAG AA, plain language).
 */

/**
 * De-underscores a stored status value and capitalizes the first word,
 * e.g. "under_review" -> "Under review".
 */
export function humanizeStatusValue(status: string): string {
  const words = status
    .trim()
    .split(/[_\s]+/)
    .filter((word) => word.length > 0)
    .join(" ")
    .toLowerCase();
  if (words.length === 0) return status;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Label for an `Application.status` value (e.g. "interviewing", "under_review"). */
export function applicationStatusLabel(status: string): string {
  return humanizeStatusValue(status);
}

/** Label for an `EventRegistration.status` value (e.g. "registered"). */
export function eventRegistrationStatusLabel(status: string): string {
  return humanizeStatusValue(status);
}
