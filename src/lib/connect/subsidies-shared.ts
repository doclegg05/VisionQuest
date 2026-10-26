// =============================================================================
// WV Works / WIOA hiring subsidies — the rule table, Prisma-free.
//
// Match & Connect Phase 4, Task 4.2. Source: docs/plans/
// 2026-09-04-nlx-macc-job-search-research.md Part 2, which names the programs
// and the figures ("EIP reimburses 50% of starting wage for 200-600 hours; ESP
// reimburses up to 100% for six months. Both are triggered only by the
// student's WV Works case manager.").
//
// EVERY FIGURE HERE IS UNVERIFIED. The memo carries the numbers but no source
// links, and plan step P0.8 makes confirming them with the local WV Works
// office an owner action. So each rule and each figure ships with
// `verifiedAt: null`, the `source` URLs point at the programs' own official
// pages rather than at the memo, and `formatSubsidyLine` returns null for
// anything unverified. Nothing in this table can reach an employer's screen
// until a person sets those dates.
//
// This module must never import @/lib/db.
// =============================================================================

/** The five levers, matching `Employer.subsidyFlags` keys in employers-shared. */
export const SUBSIDY_RULE_KEYS = ["eip", "esp", "ojt", "wotc", "bonding"] as const;
export type SubsidyRuleKey = (typeof SUBSIDY_RULE_KEYS)[number];

export interface SubsidyFigure {
  /** Grade-6 wording of one number, e.g. "Half the wage for 200 to 600 hours". */
  label: string;
  /**
   * ISO date the local office confirmed THIS figure, or null. A figure with no
   * date never renders, even if the rule around it has one — half-verified is
   * the dangerous state.
   */
  verifiedAt: string | null;
}

export interface SubsidyRule {
  key: SubsidyRuleKey;
  /** The program's own name, as an employer would hear it from the state. */
  name: string;
  /** One sentence: what it is and, crucially, WHO can start it. */
  summary: string;
  figures: SubsidyFigure[];
  /** The program's official page. Confirm alongside the figures (P0.8). */
  source: string;
  /** ISO date the whole rule was confirmed, or null. */
  verifiedAt: string | null;
}

const unverified = (label: string): SubsidyFigure => ({ label, verifiedAt: null });

export const SUBSIDY_RULES: Record<SubsidyRuleKey, SubsidyRule> = {
  eip: {
    key: "eip",
    name: "WV Works Employment Incentive Program (EIP)",
    summary:
      "The state pays back part of a new worker's wage for a set number of hours. Only the worker's WV Works case manager can start it.",
    figures: [unverified("Half of the starting wage, for 200 to 600 hours")],
    source: "https://dhhr.wv.gov/bcf/Services/familyassistance/Pages/WV-WORKS.aspx",
    verifiedAt: null,
  },
  esp: {
    key: "esp",
    name: "WV Works Subsidized Employment Program (ESP)",
    summary:
      "The state can cover the wage for the first months on the job. It starts with a WV Works referral from the worker's case manager, not from the employer.",
    figures: [unverified("Up to all of the wage, for up to six months")],
    source: "https://dhhr.wv.gov/bcf/Services/familyassistance/Pages/WV-WORKS.aspx",
    verifiedAt: null,
  },
  ojt: {
    key: "ojt",
    name: "WIOA On-the-Job Training (OJT)",
    summary:
      "Pays an employer back for the time it takes to train a new worker. Set up through the local workforce development board (WDB).",
    figures: [unverified("At least half the wage while training, up to $6,000")],
    source: "https://workforcewv.org/",
    verifiedAt: null,
  },
  wotc: {
    key: "wotc",
    name: "Work Opportunity Tax Credit (WOTC)",
    summary:
      "A federal tax credit for hiring people from certain groups. The employer files for it; the paperwork starts on or before the first day of work.",
    figures: [unverified("A tax credit against federal taxes the business owes")],
    source: "https://www.dol.gov/agencies/eta/wotc",
    verifiedAt: null,
  },
  bonding: {
    key: "bonding",
    name: "Federal Bonding Program",
    summary:
      "A free insurance bond that covers an employer for a new hire's first months. Requested through the state workforce office.",
    figures: [unverified("Cover for the employer, at no cost to the business")],
    source: "https://bonds4jobs.com/",
    verifiedAt: null,
  },
};

/** Every rule a person has actually confirmed. Empty until P0.8 is done. */
export function verifiedSubsidyRules(): SubsidyRule[] {
  return SUBSIDY_RULE_KEYS.map((key) => SUBSIDY_RULES[key]).filter(
    (rule) => rule.verifiedAt !== null && rule.figures.every((f) => f.verifiedAt !== null),
  );
}

export function isSubsidyRuleVerified(rule: SubsidyRule): boolean {
  return rule.verifiedAt !== null && rule.figures.every((figure) => figure.verifiedAt !== null);
}

/**
 * One employer-facing sentence, or null.
 *
 * Null is the default and the safe answer: the packet then carries
 * `SUBSIDY_FALLBACK_LINE` ("Ask about hiring incentives."), which names no
 * program and no number. Every rendered line ends by pointing at a person,
 * because none of these programs can be started by the employer alone and a
 * line that reads like a promise from SPOKES would be one.
 */
export function formatSubsidyLine(rule: SubsidyRule): string | null {
  if (!isSubsidyRuleVerified(rule)) return null;
  const figures = rule.figures.map((figure) => figure.label).join(". ");
  return `${rule.name}: ${figures}. ${rule.summary} Check with the local WV Works office for the current rules.`;
}
