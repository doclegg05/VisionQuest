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
// No name, email, phone, or address column, ever — the identifier is the
// SPOKES id (`Student.studentId`), the same field the existing
// `/api/teacher/reports/spokes` report exports (see that route's `studentId:
// record.student?.studentId` line). This module follows workforce-batch.ts's
// discipline: a fixed, ordered column list plus a denylist test that pins the
// exclusion by field name.
//
// This module must never import @/lib/db.
// =============================================================================

import { escapeCsvValue } from "@/lib/csv";
import { funnelStageIndex } from "./funnel-shared";
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
  /** Connection.status — used only to derive the retained_30/60/90 flags, via
   * FUNNEL_STAGE_ORDER's cumulative order (reaching retained_60 implies
   * retained_30 was already true). */
  status: string;
  /** Connection.packet, parsed here for its subsidyLine. */
  packet: unknown;
  /** JobLead.schedule JSON, read defensively — see hoursPerWeekFromSchedule. */
  jobLeadSchedule: unknown;
}

/** One row of the export's SOURCE data — a SpokesRecord plus what it links
 * to. `funnel.ts`'s job is to assemble exactly this shape from Prisma. */
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
  /** Latest SpokesEmploymentFollowUp.checkedAt for this record, if any. */
  latestFollowUpAt: string | Date | null;
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

function toIsoDate(value: string | Date | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
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

/** Cumulative: reaching retained_60 implies retained_30 already happened. */
function retainedFlags(status: string): { retained30: boolean; retained60: boolean; retained90: boolean } {
  const reached = funnelStageIndex(status);
  const [i30, i60, i90] = RETAINED_STAGES.map((stage) => funnelStageIndex(stage));
  return {
    retained30: reached >= i30,
    retained60: reached >= i60,
    retained90: reached >= i90,
  };
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
  const retained = connection
    ? retainedFlags(connection.status)
    : { retained30: false, retained60: false, retained90: false };

  return {
    spokesId: source.spokesId,
    className: source.className,
    enrollmentDate: toIsoDate(source.enrollmentDate),
    exitDate: toIsoDate(source.exitDate),
    placed,
    employerName: source.employerName,
    startDate: toIsoDate(source.unsubsidizedEmploymentAt),
    hourlyWage: source.hourlyWage,
    hoursPerWeek,
    placementSource,
    subsidyType,
    retained30: retained.retained30,
    retained60: retained.retained60,
    retained90: retained.retained90,
    followUpDate: toIsoDate(source.latestFollowUpAt),
  };
}

export function buildDohsExportRows(sources: readonly DohsSourceRow[]): DohsExportRow[] {
  return sources.map(buildDohsExportRow);
}

function cell(value: string | number | boolean | null): string {
  if (value === null) return "";
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

/** `dohs-spokes-report-2026-09-05.csv` */
export function dohsExportFilename(today: Date): string {
  return `dohs-spokes-report-${today.toISOString().slice(0, 10)}.csv`;
}
