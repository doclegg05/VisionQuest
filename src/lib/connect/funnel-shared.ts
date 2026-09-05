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

import { percentile } from "@/lib/percentile";
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
  /**
   * EXCLUSIVE upper bound on Connection.createdAt / Application.createdAt.
   * Callers (funnel.ts) resolve a "YYYY-MM-DD" report `to` param into the ET
   * start of the FOLLOWING calendar day via `reportDateRangeBoundsUtc`
   * (src/lib/timezone.ts) before calling computeFunnel — passing the raw
   * date-only string here would parse as UTC midnight and silently drop the
   * evening of the intended last day for this Eastern Time cohort.
   */
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
  /** `Connection.packet` was non-null but failed `packetSchema` validation —
   * a genuinely corrupt/unparseable row, distinct from a connection that
   * legitimately has no packet yet (still `proposed`, pre-approval). This is
   * an EXCLUSIVE third bucket, not also present in `notAttached` (2026-09
   * second-pass review): a data problem must read as a data problem on the
   * report page, not inflate the "no incentive offered" count. */
  packetUnparseable: number;
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

/**
 * `from` is inclusive; `to` is EXCLUSIVE (see FunnelOptions.to) — the ONLY
 * asymmetry here is deliberate, not an oversight.
 */
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
  if (toDateValue && at.getTime() >= toDateValue.getTime()) return false;
  return true;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / MS_PER_DAY;
}

/**
 * Public reuse point: the furthest FUNNEL_STAGE_ORDER index among a list of
 * ConnectionEvent.toStatus values. Exit-type values (not_now/withdrawn/
 * closed) are ignored here on purpose — they have no index in
 * FUNNEL_STAGE_ORDER — so a closed connection that reached "interested"
 * first still resolves to "interested", not to whatever came right before
 * the close.
 *
 * dohs-export-shared.ts reuses this for its retained_30/60/90 FALLBACK (a
 * "retained_60" event ever recorded, not the connection's current status) —
 * see that module's header for why current status alone is the wrong signal.
 *
 * Defaults to 0 ("proposed") when no funnel-stage status is found at all,
 * which should never happen in practice (every connection is created with a
 * "proposed" ConnectionEvent) but keeps this total rather than throwing on a
 * row a test constructs without one.
 */
export function furthestFunnelStageIndex(toStatuses: readonly string[]): number {
  let max = 0;
  for (const status of toStatuses) {
    const index = funnelStageIndex(status);
    if (index > max) max = index;
  }
  return max;
}

function furthestFunnelIndex(events: readonly FunnelEventRow[]): number {
  return furthestFunnelStageIndex(events.map((event) => event.toStatus));
}

/**
 * The stage a connection actually reached, discounting a send that was rolled
 * back.
 *
 * `sendConnection` CLAIMS the transition to "sent" before it emails, so the
 * token that exists in the world is always one the database knows about. When
 * the email then fails, `rollBackFailedSend` puts the row back to
 * "student_approved" and nulls `sentAt` — but the "sent" ConnectionEvent stays,
 * because the event log is append-only and that claim genuinely happened.
 *
 * Reading the event history alone therefore counts a packet that never left
 * the building as "sent". On a report whose whole job is "how far did each
 * introduction get", that is the one number nobody would question and nobody
 * could reproduce: a misconfigured mail server would show a healthy send rate
 * and a mysterious zero response rate.
 *
 * `sentAt` is the discriminator because `rollBackFailedSend` is the only thing
 * that ever nulls it, and `sendConnection` always writes it alongside the
 * claim. So "an event at or past `sent`, with no `sentAt`" means exactly one
 * thing. A later successful re-send writes a new `sentAt`, and the connection
 * counts from then on — which is why this checks the column rather than
 * subtracting the rollback event.
 */
export function funnelStageIndexForConnection(
  events: readonly FunnelEventRow[],
  sentAt: Date | string | null | undefined,
): number {
  const reached = furthestFunnelIndex(events);
  const sentIndex = funnelStageIndex("sent");
  if (reached < sentIndex || sentAt) return reached;

  // The claim was undone. Fall back to the furthest stage strictly BELOW
  // "sent" that the events support — in practice "student_approved", which is
  // where the row was put back.
  return furthestFunnelStageIndex(
    events
      .map((event) => event.toStatus)
      .filter((status) => {
        const index = funnelStageIndex(status);
        return index >= 0 && index < sentIndex;
      }),
  );
}

/**
 * The employer's first substantive answer, in the order the employer page
 * shows the buttons: a view isn't an answer, so it is deliberately absent —
 * "viewed" only tells us the packet was opened, not that anyone responded.
 */
const RESPONSE_EVENT_STATUSES: readonly string[] = [
  "interested",
  "not_now",
  "interview_scheduled",
  "offered",
  "hired",
];

/**
 * The EARLIEST event whose toStatus is a response (see
 * RESPONSE_EVENT_STATUSES), or null when the connection has none yet.
 *
 * `Connection.employerRespondedAt` is the LAST-WRITTEN response instant on
 * the row (it is overwritten by the row's final `employerResponse`, e.g.
 * "hired"), which is wrong for "how long did the first answer take": a
 * connection sent day 0, marked interested day 2, then hired day 20 has a
 * two-day response time and an eighteen-day hire time — reading
 * `employerRespondedAt` (== the hire instant) would report a 20-day
 * response, silently merging the two measurements.
 */
function earliestResponseEventAt(events: readonly FunnelEventRow[]): Date | null {
  let earliest: Date | null = null;
  for (const event of events) {
    if (!RESPONSE_EVENT_STATUSES.includes(event.toStatus)) continue;
    const at = toDate(event.at);
    if (!at) continue;
    if (!earliest || at.getTime() < earliest.getTime()) earliest = at;
  }
  return earliest;
}

/**
 * Below this sample size a "middle value" could single out one student's
 * timeline in a small class — suppress rather than report it. Exported so
 * the threshold is documented and testable rather than a magic number.
 */
export const MIN_MEDIAN_SAMPLE_SIZE = 5;

function median(values: number[]): number | null {
  if (values.length < MIN_MEDIAN_SAMPLE_SIZE) return null;
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
  let packetUnparseable = 0;

  const employerTotals = new Map<string, FunnelEmployerRow>();
  const classTotals = new Map<string, FunnelClassRow>();

  for (const connection of inPeriod) {
    const connectionEvents = eventsByConnection.get(connection.id) ?? [];

    // --- stages: every connection contributes to exactly one, its furthest
    // funnel-order stage, regardless of whether it later exited — except a
    // send that was claimed and then rolled back, which never reached the
    // employer and must not be counted as if it had. ---
    const stage =
      FUNNEL_STAGE_ORDER[funnelStageIndexForConnection(connectionEvents, connection.sentAt)];
    stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);

    // --- exits: an independent overlay, keyed off the CURRENT status. ---
    if (isExitStatus(connection.status)) {
      exits[connection.status] += 1;
    }

    // --- medians ---
    const sentAt = toDate(connection.sentAt);
    const respondedAt = earliestResponseEventAt(connectionEvents);
    const hiredAt = toDate(connection.hiredAt);
    if (sentAt && respondedAt) sendToResponseDays.push(daysBetween(sentAt, respondedAt));
    if (sentAt && hiredAt) sendToHireDays.push(daysBetween(sentAt, hiredAt));

    // --- subsidy split ---
    const hasRawPacket = connection.packet !== null && connection.packet !== undefined;
    const packet = parsePacket(connection.packet);
    const isPacketUnparseable = hasRawPacket && packet === null;
    if (isPacketUnparseable) packetUnparseable += 1;
    const hasSubsidy = packet !== null && packet.subsidyLine !== null;
    if (hasSubsidy) subsidyAttached += 1;
    // A schema-invalid packet is its OWN bucket (packetUnparseable), not
    // folded into notAttached too (2026-09 second-pass review, "Take"): a
    // data problem must read as a data problem, distinguishable from "no
    // incentive was offered" on the report page rather than inflating that
    // count.
    else if (!isPacketUnparseable) subsidyNotAttached += 1;
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
      packetUnparseable,
    },
    byEmployer: sortDesc([...employerTotals.values()]),
    byClass: sortDesc([...classTotals.values()]),
    comparison: {
      selfDirectedApplications: selfDirected.length,
      selfDirectedAcceptedVerified,
    },
  };
}
