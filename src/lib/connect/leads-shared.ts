// =============================================================================
// Job leads — Prisma-free half.
//
// Match & Connect Phase 3, Tasks 3.1–3.2 (docs/superpowers/plans/
// 2026-09-05-match-and-connect.md; model shape in the design spec §4).
//
// The vocabularies, the Zod schemas for the two JSON columns, tolerant readers
// for stored values, and the pay-period normalization the matcher's pay floor
// depends on. All pure — the "Add lead" form is a client component and needs
// these enums, so nothing here may import @/lib/db.
// =============================================================================

import { z } from "zod";

import { LEAD_SHIFTS } from "./work-profile-shared";
import { hourlyFromAmount } from "@/lib/job-board/salary-parser";

/** open | filled | paused | closed (design spec §4). */
export const JOB_LEAD_STATUSES = ["open", "filled", "paused", "closed"] as const;
export type JobLeadStatus = (typeof JOB_LEAD_STATUSES)[number];

/** manual | opportunity | joblisting | joborder (design spec §4). */
export const JOB_LEAD_SOURCES = ["manual", "opportunity", "joblisting", "joborder"] as const;
export type JobLeadSource = (typeof JOB_LEAD_SOURCES)[number];

/**
 * The pay periods an instructor may type on a lead. Shorter words than the
 * salary parser's own vocabulary because a person picks these from a dropdown;
 * LEAD_PERIOD_TO_PAY_PERIOD is the one place they are translated.
 */
export const LEAD_PAY_PERIODS = ["hour", "day", "week", "month", "year"] as const;
export type LeadPayPeriod = (typeof LEAD_PAY_PERIODS)[number];

const LEAD_PERIOD_TO_PAY_PERIOD: Record<LeadPayPeriod, string> = {
  hour: "hourly",
  day: "daily",
  week: "weekly",
  month: "monthly",
  year: "yearly",
};

/** Plain words for a lead's shift, used in match reasons and on the console. */
export const SHIFT_LABELS: Record<(typeof LEAD_SHIFTS)[number], string> = {
  day: "Day shift",
  evening: "Evening shift",
  night: "Night shift",
  weekend: "Weekend shift",
};

// ---------------------------------------------------------------------------
// requirements / schedule
// ---------------------------------------------------------------------------

const requirementList = z.array(z.string().trim().min(1).max(120)).max(20);

/**
 * `.strict()` so a typo like `mustHaveSkills` is a 400 rather than a silently
 * ignored requirement — a dropped must-have cert would let the matcher show a
 * student a job they cannot legally do.
 */
export const leadRequirementsSchema = z
  .object({
    mustHaveCerts: requirementList.default([]),
    niceToHave: requirementList.default([]),
    physical: requirementList.default([]),
    licenses: requirementList.default([]),
  })
  .strict();

export type LeadRequirements = z.infer<typeof leadRequirementsSchema>;

export const leadScheduleSchema = z
  .object({
    shifts: z.array(z.enum(LEAD_SHIFTS)).max(4).default([]),
    hoursPerWeekMin: z.number().int().min(1).max(80).optional(),
    hoursPerWeekMax: z.number().int().min(1).max(80).optional(),
    /** YYYY-MM-DD; the same plain-date convention the work profile uses. */
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, "startDate must be YYYY-MM-DD")
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.hoursPerWeekMin === undefined ||
      value.hoursPerWeekMax === undefined ||
      value.hoursPerWeekMin <= value.hoursPerWeekMax,
    { message: "hoursPerWeekMin must not be greater than hoursPerWeekMax" },
  );

export type LeadSchedule = z.infer<typeof leadScheduleSchema>;

export const EMPTY_REQUIREMENTS: LeadRequirements = {
  mustHaveCerts: [],
  niceToHave: [],
  physical: [],
  licenses: [],
};

export const EMPTY_SCHEDULE: LeadSchedule = { shifts: [] };

/**
 * Stored JSON is parsed, never trusted. A row written before a shape change
 * degrades to the safe default rather than throwing inside a match run — and
 * the safe default for `shifts` is "none named", which the matcher reads as
 * "nothing was asked" and therefore blocks nobody.
 */
export function parseLeadRequirements(raw: unknown): LeadRequirements {
  const parsed = leadRequirementsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { ...EMPTY_REQUIREMENTS };
}

export function parseLeadSchedule(raw: unknown): LeadSchedule {
  const parsed = leadScheduleSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { ...EMPTY_SCHEDULE };
}

// ---------------------------------------------------------------------------
// Pay
// ---------------------------------------------------------------------------

export interface LeadPay {
  payMin: number | null;
  payMax: number | null;
  payPeriod: string;
}

export interface HourlyRange {
  min: number | null;
  max: number | null;
}

/**
 * The lead's pay in the same unit as `StudentWorkProfile.payFloorHourly`.
 *
 * Conversion goes through the shared salary parser (`hourlyFromAmount`), which
 * also enforces the plausible-rate band — so an obviously mislabeled figure
 * comes back null instead of a wrong number. That matters: pay is a HARD BLOCK
 * axis, and a bogus rate would hide a real job from a student for no reason.
 */
export function leadHourlyRange(lead: LeadPay): HourlyRange {
  const period = LEAD_PERIOD_TO_PAY_PERIOD[lead.payPeriod as LeadPayPeriod] ?? lead.payPeriod;
  return {
    min: hourlyFromAmount(lead.payMin, period),
    max: hourlyFromAmount(lead.payMax, period),
  };
}

/** "$15 an hour" / "$15 to $18 an hour" / null when the lead states no pay. */
export function describeLeadPay(lead: LeadPay): string | null {
  const { min, max } = leadHourlyRange(lead);
  const format = (value: number) =>
    Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;

  if (min !== null && max !== null && max > min) return `${format(min)} to ${format(max)} an hour.`;
  const single = min ?? max;
  return single === null ? null : `${format(single)} an hour.`;
}
