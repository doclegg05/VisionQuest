"use client";

import Link from "next/link";
import { getInactivityStageByType } from "@/lib/inactivity";
import {
  teacherDashboardAlertAction,
  teacherDashboardAlertQuickAction,
  teacherDashboardReviewAction,
  teacherDashboardReviewQuickAction,
} from "@/lib/intervention-notifications";
import type { DashboardActionIntent } from "../DashboardActionPanel";
import type {
  DashboardAlert,
  InactivityQueueItem,
  InactivitySummary,
  ReviewQueueItem,
  UpcomingAppointment,
} from "@/lib/teacher/dashboard";

export default function DetailedQueues({
  detailsOpen,
  alerts,
  reviewQueue,
  upcomingAppointments,
  inactivityQueue,
  inactivitySummary,
  currentClassId,
  onToggle,
  onSetActionIntent,
  onSnoozeAlert,
  onDismissAlert,
  relativeTime,
  formatAppointment,
  buildAlertQuickIntent,
  buildReviewQuickIntent,
}: {
  detailsOpen: boolean;
  alerts: DashboardAlert[];
  reviewQueue: ReviewQueueItem[];
  upcomingAppointments: UpcomingAppointment[];
  inactivityQueue: InactivityQueueItem[];
  inactivitySummary: InactivitySummary;
  currentClassId: string;
  onToggle: () => void;
  onSetActionIntent: (intent: DashboardActionIntent) => void;
  onSnoozeAlert: (alertId: string) => Promise<void>;
  onDismissAlert: (alertId: string) => Promise<void>;
  relativeTime: (dateStr: string) => string;
  formatAppointment: (dateStr: string) => string;
  buildAlertQuickIntent: (alert: DashboardAlert) => DashboardActionIntent | null;
  buildReviewQuickIntent: (item: ReviewQueueItem) => DashboardActionIntent | null;
}) {
  return (
    <div className="surface-section overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-black/[0.02]"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-[var(--ink-muted)] transition-transform ${detailsOpen ? "rotate-90" : ""}`}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <div className="flex flex-1 items-center gap-3">
          <h2 className="font-display text-lg text-[var(--ink-strong)]">Detailed Queues</h2>
          <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-0.5 text-xs font-semibold text-[var(--ink-muted)]">
            {alerts.length} alerts &middot; {reviewQueue.length} reviews &middot; {upcomingAppointments.length} appointments &middot; {inactivityQueue.length} inactive
          </span>
        </div>
      </button>

      {detailsOpen ? (
        <div className="space-y-6 border-t border-[var(--border)] px-5 pb-5 pt-4">
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-[1.15rem] border border-[var(--border)] p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
                    Needs attention
                  </p>
                  <h3 className="mt-2 font-display text-xl text-[var(--ink-strong)]">Open student alerts</h3>
                </div>
                <span className="rounded-full bg-[rgba(249,115,22,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                  {alerts.length} open
                </span>
              </div>

              {alerts.length === 0 ? (
                <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                  No active advising alerts right now.
                </p>
              ) : (
                <div className="space-y-3">
                  {alerts.map((alert) => {
                    const quickIntent = buildAlertQuickIntent(alert);
                    const action = teacherDashboardAlertAction(alert.type, alert.student.id);
                    const quickAction = teacherDashboardAlertQuickAction(alert.type);

                    return (
                      <div
                        key={alert.id}
                        className="block rounded-[1rem] border border-amber-200 bg-amber-50/80 p-4 transition-colors hover:border-amber-300"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-semibold text-[var(--ink-strong)]">{alert.title}</p>
                            <p className="mt-1 break-words text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                              {alert.student.displayName} &bull; {alert.student.studentId}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-amber-800">
                            {alert.severity}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{alert.summary}</p>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs text-[var(--ink-muted)]">
                            Detected {relativeTime(alert.detectedAt)}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            {quickIntent ? (
                              <button
                                type="button"
                                onClick={() => onSetActionIntent(quickIntent)}
                                className="rounded-full border border-white/80 bg-[var(--surface-raised)]/70 px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-raised)]"
                              >
                                {quickAction?.label}
                              </button>
                            ) : null}
                            <Link
                              href={action.href}
                              className="rounded-full bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
                            >
                              {action.label}
                            </Link>
                            <button
                              type="button"
                              onClick={() => void onSnoozeAlert(alert.id)}
                              className="rounded-full px-2.5 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)]"
                              title="Snooze for 24 hours"
                            >
                              Snooze
                            </button>
                            <button
                              type="button"
                              onClick={() => void onDismissAlert(alert.id)}
                              className="rounded-full px-2.5 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)]"
                              title="Dismiss this alert"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-[1.15rem] border border-[var(--border)] p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-secondary)]">
                    Goal review
                  </p>
                  <h3 className="mt-2 font-display text-xl text-[var(--ink-strong)]">Review queue</h3>
                </div>
                <span className="rounded-full bg-[rgba(15,154,146,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-secondary)]">
                  {reviewQueue.length} open
                </span>
              </div>

              {reviewQueue.length === 0 ? (
                <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                  No goal-linked review items are waiting right now.
                </p>
              ) : (
                <div className="space-y-3">
                  {reviewQueue.map((item) => {
                    const quickIntent = buildReviewQuickIntent(item);
                    const action = teacherDashboardReviewAction(item.type, item.student.id);
                    const quickAction = teacherDashboardReviewQuickAction(item.type);

                    return (
                      <div
                        key={item.id}
                        className={`block rounded-[1rem] border p-4 transition-colors ${
                          item.severity === "high"
                            ? "border-rose-200 bg-rose-50/80 hover:border-rose-300"
                            : "border-amber-200 bg-amber-50/80 hover:border-amber-300"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-semibold text-[var(--ink-strong)]">{item.title}</p>
                            <p className="mt-1 break-words text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                              {item.student.displayName} &bull; {item.student.studentId}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-strong)]">
                            {item.severity}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{item.summary}</p>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs text-[var(--ink-muted)]">
                            Detected {relativeTime(item.detectedAt)}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            {quickIntent ? (
                              <button
                                type="button"
                                onClick={() => onSetActionIntent(quickIntent)}
                                className="rounded-full border border-white/80 bg-[var(--surface-raised)]/70 px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-raised)]"
                              >
                                {quickAction?.label}
                              </button>
                            ) : null}
                            <Link
                              href={action.href}
                              className="rounded-full bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
                            >
                              {action.label}
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-[1.15rem] border border-[var(--border)] p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-secondary)]">
                    This week
                  </p>
                  <h3 className="mt-2 font-display text-xl text-[var(--ink-strong)]">Upcoming appointments</h3>
                </div>
                <span className="rounded-full bg-[rgba(15,154,146,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-secondary)]">
                  {upcomingAppointments.length} scheduled
                </span>
              </div>

              {upcomingAppointments.length === 0 ? (
                <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                  No appointments are scheduled in the next 7 days.
                </p>
              ) : (
                <div className="space-y-3">
                  {upcomingAppointments.map((appointment) => (
                    <Link
                      key={appointment.id}
                      href={`/teacher/students/${appointment.student.id}`}
                      className="block rounded-[1rem] border border-[rgba(15,154,146,0.14)] bg-[rgba(15,154,146,0.08)] p-4 transition-colors hover:border-[rgba(15,154,146,0.28)]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-semibold text-[var(--ink-strong)]">{appointment.title}</p>
                          <p className="mt-1 break-words text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                            {appointment.student.displayName} &bull; {appointment.student.studentId}
                          </p>
                        </div>
                        <span className="max-w-full rounded-full bg-[var(--surface-raised)] px-2.5 py-1 text-center text-xs leading-4 font-semibold text-[var(--accent-secondary)] whitespace-normal">
                          {appointment.locationLabel || appointment.locationType.replace("_", " ")}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--ink-muted)]">
                        {formatAppointment(appointment.startsAt)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[1.15rem] border border-[var(--border)] p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
                  Re-engagement
                </p>
                <h3 className="mt-2 font-display text-xl text-[var(--ink-strong)]">Inactivity follow-up queue</h3>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">
                  Use 14-day follow-up, 30-day inactive, 60-day re-engagement, and 90-day archive review as staff checkpoints instead of automatic archiving.
                </p>
              </div>
              <span className="rounded-full bg-[rgba(249,115,22,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                {inactivityQueue.length} queued
              </span>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                14-day {inactivitySummary.followUp14}
              </span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                30-day {inactivitySummary.inactive30}
              </span>
              <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                60-day {inactivitySummary.reengage60}
              </span>
              <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-800">
                90-day {inactivitySummary.archiveReview90}
              </span>
            </div>

            {inactivityQueue.length === 0 ? (
              <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                No students are currently in the inactivity follow-up queue.
              </p>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {inactivityQueue.map((item) => {
                  const stage = getInactivityStageByType(item.type);
                  const quickAction = teacherDashboardAlertQuickAction(item.type);

                  return (
                    <div
                      key={item.id}
                      className="rounded-[1rem] border border-[var(--border)] bg-[rgba(255,255,255,0.68)] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-semibold text-[var(--ink-strong)]">{item.student.displayName}</p>
                          <p className="mt-1 break-words text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                            {item.student.studentId}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${
                            item.type === "inactive_student_90"
                              ? "bg-rose-100 text-rose-800"
                              : item.type === "inactive_student_60"
                                ? "bg-orange-100 text-orange-700"
                                : item.type === "inactive_student_30"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                          }`}
                        >
                          {item.stageLabel}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{item.summary}</p>
                      <p className="mt-2 text-xs text-[var(--ink-muted)]">{stage?.nextStep || item.nextStep}</p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-[var(--ink-muted)]">Detected {relativeTime(item.detectedAt)}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          {quickAction ? (
                            <button
                              type="button"
                              onClick={() =>
                                onSetActionIntent({
                                  kind: quickAction.kind,
                                  title: item.title,
                                  summary: item.summary,
                                  severity: item.severity,
                                  student: item.student,
                                  goalId: null,
                                  linkId: null,
                                })
                              }
                              className="rounded-full border border-white/80 bg-[var(--surface-raised)]/70 px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-raised)]"
                            >
                              {quickAction.label}
                            </button>
                          ) : null}
                          <Link
                            href={`/teacher/students/${item.student.id}`}
                            className="rounded-full bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
                          >
                            Open student
                          </Link>
                          <Link
                            href={`/teacher/classes${currentClassId ? `?classId=${encodeURIComponent(currentClassId)}` : ""}`}
                            className="rounded-full bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
                          >
                            Manage roster
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
