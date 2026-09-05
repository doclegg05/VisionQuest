// =============================================================================
// The DoHS-facing statistical export — Prisma-free half.
//
// Match & Connect Phase 6, Task 6.2 (docs/superpowers/plans/
// 2026-09-05-match-and-connect.md). Owner step P0.4(1) — the EXACT field list
// DoHS wants for the FY27 SPOKES statistical-report review — is still
// unanswered (docs/plans/2026-09-04-nlx-macc-job-search-research.md Part 2,
// "Asks of the state" #1). DOHS_EXPORT_COLUMNS below is this program's BEST
// GUESS from that memo and from what SpokesRecord already tracks for the
// existing grant-KPI report — reconcile it against WVDE's real list the day
// P0.4(1) lands, the same way the subsidy figures in subsidies-shared.ts wait
// on P0.8.
//
// SEC-W3 (2026-09 security review): the identifier column is
// `Student.studentId` — the SPOKES id, matching the existing
// `/api/teacher/reports/spokes` report's `studentId: record.student?.
// studentId` line (never name/email/phone/address). This is ALSO the
// student's LOGIN USERNAME (`login/route.ts` looks a student up by it), which
// this export was not designed around: a row here doubles as a working
// credential identifier, not just an opaque report key. Two options once
// P0.4(1) settles the real field list: (a) accept it — the export is
// instructor-scoped and audited, the same exposure `spokes` already has, and
// changing it now would break DoHS's ability to match this program's own
// prior-period reports; or (b) mint a separate, non-authenticating report id
// once DoHS confirms what identifier THEY actually need (a program-internal
// id has never been asked for, and inventing one unprompted risks not
// matching their side at all). Left as a flagged, deliberate non-fix — the
// owner decides once P0.4(1) answers.
//
// This module follows workforce-batch.ts's discipline: a fixed, ordered
// column list plus a denylist test that pins the exclusion by field name.
//
// This module must never import @/lib/db.
// =============================================================================

import { escapeCsvValue } from "@/lib/csv";
import { COHORT_TIME_ZONE } from "@/lib/timezone";
import { funnelStageIndex, furthestFunnelStageIndex } from "./funnel-shared";
import { parsePacket } from "./packet-shared";

export const DOHS_EXPORT_COLUMNS = [
  "Student SPOKES ID",
  "Class",
  "Enrollment date",
  "Exit date",
  "Placed",
  "Employer name",
  "Start date",
  "Hourly wage",
  "Hours per week",
  "Placement source",
  "Subsidy type",
  "Retained 30 days",
  "Retained 60 days",
  "Retained 90 days",
  "Follow-up date",
] as const;

export type DohsExportColumn = (typeof DOHS_EXPORT_COLUMNS)[number];

/** "connect" when a Connection produced the hire; "self_directed" when a
 * verified Application with no Connection did; null when staff entered the
 * employment manually with no application link at all. */
export type DohsPlacementSource = "connect" | "self_directed" | null;

export interface DohsConnectionDetail {
  /** Connection.packet, parsed here for its subsidyLine. */
  packet: unknown;
  /** JobLead.schedule JSON, read defensively — see hoursPerWeekFromSchedule. */
  jobLeadSchedule: unknown;
  /**
   * Every ConnectionEvent.toStatus EVER recorded for this connection — used
   * ONLY as the retention FALLBACK when the record has no
   * SpokesEmploymentFollowUp at all (see retainedFlags below). Deliberately
   * the full event history, not the connection's current status: a
   * connect-sourced hire that reached "retained_60" and was later `closed`
   * must still export retained30/60 = true, and current status alone
   * ("closed" — not a funnel stage) cannot show that.
   */
  eventToStatuses: readonly string[];
}

/** One SpokesEmploymentFollowUp row. */
export interface DohsEmploymentFollowUpRow {
  checkpointMonths: number;
  status: string;
  checkedAt: string | Date;
}

/** One row of the export's SOURCE data — a SpokesRecord plus what it links
 * to. `dohs-export.ts`'s job is to assemble exactly this shape from Prisma. */
export interface DohsSourceRow {
  spokesId: string | null;
  className: string | null;
  enrollmentDate: string | Date | null;
  exitDate: string | Date | null;
  /** SpokesRecord.unsubsidizedEmploymentAt doubles as both "placed?" and the
   * employment start date — there is no separate startDate column today. */
  unsubsidizedEmploymentAt: string | Date | null;
  employerName: string | null;
  hourlyWage: number | null;
  /** Present only when this placement traces to an Application; null = a
   * manual staff entry with no traceable source. */
  placementApplication: {
    verificationStatus: string | null;
    connection: DohsConnectionDetail | null;
  } | null;
  /** ALL follow-ups for this record (not just the latest) — retention needs
   * every "employed" checkpoint's date; the export's own follow-up DATE
   * column is derived from this same list (the latest checkedAt overall). */
  employmentFollowUps: readonly DohsEmploymentFollowUpRow[];
}

export interface DohsExportRow {
  spokesId: string | null;
  className: string | null;
  enrollmentDate: string | null;
  exitDate: string | null;
  placed: boolean;
  employerName: string | null;
  startDate: string | null;
  hourlyWage: number | null;
  hoursPerWeek: number | null;
  placementSource: DohsPlacementSource;
  subsidyType: string | null;
  retained30: boolean;
  retained60: boolean;
  retained90: boolean;
  followUpDate: string | null;
}

function parseDate(value: string | Date | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "YYYY-MM-DD" read from an instant's Eastern Time wall-clock date (W5,
 * 2026-09 review's ORIGINAL ask, and the RIGHT thing for a genuine instant
 * like "the moment this report was generated"): a 9:30pm ET run is
 * `2026-07-01T01:30:00Z` — `.toISOString().slice(0, 10)` reads that as
 * "2026-07-01", a day late for the ET operator who ran it. `en-CA` formats
 * as `yyyy-mm-dd` directly.
 *
 * Used ONLY for `dohsExportFilename`'s `today` argument. Every ROW date
 * column below (`toDateOnlyUtc`) deliberately does NOT use this — see that
 * function's comment for why applying it there would be a new, worse bug.
 */
function toEtDateOnly(value: string | Date | null, timeZone: string = COHORT_TIME_ZONE): string | null {
  const date = parseDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * "YYYY-MM-DD" read from an instant's UTC calendar date — the correct
 * reading for every SOURCE field this export shows as a row date
 * (`enrollmentDate`, `exitDate`, `startDate`/`unsubsidizedEmploymentAt`,
 * `followUpDate`/`checkedAt`). All four are Prisma `@db.Date` columns —
 * plain calendar dates with NO time-of-day, which Postgres/Prisma always
 * returns as an instant at exactly UTC midnight for that date. They are not
 * "a moment near midnight that could fall on either side of a timezone
 * boundary" — they ARE the date, already, with no timezone attached.
 *
 * A W5 review pass first "fixed" this by running these fields through
 * `toEtDateOnly` (the function above). That is a REAL bug, not the one being
 * fixed: Eastern Time is always behind UTC, so EVERY `@db.Date` value —
 * with no exception, no DST edge case, every single row — reads one
 * calendar day EARLIER once shifted through `America/New_York` (a bare
 * "2026-09-01" `checkedAt` is UTC midnight, which is 8pm ET on 2026-08-31).
 * The pre-review `.toISOString().slice(0, 10)` UTC-extraction was already
 * correct for these columns; this function keeps that behavior under a name
 * that says why, so nobody "fixes" it into the ET bug a second time.
 */
function toDateOnlyUtc(value: string | Date | null): string | null {
  const date = parseDate(value);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * The program's own name, dropping the figures and the "check with the local
 * office" caveat that belong on an employer-facing packet, not a state form.
 * `formatSubsidyLine` (subsidies-shared.ts) always renders "Name: figures.
 * summary." — the name is everything before the first colon.
 */
function subsidyProgramName(subsidyLine: string | null): string | null {
  if (!subsidyLine) return null;
  const colon = subsidyLine.indexOf(":");
  return colon === -1 ? subsidyLine : subsidyLine.slice(0, colon).trim();
}

/** Defensive read of `JobLead.schedule` — {hoursPerWeekMin?, hoursPerWeekMax?}. */
function hoursPerWeekFromSchedule(schedule: unknown): number | null {
  if (typeof schedule !== "object" || schedule === null) return null;
  const record = schedule as Record<string, unknown>;
  const max = record.hoursPerWeekMax;
  const min = record.hoursPerWeekMin;
  if (typeof max === "number") return max;
  if (typeof min === "number") return min;
  return null;
}

const RETAINED_STAGES = ["retained_30", "retained_60", "retained_90"] as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * retained_30/60/90 — DERIVED, never read off a literal 30/60/90-day
 * check-in that does not exist as its own column (C1, 2026-09 review).
 *
 * PRIMARY SOURCE: `SpokesEmploymentFollowUp`, the SAME table grant-kpi.ts's
 * `threeMonthRetention`/`sixMonthRetention` read (src/lib/grant-kpi.ts:
 * checkpointMonths 3|6, status "employed"). Its `checkpointMonths` values
 * are NOT fixed to 3 and 6: `src/lib/nudges/replies.ts`'s
 * `handleRetentionAnswer` writes 1/2/3 (the 30/60/90-DAY SMS check-in,
 * mapped day/30 -> months) for BOTH "employed" and "not_employed" answers,
 * and the teacher-entry route (`teacher/students/[id]/spokes/follow-up`)
 * accepts any positive integer a staff member types in. So this function
 * never assumes a specific checkpoint cadence — it looks at every
 * follow-up's actual `checkedAt` date relative to the employment start date
 * (`unsubsidizedEmploymentAt`): retainedN = true iff SOME "employed"
 * follow-up's `checkedAt` falls at least N days after that start date.
 *
 * A follow-up row of ANY status is authoritative once it exists — it is a
 * real check-in, not an absence of data:
 *   - An "employed" row proves retention through however many days out it
 *     falls (e.g. a 92-day "employed" answer trips retained30/60/90 at
 *     once; a 45-day one trips only retained30).
 *   - A "not_employed" (or any other non-"employed") row, with NO
 *     corroborating "employed" row, means all three read false — a real
 *     negative observation must not be overridden by (possibly stale)
 *     Connection event history (W1, 2026-09 review): a connect-sourced hire
 *     whose event history shows "retained_90" but whose SPOKES follow-up
 *     says "not_employed" at the 3-month check-in is NOT retained; the
 *     follow-up is the human-confirmed answer, the event history is a
 *     system guess about what should have happened.
 *
 * FALLBACK, used ONLY when the record has ZERO follow-up rows of ANY status
 * at all — genuinely no check-in has happened yet: the linked Connection's
 * own EVENT HISTORY. A "retained_60" event ever recorded (via
 * `furthestFunnelStageIndex` over every `toStatus`, never the connection's
 * CURRENT `status`) implies retained_30 and retained_60. This is what makes
 * a connect-sourced hire that was later marked `closed` still export
 * correctly when no follow-up exists yet: its current status is "closed"
 * (no funnel-stage index at all), but the event history still shows it
 * reached retained_60 first — reading current status alone (the pre-fix
 * behavior) reported "not retained" for exactly the connections whose
 * retention actually happened.
 *
 * Self-directed placements have no Connection at all, so they fall through
 * to `false/false/false` only when they ALSO have zero follow-ups — the bug
 * this replaces reported `false` unconditionally for every self-directed
 * placement regardless of follow-up data.
 */
function retainedFlags(
  source: Pick<DohsSourceRow, "unsubsidizedEmploymentAt" | "employmentFollowUps">,
  connection: DohsConnectionDetail | null,
): { retained30: boolean; retained60: boolean; retained90: boolean } {
  const followUps = source.employmentFollowUps;

  if (followUps.length > 0) {
    // A follow-up of ANY status exists — this IS the primary source and it
    // never falls through to the event-history fallback below, even when
    // no "employed" row can be used (W1): an unusable or negative
    // observation is still an observation, not an absence of data.
    const start = parseDate(source.unsubsidizedEmploymentAt);
    const employedFollowUps = followUps.filter((f) => f.status === "employed");

    if (start && employedFollowUps.length > 0) {
      let maxDaysEmployed: number | null = null;
      for (const followUp of employedFollowUps) {
        const checkedAt = parseDate(followUp.checkedAt);
        if (!checkedAt) continue;
        const days = (checkedAt.getTime() - start.getTime()) / MS_PER_DAY;
        if (maxDaysEmployed === null || days > maxDaysEmployed) maxDaysEmployed = days;
      }
      if (maxDaysEmployed !== null) {
        return {
          retained30: maxDaysEmployed >= 30,
          retained60: maxDaysEmployed >= 60,
          retained90: maxDaysEmployed >= 90,
        };
      }
    }

    return { retained30: false, retained60: false, retained90: false };
  }

  if (connection) {
    const reached = furthestFunnelStageIndex(connection.eventToStatuses);
    const [i30, i60, i90] = RETAINED_STAGES.map((stage) => funnelStageIndex(stage));
    return { retained30: reached >= i30, retained60: reached >= i60, retained90: reached >= i90 };
  }

  return { retained30: false, retained60: false, retained90: false };
}

/** Latest `checkedAt` across ALL follow-ups (any status), for the
 * "Follow-up date" column. */
function latestFollowUpDate(followUps: readonly DohsEmploymentFollowUpRow[]): string | Date | null {
  let latest: DohsEmploymentFollowUpRow | null = null;
  for (const followUp of followUps) {
    const checkedAt = parseDate(followUp.checkedAt);
    if (!checkedAt) continue;
    if (!latest || checkedAt.getTime() > (parseDate(latest.checkedAt)?.getTime() ?? -Infinity)) {
      latest = followUp;
    }
  }
  return latest?.checkedAt ?? null;
}

/**
 * One `SpokesRecord`-shaped input row -> one export row. Pure, so the "grant
 * KPI and DoHS export agree on placements" acceptance line can be checked
 * without a database: both read `unsubsidizedEmploymentAt !== null` as the
 * placement signal.
 */
export function buildDohsExportRow(source: DohsSourceRow): DohsExportRow {
  const placed = source.unsubsidizedEmploymentAt !== null;
  const connection = source.placementApplication?.connection ?? null;

  let placementSource: DohsPlacementSource = null;
  if (source.placementApplication) {
    placementSource = connection ? "connect" : "self_directed";
  }

  const packet = connection ? parsePacket(connection.packet) : null;
  const subsidyType = connection ? subsidyProgramName(packet?.subsidyLine ?? null) : null;
  const hoursPerWeek = connection ? hoursPerWeekFromSchedule(connection.jobLeadSchedule) : null;
  const retained = retainedFlags(source, connection);

  return {
    spokesId: source.spokesId,
    className: source.className,
    enrollmentDate: toDateOnlyUtc(source.enrollmentDate),
    exitDate: toDateOnlyUtc(source.exitDate),
    placed,
    employerName: source.employerName,
    startDate: toDateOnlyUtc(source.unsubsidizedEmploymentAt),
    hourlyWage: source.hourlyWage,
    hoursPerWeek,
    placementSource,
    subsidyType,
    retained30: retained.retained30,
    retained60: retained.retained60,
    retained90: retained.retained90,
    followUpDate: toDateOnlyUtc(latestFollowUpDate(source.employmentFollowUps)),
  };
}

export function buildDohsExportRows(sources: readonly DohsSourceRow[]): DohsExportRow[] {
  return sources.map(buildDohsExportRow);
}

function cell(value: string | number | boolean | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return escapeCsvValue(value);
}

/** Every cell through `escapeCsvValue` — the repo's only escaper, formula
 * injection neutralized. Row order matches DOHS_EXPORT_COLUMNS exactly. */
export function buildDohsExportCsv(rows: readonly DohsExportRow[]): string {
  const lines = [DOHS_EXPORT_COLUMNS.map((column) => escapeCsvValue(column)).join(",")];

  for (const row of rows) {
    lines.push(
      [
        cell(row.spokesId),
        cell(row.className),
        cell(row.enrollmentDate),
        cell(row.exitDate),
        cell(row.placed),
        cell(row.employerName),
        cell(row.startDate),
        cell(row.hourlyWage),
        cell(row.hoursPerWeek),
        cell(row.placementSource),
        cell(row.subsidyType),
        cell(row.retained30),
        cell(row.retained60),
        cell(row.retained90),
        cell(row.followUpDate),
      ].join(","),
    );
  }

  return `${lines.join("\r\n")}\r\n`;
}

/** `dohs-spokes-report-2026-09-05.csv`, dated in Eastern Time (W5) so a
 * report run just after 8pm ET is still named for the ET calendar day an
 * operator ran it on, not the UTC day it silently rolled into. */
export function dohsExportFilename(today: Date, timeZone: string = COHORT_TIME_ZONE): string {
  return `dohs-spokes-report-${toEtDateOnly(today, timeZone)}.csv`;
}
