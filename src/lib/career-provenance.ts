// =============================================================================
// Career profile provenance — pure, client-safe helpers.
//
// CareerDiscovery.profileSource records where a student's RIASEC profile came
// from (string union by convention, mirrored in prisma/schema.prisma):
//   - "sage_inferred": Sage's read of chat conversations. Not a formal
//     assessment, and every surface must say so.
//   - "student_reported_cos": the student took a real assessment themselves
//     (CareerOneStop Skills Matcher, O*NET Interest Profiler, ...) and
//     reported the results to Sage, which saved them after confirmation.
//   - "cos_api": reserved for the future live CareerOneStop API path once
//     COS_USER_ID/COS_API_TOKEN credentials exist.
//
// This module must stay free of server-only imports (no prisma) — the
// CareerProfile client component renders these labels directly.
// =============================================================================

export const PROFILE_SOURCE_SAGE_INFERRED = "sage_inferred";
export const PROFILE_SOURCE_STUDENT_REPORTED_COS = "student_reported_cos";
export const PROFILE_SOURCE_COS_API = "cos_api";

export type CareerProfileSource =
  | typeof PROFILE_SOURCE_SAGE_INFERRED
  | typeof PROFILE_SOURCE_STUDENT_REPORTED_COS
  | typeof PROFILE_SOURCE_COS_API;

const ASSESSED_PROFILE_SOURCES: ReadonlyArray<string> = [
  PROFILE_SOURCE_STUDENT_REPORTED_COS,
  PROFILE_SOURCE_COS_API,
];

/**
 * True when the profile came from a real assessment (student-reported or
 * API-fetched) rather than Sage's inference. Unknown values read as NOT
 * assessed — the conservative label for data of uncertain origin.
 */
export function isAssessedProfileSource(source: string): boolean {
  return ASSESSED_PROFILE_SOURCES.includes(source);
}

function formatSavedDate(assessedAt: Date | string): string | null {
  const date = assessedAt instanceof Date ? assessedAt : new Date(assessedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Honest one-line label for where the RIASEC profile came from.
 * Copy is written for a grade-8 (or below) reading level.
 */
export function careerProvenanceLabel(
  profileSource: string,
  assessedAt: Date | string | null,
): string {
  if (isAssessedProfileSource(profileSource)) {
    const saved = assessedAt ? formatSavedDate(assessedAt) : null;
    return saved
      ? `From your CareerOneStop results, saved ${saved}.`
      : "From your CareerOneStop results.";
  }
  return "This is Sage's best guess from your chats. It is not a test you took.";
}
