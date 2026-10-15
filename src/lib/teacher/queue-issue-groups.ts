import { alertSeverityRank, isUrgentSeverity } from "@/lib/alert-severity";
import {
  getInactivityStageByType,
  getInactivityStageRank,
  isInactivityAlertType,
  normalizeInactivityAlertType,
} from "@/lib/inactivity";
import {
  teacherDashboardAlertAction,
  teacherDashboardAlertQuickAction,
  teacherDashboardReviewAction,
  teacherDashboardReviewQuickAction,
  type DashboardQuickAction,
  type InterventionAction,
} from "@/lib/intervention-notifications";
import { WELLBEING_ALERT_TYPE } from "@/lib/sage/wellbeing-card";
import type { QueueAlert } from "@/lib/teacher/intervention-queue";

/** Goal-plan items a teacher reviews. They use the review actions ("Quick review", "Quick assign"). */
export const GOAL_REVIEW_ALERT_TYPES: ReadonlySet<string> = new Set([
  "goal_needs_resource",
  "goal_resource_stale",
  "goal_review_pending",
  "goal_platform_stale",
  "goal_missing_confirmed",
  "goal_missing_monthly",
  "goal_review_stale",
  "goal_unconfirmed",
]);

/** Alert types that fold into one counted line. The label is the plural shown after the count. */
const GROUP_LABELS: Readonly<Record<string, { label: string; category: string }>> = {
  orientation_form_missing: { label: "orientation forms missing", category: "Orientation" },
  orientation_form_pending_review: { label: "forms awaiting review", category: "Orientation" },
  orientation_form_revision_needed: { label: "forms needing revision", category: "Orientation" },
  orientation_item_incomplete: { label: "orientation steps incomplete", category: "Orientation" },
  orientation_not_started: { label: "orientation steps not started", category: "Orientation" },
  orientation_overdue: { label: "orientation steps overdue", category: "Orientation" },
  goal_needs_resource: { label: "goals without assigned resources", category: "Goals" },
  goal_resource_stale: { label: "stale goal resources", category: "Goals" },
  goal_platform_stale: { label: "platforms visited, no follow-through", category: "Goals" },
  goal_review_pending: { label: "goal evidence items awaiting review", category: "Goals" },
  goal_stale: { label: "stale goals", category: "Goals" },
  goal_unconfirmed: { label: "goals awaiting confirmation", category: "Goals" },
  overdue_task: { label: "overdue tasks", category: "Tasks" },
  missed_appointment: { label: "missed appointments", category: "Advising" },
  certification_stalled: { label: "certifications stalled", category: "Certifications" },
  evidence_gap: { label: "required class items not done", category: "Requirements" },
  requirement_noncompliant: { label: "class requirements not met", category: "Requirements" },
  profile_birthdate_missing: { label: "birthdates missing", category: "Profile" },
  placement_outcome_pending: { label: "employment outcomes to record", category: "Placement" },
  connect_employer_no_view: { label: "packets employers have not opened", category: "Connect" },
  connect_employer_no_response: { label: "employers with no answer", category: "Connect" },
  connect_interview_unconfirmed: { label: "interviews not confirmed", category: "Connect" },
  connect_retention_confirm: { label: "retention check-ins to record", category: "Connect" },
  connect_retention_unanswered: { label: "retention check-ins with no reply", category: "Connect" },
  connect_retention_lost: { label: "placements reported ended", category: "Connect" },
};

const DAY_MS = 1000 * 60 * 60 * 24;

export interface QueueIssueGroup {
  /** Stable React key. */
  key: string;
  /** Short category word shown above the label, such as "Orientation". */
  category: string;
  /** "3 orientation forms missing", or the alert's own title for a group of one. */
  label: string;
  count: number;
  /** Highest severity in the group. */
  severity: string;
  urgent: boolean;
  /** Most urgent first. */
  alerts: QueueAlert[];
  /** Where to go to deal with the group. */
  link: InterventionAction;
  /** In-place action that opens the action panel, when the type has one the panel can run. */
  quickAction: DashboardQuickAction | null;
  /** Inactivity guidance; null for other types. */
  nextStep: string | null;
}

function compareAlertsBySeverity(left: QueueAlert, right: QueueAlert): number {
  const gap = alertSeverityRank(right.severity) - alertSeverityRank(left.severity);
  if (gap !== 0) return gap;
  return Date.parse(right.detectedAt) - Date.parse(left.detectedAt);
}

function compareGroups(left: QueueIssueGroup, right: QueueIssueGroup): number {
  const gap = alertSeverityRank(right.severity) - alertSeverityRank(left.severity);
  if (gap !== 0) return gap;
  return right.count - left.count;
}

function bucketKey(alert: QueueAlert): string {
  if (alert.type === WELLBEING_ALERT_TYPE) return `single:${alert.id}`;
  if (isInactivityAlertType(alert.type)) {
    return `inactivity:${normalizeInactivityAlertType(alert.type) ?? alert.type}`;
  }
  return GROUP_LABELS[alert.type] ? `type:${alert.type}` : `single:${alert.id}`;
}

function categoryFor(alert: QueueAlert, isInactivity: boolean): string {
  if (alert.type === WELLBEING_ALERT_TYPE) return "Wellbeing";
  if (isInactivity) return "Inactive";
  return GROUP_LABELS[alert.type]?.category ?? "Alert";
}

function quickActionFor(top: QueueAlert, isReview: boolean): DashboardQuickAction | null {
  const quick = isReview ? teacherDashboardReviewQuickAction(top.type) : teacherDashboardAlertQuickAction(top.type);
  // The action panel can only assign support to a specific goal.
  if (quick?.kind === "assign_support" && top.sourceType !== "goal") return null;
  return quick;
}

function buildGroup(key: string, top: QueueAlert, alerts: QueueAlert[], studentRecordId: string): QueueIssueGroup {
  const isReview = GOAL_REVIEW_ALERT_TYPES.has(top.type);
  const stage = isInactivityAlertType(top.type) ? getInactivityStageByType(top.type) : null;
  const plural = GROUP_LABELS[top.type];
  const count = alerts.length;

  return {
    key,
    category: categoryFor(top, stage !== null),
    label: count > 1 && plural ? `${count} ${plural.label}` : (stage?.label ?? top.title),
    count,
    severity: top.severity,
    urgent: isUrgentSeverity(top.severity),
    alerts,
    link: isReview
      ? teacherDashboardReviewAction(top.type, studentRecordId)
      : teacherDashboardAlertAction(top.type, studentRecordId),
    quickAction: quickActionFor(top, isReview),
    nextStep: stage?.nextStep ?? null,
  };
}

/** Fold one student's open alerts into the groups a teacher reads, most urgent first. Drops nothing. */
export function groupQueueIssues(alerts: readonly QueueAlert[], studentRecordId: string): QueueIssueGroup[] {
  const buckets = new Map<string, QueueAlert[]>();
  for (const alert of alerts) {
    const key = bucketKey(alert);
    buckets.set(key, [...(buckets.get(key) ?? []), alert]);
  }

  return [...buckets.entries()]
    .flatMap(([key, members]) => {
      const sorted = [...members].sort(compareAlertsBySeverity);
      const top = sorted[0];
      return top ? [buildGroup(key, top, sorted, studentRecordId)] : [];
    })
    .sort(compareGroups);
}

/** "Open since today", "Open 1 day", "Open 5 days". */
export function openForLabel(detectedAt: string, now: number): string {
  const days = Math.max(0, Math.floor((now - Date.parse(detectedAt)) / DAY_MS));
  if (days === 0) return "Open since today";
  return `Open ${days} day${days === 1 ? "" : "s"}`;
}

export interface InactivityStageCount {
  label: string;
  count: number;
}

/** How many queued students sit at each inactivity stage, earliest stage first, empty stages left out. */
export function countInactivityStages(rows: readonly { openAlerts: readonly QueueAlert[] }[]): InactivityStageCount[] {
  const counts = new Map<string, { rank: number; label: string; count: number }>();
  for (const alert of rows.flatMap((row) => row.openAlerts)) {
    const stage = getInactivityStageByType(alert.type);
    if (!stage) continue;
    const current = counts.get(stage.type);
    counts.set(stage.type, {
      rank: getInactivityStageRank(stage.type),
      label: stage.label,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...counts.values()]
    .sort((left, right) => left.rank - right.rank)
    .map(({ label, count }) => ({ label, count }));
}

export const QUEUE_ROWS_SHOWN = 10;

/** The first view: the top rows plus every urgent row below them, in queue order. */
export function visibleQueueRows<T extends { signals: { highSeverityAlertCount: number } }>(
  rows: readonly T[],
  showAll: boolean,
): T[] {
  if (showAll) return [...rows];
  return rows.filter((row, index) => index < QUEUE_ROWS_SHOWN || row.signals.highSeverityAlertCount > 0);
}

/**
 * The visible rows plus the pinned student's row, in queue order. A teacher with an action panel open under
 * a row keeps that row on screen even when finishing the action drops it out of the first view.
 */
export function withPinnedRow<T extends { studentId: string }>(
  visible: readonly T[],
  all: readonly T[],
  pinnedStudentId: string | null,
): T[] {
  if (pinnedStudentId === null || visible.some((row) => row.studentId === pinnedStudentId)) return [...visible];
  if (!all.some((row) => row.studentId === pinnedStudentId)) return [...visible];
  const shown = new Set(visible.map((row) => row.studentId));
  return all.filter((row) => row.studentId === pinnedStudentId || shown.has(row.studentId));
}

/** What the queue body shows. "stale" means the last load failed and the rows are from an earlier one. */
export type QueueBodyView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | { kind: "list"; stale: boolean };

/**
 * A failed refresh never hides rows the teacher already has: the list stays, marked stale. The in-place error is
 * only for a load that left nothing to show.
 */
export function queueBodyView(input: { loading: boolean; failed: boolean; rowCount: number }): QueueBodyView {
  if (input.loading) return { kind: "loading" };
  if (input.rowCount > 0) return { kind: "list", stale: input.failed };
  return input.failed ? { kind: "error" } : { kind: "empty" };
}

export function buildStudentSageMessage(name: string, groups: readonly QueueIssueGroup[]): string {
  return [
    `I need help with interventions for ${name}. Here are their current issues:`,
    "",
    ...groups.map((group) => `- ${group.label}${group.urgent ? " [URGENT]" : ""}`),
    "",
    "Please help me prioritize these, suggest what to address first, and recommend specific actions I can take.",
  ].join("\n");
}

/** How many alerts the groups hold. Every count in the prioritize message is in alerts, so the lines agree. */
function alertCount(groups: readonly QueueIssueGroup[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}

export function buildQueueSageMessage(rows: readonly { name: string; groups: readonly QueueIssueGroup[] }[]): string {
  const issueCount = rows.reduce((sum, row) => sum + alertCount(row.groups), 0);
  const body = rows.flatMap((row) => [
    `${row.name}: ${alertCount(row.groups.filter((group) => group.urgent))} urgent, ${alertCount(row.groups)} total`,
    ...row.groups.slice(0, 3).map((group) => `  - ${group.label}`),
    ...(row.groups.length > 3 ? [`  - ...and ${row.groups.length - 3} more`] : []),
  ]);
  return [
    `I have ${issueCount} open issue${issueCount === 1 ? "" : "s"} across ${rows.length} student${rows.length === 1 ? "" : "s"}. Here's a summary:`,
    "",
    ...body,
    "",
    "Help me prioritize which students to address first and suggest an action plan for the most urgent issues.",
  ].join("\n");
}
