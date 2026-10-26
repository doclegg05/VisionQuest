/**
 * StudentAlert severities, most urgent first. Crisis alerts are written as
 * "critical" (src/lib/sage/crisis-detection.ts); other writers use high,
 * medium and low. An unknown value ranks with low.
 */
const SEVERITY_RANK: Readonly<Record<string, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const URGENT_RANK = 3;

export function alertSeverityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 1;
}

/** Critical and high: the alerts a teacher must see first. */
export function isUrgentSeverity(severity: string): boolean {
  return alertSeverityRank(severity) >= URGENT_RANK;
}
