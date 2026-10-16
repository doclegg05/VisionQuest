"use client";

import Link from "next/link";
import { WellbeingCrisisCard } from "@/components/teacher/WellbeingCrisisCard";
import { WELLBEING_ALERT_TYPE } from "@/lib/sage/wellbeing-card";
import type { QueueAlert } from "@/lib/teacher/intervention-queue";
import { openForLabel, type QueueIssueGroup } from "@/lib/teacher/queue-issue-groups";

export type QueueAlertAction = "snooze" | "resolve" | "dismiss";

const PILL =
  "inline-flex min-h-11 items-center rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]";

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
          className={`rounded-[0.85rem] border px-3 py-2.5 ${
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
  return (
    <li className="border-t border-[var(--border)] pt-2 first:border-t-0 first:pt-0">
      {alert.type === WELLBEING_ALERT_TYPE ? (
        <WellbeingCrisisCard summary={alert.summary} />
      ) : (
        <p className="text-xs text-[var(--ink-muted)]">{alert.summary}</p>
      )}
      <p className="mt-1 text-xs text-[var(--ink-muted)]">{openForLabel(alert.detectedAt, now)}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAlertAction(alert.id, "snooze")}
          aria-label={`Snooze "${alert.title}" for ${studentName} for 24 hours`}
          className={PILL}
        >
          Snooze
        </button>
        <button
          type="button"
          onClick={() => onAlertAction(alert.id, "resolve")}
          aria-label={`Mark "${alert.title}" resolved for ${studentName}`}
          className={PILL}
        >
          Resolved
        </button>
        <button
          type="button"
          onClick={() => onAlertAction(alert.id, "dismiss")}
          aria-label={`Dismiss "${alert.title}" for ${studentName}`}
          className={PILL}
        >
          Dismiss
        </button>
      </div>
    </li>
  );
}
