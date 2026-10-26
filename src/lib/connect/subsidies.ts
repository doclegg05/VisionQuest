// =============================================================================
// The employer-facing subsidy line — the config-gated half.
//
// Two independent gates stand between a figure in subsidies-shared.ts and an
// employer's screen:
//   1. SystemConfig `connect_subsidy_lines_enabled` must be true, so an
//      operator can pull every benefits sentence off every page at once; and
//   2. the rule (and every figure on it) must carry a `verifiedAt` date, set
//      by hand once the local WV Works office has confirmed it (plan P0.8).
//
// Either one missing returns null, and the packet then carries
// SUBSIDY_FALLBACK_LINE — "Ask about hiring incentives." — which names no
// program and no number.
// =============================================================================

import { readSubsidyFlags, type SubsidyFlags } from "./employers-shared";
import { subsidyLinesEnabled } from "./flags";
import {
  SUBSIDY_RULES,
  SUBSIDY_RULE_KEYS,
  formatSubsidyLine,
  isSubsidyRuleVerified,
  type SubsidyRuleKey,
} from "./subsidies-shared";

export * from "./subsidies-shared";

export interface SubsidyLineEmployer {
  /** `Employer.subsidyFlags` — {eip, esp, ojt, wotc, bonding} known/unknown. */
  subsidyFlags: unknown;
}

/**
 * The line for one employer, or null.
 *
 * Only levers the employer is FLAGGED for are considered: `subsidyFlags`
 * records "known" when someone has established the employer qualifies, and
 * "unknown" when nobody has asked. Guessing from "unknown" would put a benefit
 * in front of an employer on the strength of an empty field.
 */
export async function subsidyLine(
  employer: SubsidyLineEmployer,
): Promise<string | null> {
  if (!(await subsidyLinesEnabled())) return null;

  const flags: SubsidyFlags = readSubsidyFlags(employer.subsidyFlags);
  const eligible: SubsidyRuleKey[] = SUBSIDY_RULE_KEYS.filter(
    (key) => flags[key] === "known" && isSubsidyRuleVerified(SUBSIDY_RULES[key]),
  );
  if (eligible.length === 0) return null;

  // One line, not a list: the employer page is read on a phone by someone
  // between shifts, and the instructor is the person who explains the rest.
  return formatSubsidyLine(SUBSIDY_RULES[eligible[0]]);
}
