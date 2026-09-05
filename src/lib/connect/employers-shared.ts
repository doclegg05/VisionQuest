// =============================================================================
// Employers — Prisma-free half.
//
// Match & Connect Phase 3, Task 3.1 (docs/superpowers/plans/
// 2026-09-05-match-and-connect.md; model shape in the design spec §4).
//
// Name normalization, the Opportunity → JobLead mapping the backfill applies,
// and the subsidy-flag reader. All pure, so the backfill script, the teacher
// routes, and the job developer console's client components can share them
// without any of them pulling in the Prisma client.
//
// This module must never import @/lib/db.
// =============================================================================

import { z } from "zod";

/** active | paused | do_not_contact (design spec §4). */
export const EMPLOYER_STATUSES = ["active", "paused", "do_not_contact"] as const;
export type EmployerStatus = (typeof EMPLOYER_STATUSES)[number];

/** email | phone | sms (design spec §4). */
export const CONTACT_CHANNELS = ["email", "phone", "sms"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/**
 * The WV Works / WIOA levers an employer may qualify for (plan P0.8). Each is
 * "known" or "unknown" and never a bare boolean: "we have not asked" and "no"
 * are different answers, and the console shows them differently. The dollar
 * figures themselves are deliberately NOT here — they need the local WV Works
 * office's sign-off before they appear on any employer-facing page.
 */
export const SUBSIDY_KEYS = ["eip", "esp", "ojt", "wotc", "bonding"] as const;
export type SubsidyKey = (typeof SUBSIDY_KEYS)[number];
export type SubsidyState = "known" | "unknown";
export type SubsidyFlags = Record<SubsidyKey, SubsidyState>;

/** What a lead says when the source row carried no location at all. */
export const LOCATION_NOT_LISTED = "Not listed";

/**
 * The dedupe key for an employer name: case-folded, trimmed, and with every
 * run of whitespace (including the non-breaking spaces that paste in from
 * job-order PDFs) collapsed to one space.
 *
 * Deliberately conservative — it does NOT strip "Inc." or "LLC", because
 * "Mountain Metal" and "Mountain Metal LLC" may genuinely be two entities and
 * an instructor can merge them by hand. Over-merging two employers is the
 * expensive mistake here; a duplicate row is the cheap one.
 */
export function employerNameKey(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/\s+/gu, " ").trim().toLowerCase();
}

export interface EmployerNameCandidate {
  /** The first spelling seen, kept as the display name. */
  name: string;
  nameKey: string;
}

/**
 * Distinct employer names from a pile of free text, in first-seen order.
 * Blanks are dropped rather than becoming a nameless employer row.
 */
export function dedupeEmployerNames(
  values: Array<string | null | undefined>,
): EmployerNameCandidate[] {
  const seen = new Set<string>();
  const out: EmployerNameCandidate[] = [];

  for (const value of values) {
    const nameKey = employerNameKey(value);
    if (!nameKey || seen.has(nameKey)) continue;
    seen.add(nameKey);
    out.push({ name: (value ?? "").replace(/\s+/gu, " ").trim(), nameKey });
  }

  return out;
}

export interface OpportunityLike {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  description?: string | null;
  status?: string | null;
}

export interface OpportunityLeadInput {
  employerName: string;
  employerNameKey: string;
  title: string;
  description: string | null;
  location: string;
  source: "opportunity";
  sourceRef: string;
  status: "open" | "closed";
}

/**
 * One curated `Opportunity` row as a `JobLead`. The Opportunity's own id
 * becomes `sourceRef`, which is what makes the backfill idempotent: a second
 * run finds the existing lead by (source, sourceRef) and writes nothing.
 */
export function opportunityToLeadInput(opportunity: OpportunityLike): OpportunityLeadInput {
  const location = opportunity.location?.trim();
  return {
    employerName: opportunity.company.replace(/\s+/gu, " ").trim(),
    employerNameKey: employerNameKey(opportunity.company),
    title: opportunity.title.trim(),
    description: opportunity.description?.trim() || null,
    location: location || LOCATION_NOT_LISTED,
    source: "opportunity",
    sourceRef: opportunity.id,
    // Opportunity has no "filled"/"paused" vocabulary — anything that is not
    // open is closed. Guessing "filled" would invent an outcome nobody recorded.
    status: opportunity.status === "open" ? "open" : "closed",
  };
}

export interface PlacementLike {
  employerName: string | null;
  unsubsidizedEmploymentAt: Date | null;
}

export interface PlannedEmployer extends EmployerNameCandidate {
  /** True when a SpokesRecord placement names this employer. */
  hiredSpokesGradBefore: boolean;
  /** The latest known hire date, or null when a placement recorded none. */
  lastHiredAt: Date | null;
}

export interface EmployerBackfillPlan {
  employers: PlannedEmployer[];
  leads: OpportunityLeadInput[];
}

/**
 * What Employer and JobLead rows should exist once the backfill has run, given
 * the two free-text sources. Pure, so scripts/backfill-employers.ts is a thin
 * shell around it and the mapping is testable without a database.
 */
export function planEmployerBackfill(
  opportunities: OpportunityLike[],
  placements: PlacementLike[],
): EmployerBackfillPlan {
  const employers = dedupeEmployerNames([
    ...opportunities.map((opportunity) => opportunity.company),
    ...placements.map((placement) => placement.employerName),
  ]);

  const hiredByKey = new Map<string, Date | null>();
  for (const placement of placements) {
    const key = employerNameKey(placement.employerName);
    if (!key) continue;
    const previous = hiredByKey.get(key) ?? null;
    const current = placement.unsubsidizedEmploymentAt;
    // Latest known hire date wins; a placement with no date still marks the
    // employer as having hired before, which is the fact the matcher rewards.
    hiredByKey.set(key, current && (!previous || current > previous) ? current : previous);
  }

  return {
    employers: employers.map((employer) => ({
      ...employer,
      hiredSpokesGradBefore: hiredByKey.has(employer.nameKey),
      lastHiredAt: hiredByKey.get(employer.nameKey) ?? null,
    })),
    leads: opportunities.map(opportunityToLeadInput),
  };
}

/**
 * Read the `subsidyFlags` JSON column. Anything unrecognized reads as
 * "unknown" — a junk value is not an assertion that the employer qualifies.
 */
export function readSubsidyFlags(raw: unknown): SubsidyFlags {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  return Object.fromEntries(
    SUBSIDY_KEYS.map((key) => [key, source[key] === "known" ? "known" : "unknown"]),
  ) as SubsidyFlags;
}

const subsidyState = z.enum(["known", "unknown"]).optional();

/** Written literally rather than generated from SUBSIDY_KEYS so the inferred
 *  type names the five keys; the test pins the two lists against each other. */
export const subsidyFlagsSchema = z
  .object({
    eip: subsidyState,
    esp: subsidyState,
    ojt: subsidyState,
    wotc: subsidyState,
    bonding: subsidyState,
  })
  .strict();

/**
 * A catalog id as words a reason sentence can use: "forklift-operator" reads
 * as "the forklift operator card you earned". Only a fallback — the caller
 * passes real labels when it has them.
 */
export function humanizeCertId(certId: string): string {
  return certId.replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();
}
