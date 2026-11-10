"use client";

import { useContext } from "react";
import Link from "next/link";
import { WellbeingCrisisCard } from "@/components/teacher/WellbeingCrisisCard";
import { WELLBEING_ALERT_TYPE } from "@/lib/sage/wellbeing-card";
import type { QueueAlert } from "@/lib/teacher/intervention-queue";
import { openForLabel, type QueueIssueGroup } from "@/lib/teacher/queue-issue-groups";
import { doneLabel } from "./queue-undo";
import { QueueUndoLineContext } from "./queue-undo-context";

export type QueueAlertAction = "snooze" | "resolve" | "dismiss";

const PILL =
  "inline-flex min-h-11 items-center rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]";

/** Resolved: a stronger outline than the other pills, so it reads as the main choice. */
const RESOLVED_PILL =
  "inline-flex min-h-11 items-center rounded-full border border-[var(--border-strong)] px-3 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]";

/** Dismiss: no outline and muted text, so it reads as the quieter choice. Still 44px tall. */
const QUIET_PILL =
  "ml-auto inline-flex min-h-11 items-center rounded-full px-3 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)] disabled:opacity-60";

export interface QueueRowIssuesProps {
  /** Element id, referenced by the row's toggle through aria-controls. */
  id: string;
  studentName: string;
  groups: readonly QueueIssueGroup[];
  now: number;
  onQuickAction: (group: QueueIssueGroup) => void;
  onAlertAction: (alertId: string, action: QueueAlertAction) => void;
}

export function QueueRowIssues({ id, studentName, groups, now, onQuickAction, onAlertAction }: QueueRowIssuesProps) {
  return (
    <ul id={id} aria-label={`Open issues for ${studentName}`} className="mt-3 space-y-2">
      {groups.map((group) => (
        <li
          key={group.key}
          className={`rounded-lg border px-3 py-2.5 ${
            group.urgent
              ? "border-[var(--border-strong)] bg-[var(--surface-raised)]"
              : "border-[var(--border)] bg-[var(--surface-raised)]"
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            {group.category}
            {group.urgent ? (
              <span className="ml-2 rounded-full bg-[var(--error)] px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-[var(--on-error)]">
                Urgent
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-sm font-medium text-[var(--ink-strong)]">{group.label}</p>
          {group.nextStep ? (
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">Next step: {group.nextStep}</p>
          ) : null}
          <ul className="mt-2 space-y-2">
            {group.alerts.map((alert) => (
              <AlertLine key={alert.id} alert={alert} studentName={studentName} now={now} onAlertAction={onAlertAction} />
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            {group.quickAction ? (
              <button type="button" onClick={() => onQuickAction(group)} className={PILL}>
                {group.quickAction.label}
              </button>
            ) : null}
            <Link href={group.link.href} className={PILL}>
              {group.link.label}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AlertLine({
  alert,
  studentName,
  now,
  onAlertAction,
}: {
  alert: QueueAlert;
  studentName: string;
  now: number;
  onAlertAction: QueueRowIssuesProps["onAlertAction"];
}) {
  const lineState = useContext(QueueUndoLineContext)(alert.id);
  return (
    <li className="border-t border-[var(--border)] pt-2 first:border-t-0 first:pt-0">
      {alert.type === WELLBEING_ALERT_TYPE ? (
        <WellbeingCrisisCard summary={alert.summary} />
      ) : (
        <p className="text-xs text-[var(--ink-muted)]">{alert.summary}</p>
      )}
      <p className="mt-1 text-xs text-[var(--ink-muted)]">{openForLabel(alert.detectedAt, now)}</p>
      {lineState.kind === "done" ? (
        // Same height as the buttons it replaces, so nothing below it moves while Undo is offered.
        <p className="mt-1 flex min-h-11 items-center text-xs font-semibold text-success">
          {doneLabel(lineState.action)}
        </p>
      ) : (
        <AlertActions
          alert={alert}
          studentName={studentName}
          busy={lineState.kind === "busy"}
          onAlertAction={onAlertAction}
        />
      )}
    </li>
  );
}

/**
 * Resolved leads with an outline. Dismiss is plain muted text pushed to the far end, with Snooze between, so a thumb
 * aimed at one does not land on the other.
 */
function AlertActions({
  alert,
  studentName,
  busy,
  onAlertAction,
}: {
  alert: QueueAlert;
  studentName: string;
  busy: boolean;
  onAlertAction: QueueRowIssuesProps["onAlertAction"];
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <button
        type="button"
        id={`queue-alert-${alert.id}-resolve`}
        disabled={busy}
        onClick={() => onAlertAction(alert.id, "resolve")}
        aria-label={`Mark "${alert.title}" resolved for ${studentName}`}
        className={`${RESOLVED_PILL} disabled:opacity-60`}
      >
        Resolved
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onAlertAction(alert.id, "snooze")}
        aria-label={`Snooze "${alert.title}" for ${studentName} for 24 hours`}
        className={`${PILL} disabled:opacity-60`}
      >
        Snooze
      </button>
      <button
        type="button"
        id={`queue-alert-${alert.id}-dismiss`}
        disabled={busy}
        onClick={() => onAlertAction(alert.id, "dismiss")}
        aria-label={`Dismiss "${alert.title}" for ${studentName}`}
        className={QUIET_PILL}
      >
        Dismiss
      </button>
    </div>
  );
}
