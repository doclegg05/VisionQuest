"use client";

import { useContext } from "react";
import Link from "next/link";
import { WellbeingCrisisCard } from "@/components/teacher/WellbeingCrisisCard";
import { WELLBEING_ALERT_TYPE } from "@/lib/sage/wellbeing-card";
import type { QueueAlert } from "@/lib/teacher/intervention-queue";
import { openForLabel, type QueueIssueGroup } from "@/lib/teacher/queue-issue-groups";
import { alertControlId, doneLabel, SNOOZE_HOURS, type AlertLineState } from "./queue-undo";
import { QueueUndoActionContext } from "./queue-undo-action-context";
import { QueueUndoLineContext } from "./queue-undo-context";

export type QueueAlertAction = "snooze" | "resolve" | "dismiss";

const PILL =
  "inline-flex min-h-11 items-center rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]";

/** Resolved, and Undo in its place: a stronger outline than the other pills, so it reads as the main choice. */
const RESOLVED_PILL =
  "inline-flex min-h-11 items-center rounded-full border border-[var(--border-strong)] px-3 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]";

/** Dismiss: no outline and muted text, so it reads as the quieter choice. Still 44px tall. */
const QUIET_PILL =
  "ml-auto inline-flex min-h-11 items-center rounded-full px-3 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)] aria-disabled:opacity-60";

/** A busy control stays focusable (aria-disabled, not disabled), so focus never falls to the page while it waits. */
const BUSY = "aria-disabled:cursor-wait aria-disabled:opacity-60";

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
        <DoneLine alert={alert} studentName={studentName} lineState={lineState} />
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
 * A saved Resolved, Dismiss or Snooze. The text says what it means and takes a whole line, so Undo always starts the
 * next line at the left edge, away from where Dismiss was. Earlier done lines and a snoozed line keep only the text,
 * at the height of the pills they replace. While Undo is offered the line is taller than the pills were, by the
 * height of the text above the button, so what is below it moves down by that much.
 */
function DoneLine({
  alert,
  studentName,
  lineState,
}: {
  alert: QueueAlert;
  studentName: string;
  lineState: Extract<AlertLineState, { kind: "done" }>;
}) {
  const onUndo = useContext(QueueUndoActionContext);
  const textId = `${alertControlId(alert.id, "undo")}-text`;
  return (
    <div className="mt-1 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
      <p id={textId} className="basis-full text-xs font-semibold text-success">
        {doneLabel(lineState.action)}
      </p>
      {lineState.undoable ? (
        <button
          type="button"
          id={alertControlId(alert.id, "undo")}
          aria-disabled={lineState.undoing}
          aria-describedby={textId}
          onClick={onUndo}
          aria-label={`Undo "${alert.title}" for ${studentName}`}
          className={`${RESOLVED_PILL} ${BUSY}`}
        >
          Undo
        </button>
      ) : null}
    </div>
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
        id={alertControlId(alert.id, "resolve")}
        aria-disabled={busy}
        onClick={() => onAlertAction(alert.id, "resolve")}
        aria-label={`Mark "${alert.title}" resolved for ${studentName}`}
        className={`${RESOLVED_PILL} ${BUSY}`}
      >
        Resolved
      </button>
      <button
        type="button"
        id={alertControlId(alert.id, "snooze")}
        aria-disabled={busy}
        onClick={() => onAlertAction(alert.id, "snooze")}
        aria-label={`Snooze "${alert.title}" for ${studentName} for ${SNOOZE_HOURS} hours`}
        className={`${PILL} ${BUSY}`}
      >
        Snooze
      </button>
      <button
        type="button"
        id={alertControlId(alert.id, "dismiss")}
        aria-disabled={busy}
        onClick={() => onAlertAction(alert.id, "dismiss")}
        aria-label={`Dismiss "${alert.title}" for ${studentName}`}
        className={`${QUIET_PILL} ${BUSY}`}
      >
        Dismiss
      </button>
    </div>
  );
}
