// =============================================================================
// "Batch to WorkForce WV" — this week's ready graduates as one CSV for the
// Business Services Rep (Match & Connect Task 3.4; design spec §8).
//
// The whole point of this file is what it does NOT contain. The BSR needs to
// know who is ready to start work and what they are qualified for. They do not
// need — and under no reading of the program's obligations should receive —
// benefits status, barriers, household type, county of residence, case notes,
// or anything else on the student's SPOKES record. ALLOWED_COLUMNS is the
// whole export, and a test pins it against a denylist of field names so a
// later "just add county" cannot slip in unnoticed.
//
// Readiness reuses `fetchStudentReadinessData` — the one readiness
// computation, per the 2026-04-01 decision. Nothing here recomputes it.
// =============================================================================

import { escapeCsvValue } from "@/lib/csv";

/**
 * Every column the export may ever contain, in order. Adding one is a
 * deliberate act: the test enumerates this list and rejects any field name
 * that looks like benefits, barriers or household data.
 */
export const ALLOWED_COLUMNS = [
  "Name",
  "Class",
  "Readiness score",
  "Ready to work",
  "Verified certifications",
  "Earliest start",
  "Days available",
  "Transport",
] as const;

/** At or above this readiness score, a student is presented as ready to work. */
export const READY_TO_WORK_SCORE = 70;

export interface BatchRow {
  displayName: string;
  className: string;
  readinessScore: number;
  /** YYYY-MM-DD from the work profile, or null when they have not said. */
  earliestStart: string | null;
  /** How many of the 28 availability cells are ticked. */
  availableCells: number;
  transport: string | null;
  verifiedCertifications: string[];
}

function daysAvailable(cells: number): string {
  if (cells === 0) return "Not set";
  return `${cells} of 28 time slots`;
}

/**
 * The CSV text. Every cell goes through `escapeCsvValue`, the repo's only
 * escaper — it neutralizes the `= + - @` formula triggers as well as applying
 * RFC 4180 quoting, which matters because this file is opened in Excel by
 * someone outside the program.
 */
export function buildWorkforceBatchCsv(rows: BatchRow[]): string {
  const lines = [ALLOWED_COLUMNS.map(escapeCsvValue).join(",")];

  for (const row of rows) {
    lines.push(
      [
        row.displayName,
        row.className,
        row.readinessScore,
        row.readinessScore >= READY_TO_WORK_SCORE ? "Yes" : "Not yet",
        row.verifiedCertifications.join("; ") || "None yet",
        row.earliestStart ?? "Not set",
        daysAvailable(row.availableCells),
        row.transport ?? "Not set",
      ]
        .map(escapeCsvValue)
        .join(","),
    );
  }

  return `${lines.join("\r\n")}\r\n`;
}

/** `connect-workforce-wv-2026-09-05.csv` */
export function batchFilename(today: Date): string {
  return `connect-workforce-wv-${today.toISOString().slice(0, 10)}.csv`;
}
