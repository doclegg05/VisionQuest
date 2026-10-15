"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarPlus, ListPlus, NotePencil } from "@phosphor-icons/react";
import ProgramBadge from "@/components/ui/ProgramBadge";
import { WELLBEING_ALERT_TYPE, formatWellbeingQueueLine } from "@/lib/sage/wellbeing-card";
import { urgencyLevel, type InterventionQueueEntry, type UrgencyLevel } from "@/lib/teacher/intervention-queue";
import {
  buildStudentSageMessage,
  groupQueueIssues,
  openForLabel,
  type QueueIssueGroup,
} from "@/lib/teacher/queue-issue-groups";
import { mainActionMode } from "./queue-actions";
import { QueueRowIssues, type QueueAlertAction } from "./QueueRowIssues";

const URGENCY_BADGE: Record<UrgencyLevel, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-[var(--urgency-critical-bg)] text-[var(--urgency-critical-text)]" },
  high: { label: "High", className: "bg-[var(--urgency-high-bg)] text-[var(--urgency-high-text)]" },
  medium: { label: "Medium", className: "bg-[var(--urgency-medium-bg)] text-[var(--urgency-medium-text)]" },
};

const MAIN_ACTION =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--accent-strong)] px-4 text-sm font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-green)]/90 sm:w-auto";
const TOOL =
  "inline-flex size-11 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-interactive)] hover:text-[var(--ink-strong)]";
const PILL =
  "inline-flex min-h-11 items-center rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function topReason(signals: InterventionQueueEntry["signals"]): string {
  if (signals.highSeverityAlertCount > 0) return plural(signals.highSeverityAlertCount, "urgent alert");
  if (signals.stalledGoalCount > 0) return plural(signals.stalledGoalCount, "stalled goal");
  if (signals.overdueTaskCount > 0) return plural(signals.overdueTaskCount, "overdue task");
  if (signals.unmatchedGoalCount > 0) {
    return `${plural(signals.unmatchedGoalCount, "goal")} without a pathway`;
  }
  if (signals.daysSinceLastLogin > 7) return `No login for ${signals.daysSinceLastLogin} days`;
  if (!signals.orientationComplete) return `Orientation ${Math.round(signals.orientationProgress * 100)}% done`;
  return "Low readiness";
}

export interface QueueStudentRowProps {
  student: InterventionQueueEntry;
  now: number;
  /** The action panel for this student, when one is open. It renders inside the row. */
  actionPanel: ReactNode;
  onMainAction: (student: InterventionQueueEntry) => void;
  onQuickAction: (student: InterventionQueueEntry, group: QueueIssueGroup) => void;
  onAlertAction: (alertId: string, action: QueueAlertAction) => void;
  onQuickTask: (student: InterventionQueueEntry) => void;
  onQuickNote: (student: InterventionQueueEntry) => void;
  onSchedule: (student: InterventionQueueEntry) => void;
  onAskSage: (message: string) => void;
}

export function QueueStudentRow({
  student,
  now,
  actionPanel,
  onMainAction,
  onQuickAction,
  onAlertAction,
  onQuickTask,
  onQuickNote,
  onSchedule,
  onAskSage,
}: QueueStudentRowProps) {
  const groups = useMemo(
    () => groupQueueIssues(student.openAlerts, student.studentId),
    [student.openAlerts, student.studentId],
  );
  const [expanded, setExpanded] = useState(student.primaryAlert?.severity === "critical");
  const badge = URGENCY_BADGE[urgencyLevel(student)];
  const main = mainActionMode(student);
  const issuesId = `queue-issues-${student.studentId}`;
  const issueCount = student.openAlerts.length;
  const chips = student.urgencyReasons.slice(0, 3);
  const hiddenReasonCount = student.urgencyReasons.length - chips.length;
  const crisisLine =
    student.primaryAlert?.type === WELLBEING_ALERT_TYPE
      ? (formatWellbeingQueueLine(student.primaryAlert.summary) ?? student.primaryAlert.summary)
      : null;
  const mainLabel = `${student.recommendedAction.label} for ${student.name}`;

  return (
    <li className="rounded-[1.15rem] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
      {/* Line 1: who, and how urgent */}
      <div className="flex items-center justify-between gap-3">
        <Link href={`/teacher/students/${student.studentId}`} className="inline-flex min-h-11 min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-[var(--ink-strong)]">{student.name}</span>
          <span className="shrink-0 text-xs text-[var(--ink-muted)]">{student.publicStudentId}</span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <ProgramBadge programType={student.programType} size="sm" />
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
        </div>
      </div>

      {/* Line 2: the top reason, and how long it has been open */}
      <p className="mt-1 text-sm text-[var(--ink-strong)]">
        {student.primaryAlert?.title ?? topReason(student.signals)}
        {student.primaryAlert ? (
          <span className="text-[var(--ink-muted)]"> · {openForLabel(student.primaryAlert.detectedAt, now)}</span>
        ) : null}
      </p>
      {crisisLine && !expanded ? <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{crisisLine}</p> : null}

      {/* Line 3: the other reasons, and the way into every issue */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <span key={chip} className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--ink-muted)]">
            {chip}
          </span>
        ))}
        {hiddenReasonCount > 0 ? <span className="text-xs text-[var(--ink-muted)]">+{hiddenReasonCount} more</span> : null}
        {issueCount > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={issuesId}
            onClick={() => setExpanded((open) => !open)}
            className={PILL}
          >
            {expanded ? "Hide issues" : `See all ${plural(issueCount, "issue")}`}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <QueueRowIssues
          id={issuesId}
          studentName={student.name}
          groups={groups}
          now={now}
          onQuickAction={(group) => onQuickAction(student, group)}
          onAlertAction={onAlertAction}
        />
      ) : null}

      {/* Line 4: one main action, then the quick tools */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {main.mode === "link" ? (
          <Link href={main.href} aria-label={mainLabel} className={MAIN_ACTION}>
            {student.recommendedAction.label}
          </Link>
        ) : (
          <button type="button" onClick={() => onMainAction(student)} aria-label={mainLabel} className={MAIN_ACTION}>
            {student.recommendedAction.label}
          </button>
        )}
        <button
          type="button"
          onClick={() => onQuickNote(student)}
          aria-label={`Add a note for ${student.name}`}
          title={`Add a note for ${student.name}`}
          className={TOOL}
        >
          <NotePencil size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onSchedule(student)}
          aria-label={`Schedule an appointment with ${student.name}`}
          title={`Schedule an appointment with ${student.name}`}
          className={TOOL}
        >
          <CalendarPlus size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onQuickTask(student)}
          aria-label={`Assign a task to ${student.name}`}
          title={`Assign a task to ${student.name}`}
          className={TOOL}
        >
          <ListPlus size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onAskSage(buildStudentSageMessage(student.name, groups))}
          aria-label={`Ask Sage about ${student.name}`}
          className={PILL}
        >
          Ask Sage
        </button>
      </div>

      {actionPanel}
    </li>
  );
}
