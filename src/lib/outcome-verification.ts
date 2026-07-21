// ---------------------------------------------------------------------------
// Outcome verification (P1-4)
//
// Grant reports must distinguish instructor-verified outcomes from student
// self-reported claims. Certification and Application rows carry a
// `verificationStatus` column:
//   - null            → legacy row created before this feature; provenance is
//                       unknown, so it counts in totals but in NEITHER the
//                       verified nor the self-reported bucket.
//   - "self_reported" → recorded from a student claim (Sage tool / student
//                       route) with no instructor confirmation yet.
//   - "verified"      → an instructor confirmed the outcome (verifiedBy /
//                       verifiedAt are set).
// ---------------------------------------------------------------------------

export const OUTCOME_VERIFICATION = {
  SELF_REPORTED: "self_reported",
  VERIFIED: "verified",
} as const;

export type OutcomeVerificationBucket = "verified" | "self_reported" | "legacy";

/** Buckets a row's verificationStatus for report splits. */
export function classifyOutcomeVerification(
  verificationStatus: string | null | undefined,
): OutcomeVerificationBucket {
  if (verificationStatus === OUTCOME_VERIFICATION.VERIFIED) return "verified";
  if (verificationStatus === OUTCOME_VERIFICATION.SELF_REPORTED) return "self_reported";
  return "legacy";
}

export interface OutcomeVerificationSplit {
  verifiedCount: number;
  selfReportedCount: number;
}

/**
 * Sums grouped verification-status counts into the two report buckets.
 * Legacy (null / unknown) rows fall through to neither bucket — callers keep
 * reporting them inside the pre-existing totals for continuity.
 */
export function splitOutcomeVerificationCounts(
  rows: ReadonlyArray<{ verificationStatus: string | null; count: number }>,
): OutcomeVerificationSplit {
  return rows.reduce<OutcomeVerificationSplit>(
    (split, row) => {
      const bucket = classifyOutcomeVerification(row.verificationStatus);
      if (bucket === "verified") {
        return { ...split, verifiedCount: split.verifiedCount + row.count };
      }
      if (bucket === "self_reported") {
        return { ...split, selfReportedCount: split.selfReportedCount + row.count };
      }
      return split;
    },
    { verifiedCount: 0, selfReportedCount: 0 },
  );
}
