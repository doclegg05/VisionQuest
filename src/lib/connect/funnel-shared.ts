// =============================================================================
// The Connect funnel — Prisma-free half.
//
// Match & Connect Phase 6, Task 6.1 (docs/superpowers/plans/
// 2026-09-05-match-and-connect.md; funnel + metrics in the design spec §6
// step 6 and §11). Pure aggregation over already-fetched Connection,
// ConnectionEvent and (for the self-directed comparison) Application rows —
// `funnel.ts` is where Prisma is allowed.
//
// This module must never import @/lib/db.
// =============================================================================

import { percentile } from "../../../scripts/lib/percentile.mjs";
import { parsePacket } from "./packet-shared";

/**
 * The funnel's progress order, left to right, exactly as named in the plan.
 * Deliberately NOT the same array as `CONNECTION_STATUSES` in
 * pipeline-shared.ts: that list is transition-table order (and interleaves
 * `not_now` between `interested` and `interview_scheduled`, since it is a
 * legal move from either). This list is "how far did it get", so the three
 * exits are excluded and tracked separately in `exits` below.
 */
export const FUNNEL_STAGE_ORDER = [
  "proposed",
  "student_approved",
  "sent",
  "viewed",
  "interested",
  "interview_scheduled",
  "offered",
  "hired",
  "started",
  "retained_30",
  "retained_60",
  "retained_90",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGE_ORDER)[number];

export const EXIT_STATUSES = ["not_now", "withdrawn", "closed"] as const;
export type ExitStatus = (typeof EXIT_STATUSES)[number];

function isExitStatus(status: string): status is ExitStatus {
  return (EXIT_STATUSES as readonly string[]).includes(status);
}

/** Index of `status` in FUNNEL_STAGE_ORDER, or -1 when it is not a funnel stage. */
export function funnelStageIndex(status: string): number {
  return (FUNNEL_STAGE_ORDER as readonly string[]).indexOf(status);
}

// ---------------------------------------------------------------------------
// Input shapes — structural, so a Prisma row or a test fixture both satisfy
// them without a cast.
// ---------------------------------------------------------------------------

export interface FunnelConnectionRow {
  id: string;
  studentId: string;
  employerId: string;
  employerName: string;
  /** JobLead.classId, denormalized by the caller. Null = program-wide lead. */
  classId: string | null;
  className: string | null;
  /** Connection.status — a ConnectionStatus, but kept as `string` here so a
   * malformed row cannot crash the aggregation; see furthestFunnelIndex. */
  status: string;
  createdAt: string | Date;
  sentAt: string | Date | null;
  employerRespondedAt: string | Date | null;
  hiredAt: string | Date | null;
  /** Connection.packet — parsed here via packet-shared, never re-validated
   * by the caller, so funnel.ts never needs to import packet-shared itself. */
  packet: unknown;
}

export interface FunnelEventRow {
  connectionId: string;
  toStatus: string;
  at: string | Date;
}

/** One row per self-directed `Application` with no `Connection` link. */
export interface SelfDirectedApplicationRow {
  id: string;
  studentId: string;
  createdAt: string | Date;
  status: string;
  verificationStatus: string | null;
}

export interface FunnelOptions {
  /** Inclusive lower bound on Connection.createdAt / Application.createdAt. */
  from?: string | Date;
  /** Inclusive upper bound on Connection.createdAt / Application.createdAt. */
  to?: string | Date;
  selfDirectedApplications?: SelfDirectedApplicationRow[];
}

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface FunnelStageCount {
  status: FunnelStage;
  count: number;
}

export interface FunnelExitCounts {
  not_now: number;
  withdrawn: number;
  closed: number;
}

export interface FunnelMedians {
  sendToResponseDays: number | null;
  sendToHireDays: number | null;
}

export interface FunnelSubsidySplit {
  attached: number;
  notAttached: number;
  hiredWithSubsidy: number;
  hiredWithout: number;
}

export interface FunnelEmployerRow {
  employerId: string;
  employerName: string;
  total: number;
  hired: number;
}

export interface FunnelClassRow {
  classId: string | null;
  className: string;
  total: number;
  hired: number;
}

export interface FunnelComparison {
  /** Self-directed Application rows (no Connection link) in the same period. */
  selfDirectedApplications: number;
  /** ...of those, how many reached status "accepted" AND were instructor-
   * verified — the same bar `qualifiesForPlacement` uses in placement-bridge.ts,
   * inlined here rather than imported (that module is "server-only"). */
  selfDirectedAcceptedVerified: number;
}

export interface FunnelResult {
  stages: FunnelStageCount[];
  exits: FunnelExitCounts;
  medians: FunnelMedians;
  subsidy: FunnelSubsidySplit;
  byEmployer: FunnelEmployerRow[];
  byClass: FunnelClassRow[];
  comparison: FunnelComparison;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Inclusive on both ends: a `from`/`to` day boundary is meant to include it. */
function withinPeriod(
  createdAt: string | Date,
  from: string | Date | undefined,
  to: string | Date | undefined,
): boolean {
  const at = toDate(createdAt);
  if (!at) return false;
  const fromDate = toDate(from);
  const toDateValue = toDate(to);
  if (fromDate && at.getTime() < fromDate.getTime()) return false;
  if (toDateValue && at.getTime() > toDateValue.getTime()) return false;
  return true;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / MS_PER_DAY;
}

/**
 * The furthest FUNNEL_STAGE_ORDER index this connection's event history ever
 * reached. Exit-type toStatus values (not_now/withdrawn/closed) are ignored
 * here on purpose — they have no index in FUNNEL_STAGE_ORDER — so a closed
 * connection that reached "interested" first still resolves to "interested",
 * not to whatever came right before the close.
 *
 * Defaults to 0 ("proposed") when no funnel-stage event is found at all,
 * which should never happen in practice (every connection is created with a
 * "proposed" ConnectionEvent) but keeps this total rather than throwing on a
 * row a test constructs without one.
 */
function furthestFunnelIndex(events: readonly FunnelEventRow[]): number {
  let max = 0;
  for (const event of events) {
    const index = funnelStageIndex(event.toStatus);
    if (index > max) max = index;
  }
  return max;
}

function median(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 50);
}

function sortDesc<T extends { total: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// computeFunnel
// ---------------------------------------------------------------------------

/**
 * The funnel, medians, subsidy split, per-employer/per-class breakdown, and
 * the self-directed comparison line — all from plain rows the caller already
 * fetched. See the module header for why exits and stages are independent
 * dimensions rather than a single partition.
 */
export function computeFunnel(
  connections: readonly FunnelConnectionRow[],
  events: readonly FunnelEventRow[],
  opts: FunnelOptions = {},
): FunnelResult {
  const inPeriod = connections.filter((c) => withinPeriod(c.createdAt, opts.from, opts.to));
  const periodIds = new Set(inPeriod.map((c) => c.id));

  const eventsByConnection = new Map<string, FunnelEventRow[]>();
  for (const event of events) {
    if (!periodIds.has(event.connectionId)) continue;
    const list = eventsByConnection.get(event.connectionId);
    if (list) {
      list.push(event);
    } else {
      eventsByConnection.set(event.connectionId, [event]);
    }
  }

  const stageCounts = new Map<FunnelStage, number>(FUNNEL_STAGE_ORDER.map((stage) => [stage, 0]));
  const exits: FunnelExitCounts = { not_now: 0, withdrawn: 0, closed: 0 };

  const sendToResponseDays: number[] = [];
  const sendToHireDays: number[] = [];

  let subsidyAttached = 0;
  let subsidyNotAttached = 0;
  let hiredWithSubsidy = 0;
  let hiredWithout = 0;

  const employerTotals = new Map<string, FunnelEmployerRow>();
  const classTotals = new Map<string, FunnelClassRow>();

  for (const connection of inPeriod) {
    // --- stages: every connection contributes to exactly one, its furthest
    // funnel-order stage, regardless of whether it later exited. ---
    const stage = FUNNEL_STAGE_ORDER[furthestFunnelIndex(eventsByConnection.get(connection.id) ?? [])];
    stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);

    // --- exits: an independent overlay, keyed off the CURRENT status. ---
    if (isExitStatus(connection.status)) {
      exits[connection.status] += 1;
    }

    // --- medians ---
    const sentAt = toDate(connection.sentAt);
    const respondedAt = toDate(connection.employerRespondedAt);
    const hiredAt = toDate(connection.hiredAt);
    if (sentAt && respondedAt) sendToResponseDays.push(daysBetween(sentAt, respondedAt));
    if (sentAt && hiredAt) sendToHireDays.push(daysBetween(sentAt, hiredAt));

    // --- subsidy split ---
    const packet = parsePacket(connection.packet);
    const hasSubsidy = packet !== null && packet.subsidyLine !== null;
    if (hasSubsidy) subsidyAttached += 1;
    else subsidyNotAttached += 1;
    if (hiredAt) {
      if (hasSubsidy) hiredWithSubsidy += 1;
      else hiredWithout += 1;
    }

    // --- byEmployer ---
    const employerRow =
      employerTotals.get(connection.employerId) ??
      ({ employerId: connection.employerId, employerName: connection.employerName, total: 0, hired: 0 } satisfies FunnelEmployerRow);
    employerRow.total += 1;
    if (hiredAt) employerRow.hired += 1;
    employerTotals.set(connection.employerId, employerRow);

    // --- byClass (null classId = program-wide lead) ---
    const classKey = connection.classId ?? "";
    const classRow =
      classTotals.get(classKey) ??
      ({
        classId: connection.classId,
        className: connection.className ?? "No class (program-wide)",
        total: 0,
        hired: 0,
      } satisfies FunnelClassRow);
    classRow.total += 1;
    if (hiredAt) classRow.hired += 1;
    classTotals.set(classKey, classRow);
  }

  // --- comparison: self-directed applications, same period ---
  const selfDirected = (opts.selfDirectedApplications ?? []).filter((app) =>
    withinPeriod(app.createdAt, opts.from, opts.to),
  );
  const selfDirectedAcceptedVerified = selfDirected.filter(
    (app) => app.status === "accepted" && app.verificationStatus === "verified",
  ).length;

  return {
    stages: FUNNEL_STAGE_ORDER.map((status) => ({ status, count: stageCounts.get(status) ?? 0 })),
    exits,
    medians: {
      sendToResponseDays: median(sendToResponseDays),
      sendToHireDays: median(sendToHireDays),
    },
    subsidy: {
      attached: subsidyAttached,
      notAttached: subsidyNotAttached,
      hiredWithSubsidy,
      hiredWithout,
    },
    byEmployer: sortDesc([...employerTotals.values()]),
    byClass: sortDesc([...classTotals.values()]),
    comparison: {
      selfDirectedApplications: selfDirected.length,
      selfDirectedAcceptedVerified,
    },
  };
}
