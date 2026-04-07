"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DashboardActionPanel, { type DashboardActionIntent } from "./DashboardActionPanel";
import InterventionQueue from "./InterventionQueue";
import { apiFetch } from "@/lib/api";
import { getInactivityStageByType } from "@/lib/inactivity";
import {
  teacherDashboardAlertAction,
  teacherDashboardAlertQuickAction,
  teacherDashboardReviewAction,
  teacherDashboardReviewQuickAction,
} from "@/lib/intervention-notifications";

interface StudentOverview {
  id: string;
  studentId: string;
  displayName: string;
  createdAt: string;
  lastActive: string;
  xp: number;
  level: number;
  streak: number;
  hasBhag: boolean;
  goalsCount: number;
  orientationDone: number;
  orientationTotal: number;
  certStatus: string;
  certDone: number;
  certTotal: number;
  certPendingVerify: number;
  openAlertCount: number;
  nextAppointmentAt: string | null;
  portfolioItems: number;
  hasResume: boolean;
  filesCount: number;
  isActive: boolean;
  readinessScore: number;
}

interface ManagedClassOption {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface DashboardAlert {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  detectedAt: string;
  student: {
    id: string;
    studentId: string;
    displayName: string;
  };
}

interface ReviewQueueItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  detectedAt: string;
  student: {
    id: string;
    studentId: string;
    displayName: string;
  };
}

interface UpcomingAppointment {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  locationType: string;
  locationLabel: string | null;
  student: {
    id: string;
    studentId: string;
    displayName: string;
  };
}

interface InactivityQueueItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  detectedAt: string;
  stageLabel: string;
  nextStep: string;
  student: {
    id: string;
    studentId: string;
    displayName: string;
  };
}

interface InactivitySummary {
  followUp14: number;
  inactive30: number;
  reengage60: number;
  archiveReview90: number;
}

type SortKey = "displayName" | "lastActive" | "xp" | "certDone" | "orientationDone" | "readinessScore";

export default function ClassOverview() {
  const [classes, setClasses] = useState<ManagedClassOption[]>([]);
  const [currentClassId, setCurrentClassId] = useState("");
  const [students, setStudents] = useState<StudentOverview[]>([]);
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const [inactivityQueue, setInactivityQueue] = useState<InactivityQueueItem[]>([]);
  const [inactivitySummary, setInactivitySummary] = useState<InactivitySummary>({
    followUp14: 0,
    inactive30: 0,
    reengage60: 0,
    archiveReview90: 0,
  });
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<UpcomingAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("displayName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showInactive, setShowInactive] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [actionIntent, setActionIntent] = useState<DashboardActionIntent | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const applyStudentPage = useCallback((data: {
    classes?: ManagedClassOption[];
    currentClassId?: string | null;
    students?: StudentOverview[];
    alerts?: DashboardAlert[];
    inactivityQueue?: InactivityQueueItem[];
    inactivitySummary?: InactivitySummary;
    reviewQueue?: ReviewQueueItem[];
    upcomingAppointments?: UpcomingAppointment[];
    totalPages?: number;
    page?: number;
  }) => {
    setClasses(data.classes || []);
    setCurrentClassId(data.currentClassId || "");
    setStudents(data.students || []);
    setAlerts(data.alerts || []);
    setInactivityQueue(data.inactivityQueue || []);
    setInactivitySummary(data.inactivitySummary || {
      followUp14: 0,
      inactive30: 0,
      reengage60: 0,
      archiveReview90: 0,
    });
    setReviewQueue(data.reviewQueue || []);
    setUpcomingAppointments(data.upcomingAppointments || []);
    setTotalPages(data.totalPages || 1);
    setPage(data.page || 1);
    setError(null);
  }, []);

  const fetchStudents = useCallback(async (p: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/teacher/dashboard?page=${p}&limit=50${showInactive ? "&showInactive=true" : ""}${currentClassId ? `&classId=${encodeURIComponent(currentClassId)}` : ""}`;
      const response = await apiFetch(url);
      const data = await response.json();
      applyStudentPage(data);
    } catch {
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [applyStudentPage, currentClassId, showInactive]);

  useEffect(() => {
    async function loadStudents() {
      try {
        const url = `/api/teacher/dashboard?page=1&limit=50${showInactive ? "&showInactive=true" : ""}${currentClassId ? `&classId=${encodeURIComponent(currentClassId)}` : ""}`;
        const response = await apiFetch(url);
        const data = await response.json();
        applyStudentPage(data);
      } catch {
        setError("Failed to load. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    void loadStudents();
  }, [applyStudentPage, currentClassId, showInactive]);

  function handleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  }

  const filtered = students
    .filter(
      (s) =>
        s.displayName.toLowerCase().includes(search.toLowerCase()) ||
        s.studentId.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === "displayName") cmp = a.displayName.localeCompare(b.displayName);
      else if (sortBy === "lastActive") cmp = new Date(a.lastActive).getTime() - new Date(b.lastActive).getTime();
      else if (sortBy === "xp") cmp = a.xp - b.xp;
      else if (sortBy === "certDone") cmp = a.certDone - b.certDone;
      else if (sortBy === "orientationDone") cmp = a.orientationDone - b.orientationDone;
      else if (sortBy === "readinessScore") cmp = a.readinessScore - b.readinessScore;
      return sortDir === "desc" ? -cmp : cmp;
    });

  // Summary stats
  const totalStudents = students.length;
  const pendingVerifications = students.reduce((sum, s) => sum + s.certPendingVerify, 0);
  const studentsNeedingAttention = students.filter((s) => s.openAlertCount > 0).length;
  const avgXp = totalStudents > 0 ? Math.round(students.reduce((sum, s) => sum + s.xp, 0) / totalStudents) : 0;

  const [renderedAt] = useState(() => Date.now());

  function relativeTime(dateStr: string) {
    const diff = renderedAt - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }

  function getSortIcon(col: SortKey) {
    if (sortBy !== col) return <span className="ml-1 text-gray-300">↕</span>;
    return <span className="ml-1 text-[var(--accent-blue)]">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  function formatAppointment(dateStr: string) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(dateStr));
  }

  function buildOrientationWorkspaceHref(studentId: string) {
    const params = new URLSearchParams({ studentId });
    if (currentClassId) {
      params.set("classId", currentClassId);
    }
    return `/teacher/orientation?${params.toString()}`;
  }

  function studentActionLinks(studentId: string) {
    return {
      record: `/teacher/students/${studentId}`,
      orientation: buildOrientationWorkspaceHref(studentId),
      forms: `/teacher/students/${studentId}#submitted-forms`,
      goals: `/teacher/students/${studentId}#goal-plans`,
    };
  }

  function buildAlertQuickIntent(alert: DashboardAlert): DashboardActionIntent | null {
    const quickAction = teacherDashboardAlertQuickAction(alert.type);
    if (!quickAction) return null;
    if (quickAction.kind === "assign_support" && alert.sourceType !== "goal") return null;

    return {
      kind: quickAction.kind,
      title: alert.title,
      summary: alert.summary,
      severity: alert.severity,
      student: alert.student,
      goalId: alert.sourceType === "goal" ? alert.sourceId : null,
      linkId: alert.sourceType === "goal_resource_link" ? alert.sourceId : null,
    };
  }

  function buildReviewQuickIntent(item: ReviewQueueItem): DashboardActionIntent | null {
    const quickAction = teacherDashboardReviewQuickAction(item.type);
    if (!quickAction) return null;
    if (quickAction.kind === "assign_support" && item.sourceType !== "goal") return null;

    return {
      kind: quickAction.kind,
      title: item.title,
      summary: item.summary,
      severity: item.severity,
      student: item.student,
      goalId: item.sourceType === "goal" ? item.sourceId : null,
      linkId: item.sourceType === "goal_resource_link" ? item.sourceId : null,
    };
  }

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading class data...</p>;

  if (error) return (
    <div className="surface-section px-6 py-10 text-center">
      <p className="mb-4 text-sm text-red-600">{error}</p>
      <button onClick={() => fetchStudents()} className="primary-button px-4 py-2 text-sm">
        Try Again
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {actionIntent ? (
        <DashboardActionPanel
          intent={actionIntent}
          onClose={() => setActionIntent(null)}
          onChanged={() => fetchStudents(page)}
        />
      ) : null}

      {/* ── Primary View: Students Needing Attention ────────────────────── */}
      <InterventionQueue
        alerts={alerts}
        inactivityQueue={inactivityQueue}
        reviewQueue={reviewQueue}
        onAction={(intent) => setActionIntent({
          kind: "create_task",
          title: intent.type,
          summary: intent.studentName,
          severity: "medium",
          student: {
            id: intent.studentId,
            studentId: intent.studentId,
            displayName: intent.studentName,
          },
        })}
      />

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="surface-section p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Students</p>
          <p className="mt-3 text-3xl font-bold text-[var(--ink-strong)]">{totalStudents}</p>
        </div>
        <div className="surface-section p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Pending Verifications</p>
          <p className="mt-3 text-3xl font-bold text-orange-600">{pendingVerifications}</p>
        </div>
        <div className="surface-section p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Need Attention</p>
          <p className="mt-3 text-3xl font-bold text-rose-600">{studentsNeedingAttention}</p>
        </div>
        <div className="surface-section p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Average XP</p>
          <p className="mt-3 text-3xl font-bold text-[var(--accent-blue)]">{avgXp}</p>
        </div>
      </div>

      {/* ── Collapsible Detailed Queues ─────────────────────────────────── */}
      <div className="surface-section overflow-hidden">
        <button
          type="button"
          onClick={() => setDetailsOpen((prev) => !prev)}
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
            <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--ink-muted)]">
              {alerts.length} alerts &middot; {reviewQueue.length} reviews &middot; {upcomingAppointments.length} appointments &middot; {inactivityQueue.length} inactive
            </span>
          </div>
        </button>

        {detailsOpen && (
          <div className="space-y-6 border-t border-[rgba(18,38,63,0.08)] px-5 pb-5 pt-4">
            {/* 3-column grid: alerts, review, appointments */}
            <div className="grid gap-4 xl:grid-cols-3">
              <div className="rounded-[1.15rem] border border-[rgba(18,38,63,0.08)] p-5">
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
                  <p className="rounded-[1rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
                    No active advising alerts right now.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {alerts.map((alert) => (
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
                          <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                            {alert.severity}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{alert.summary}</p>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs text-[var(--ink-muted)]">
                            Detected {relativeTime(alert.detectedAt)}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            {(() => {
                              const quickIntent = buildAlertQuickIntent(alert);
                              return quickIntent ? (
                                <button
                                  type="button"
                                  onClick={() => setActionIntent(quickIntent)}
                                  className="rounded-full border border-white/80 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-strong)] transition-colors hover:bg-white"
                                >
                                  {teacherDashboardAlertQuickAction(alert.type)?.label}
                                </button>
                              ) : null;
                            })()}
                            <Link
                              href={teacherDashboardAlertAction(alert.type, alert.student.id).href}
                              className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[rgba(16,37,62,0.06)]"
                            >
                              {teacherDashboardAlertAction(alert.type, alert.student.id).label}
                            </Link>
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await fetch(`/api/teacher/alerts/${alert.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "snooze", hours: 24 }),
                                });
                                if (!res.ok) return;
                                setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
                              }}
                              className="rounded-full px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink-muted)] transition-colors hover:bg-[rgba(16,37,62,0.06)]"
                              title="Snooze for 24 hours"
                            >
                              Snooze
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await fetch(`/api/teacher/alerts/${alert.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "dismiss" }),
                                });
                                if (!res.ok) return;
                                setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
                              }}
                              className="rounded-full px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink-muted)] transition-colors hover:bg-[rgba(16,37,62,0.06)]"
                              title="Dismiss this alert"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-[1.15rem] border border-[rgba(18,38,63,0.08)] p-5">
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
                  <p className="rounded-[1rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
                    No goal-linked review items are waiting right now.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {reviewQueue.map((item) => (
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
                          <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-700">
                            {item.severity}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{item.summary}</p>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs text-[var(--ink-muted)]">
                            Detected {relativeTime(item.detectedAt)}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            {(() => {
                              const quickIntent = buildReviewQuickIntent(item);
                              return quickIntent ? (
                                <button
                                  type="button"
                                  onClick={() => setActionIntent(quickIntent)}
                                  className="rounded-full border border-white/80 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-strong)] transition-colors hover:bg-white"
                                >
                                  {teacherDashboardReviewQuickAction(item.type)?.label}
                                </button>
                              ) : null;
                            })()}
                            <Link
                              href={teacherDashboardReviewAction(item.type, item.student.id).href}
                              className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[rgba(16,37,62,0.06)]"
                            >
                              {teacherDashboardReviewAction(item.type, item.student.id).label}
                            </Link>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-[1.15rem] border border-[rgba(18,38,63,0.08)] p-5">
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
                  <p className="rounded-[1rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
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
                          <span className="max-w-full rounded-full bg-white px-2.5 py-1 text-center text-[11px] leading-4 font-semibold text-[var(--accent-secondary)] whitespace-normal">
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

            {/* Inactivity follow-up queue */}
            <div className="rounded-[1.15rem] border border-[rgba(18,38,63,0.08)] p-5">
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
                <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-3 py-1 text-xs font-semibold text-[var(--ink-muted)]">
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
                <p className="rounded-[1rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
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
                        className="rounded-[1rem] border border-[rgba(18,38,63,0.08)] bg-[rgba(255,255,255,0.68)] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-semibold text-[var(--ink-strong)]">{item.student.displayName}</p>
                            <p className="mt-1 break-words text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                              {item.student.studentId}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                              item.type === "inactive_student_90"
                                ? "bg-rose-100 text-rose-800"
                                : item.type === "inactive_student_60"
                                  ? "bg-orange-100 text-orange-700"
                                  : item.type === "inactive_student_30"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-[rgba(16,37,62,0.06)] text-[var(--ink-muted)]"
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
                                  setActionIntent({
                                    kind: quickAction.kind,
                                    title: item.title,
                                    summary: item.summary,
                                    severity: item.severity,
                                    student: item.student,
                                    goalId: null,
                                    linkId: null,
                                  })
                                }
                                className="rounded-full border border-white/80 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-strong)] transition-colors hover:bg-white"
                              >
                                {quickAction.label}
                              </button>
                            ) : null}
                            <Link
                              href={`/teacher/students/${item.student.id}`}
                              className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[rgba(16,37,62,0.06)]"
                            >
                              Open student
                            </Link>
                            <Link
                              href={`/teacher/classes${currentClassId ? `?classId=${encodeURIComponent(currentClassId)}` : ""}`}
                              className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[rgba(16,37,62,0.06)]"
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
        )}
      </div>

      {/* ── All Students ────────────────────────────────────────────────── */}
      <div className="border-t-2 border-[rgba(18,38,63,0.10)] pt-6">
        <h2 className="mb-4 font-display text-2xl text-[var(--ink-strong)]">All Students</h2>
      </div>

      {/* Search + Export */}
      <div className="surface-section flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <label>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Class scope
            </span>
            <select
              value={currentClassId}
              onChange={(event) => setCurrentClassId(event.target.value)}
              className="field w-full px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-secondary)]"
            >
              <option value="">All assigned classes</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.code})
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Search students
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or student ID..."
              className="field w-full px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-secondary)]"
            />
          </label>
        </div>
        <a
          href={`/api/teacher/export${currentClassId ? `?classId=${encodeURIComponent(currentClassId)}` : ""}`}
          className="inline-flex items-center justify-center rounded-full border border-[rgba(18,38,63,0.1)] px-4 py-3 text-sm font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[rgba(16,37,62,0.04)]"
        >
          Export CSV
        </a>
      </div>

      {/* View & Filter Controls */}
      <div className="surface-section flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-full border border-[var(--border)] bg-white/70 p-1">
            <button
              onClick={() => setViewMode("table")}
              className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${
                viewMode === "table" ? "bg-[var(--ink-strong)] text-white" : "text-[var(--ink-muted)] hover:bg-[rgba(16,37,62,0.04)]"
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode("cards")}
              className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${
                viewMode === "cards" ? "bg-[var(--ink-strong)] text-white" : "text-[var(--ink-muted)] hover:bg-[rgba(16,37,62,0.04)]"
              }`}
            >
              Cards
            </button>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--ink-muted)]">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-[var(--accent-secondary)]"
            />
            Show inactive students
          </label>
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          {filtered.length} visible
        </p>
      </div>

      {/* Student Cards View */}
      {viewMode === "cards" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => {
            const links = studentActionLinks(s.id);

            return (
            <div
              key={s.id}
              className={`surface-section group p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg sm:p-5 ${!s.isActive ? "opacity-50" : ""}`}
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    {/* Activity dot */}
                    {(() => {
                      if (!s.isActive) return <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />;
                      const lastActive = s.lastActive ? new Date(s.lastActive) : null;
                      const daysSince = lastActive ? Math.floor((Date.now() - lastActive.getTime()) / 86400000) : Infinity;
                      if (daysSince <= 1) return <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />;
                      if (daysSince <= 7) return <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />;
                      return <span className="h-2.5 w-2.5 rounded-full bg-red-400" />;
                    })()}
                    <Link
                      href={links.record}
                      prefetch={false}
                      className="break-words font-display text-base leading-5 text-[var(--ink-strong)] transition-colors hover:text-[var(--accent-secondary)]"
                    >
                      {s.displayName}
                    </Link>
                  </div>
                  <p className="ml-4 mt-1 break-words text-xs text-[var(--ink-muted)]">{s.studentId}</p>
                </div>
                {!s.isActive && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">Inactive</span>
                )}
              </div>

              {/* Level & XP */}
              <div className="mb-3 flex flex-wrap items-center gap-2.5">
                <span className="rounded-full bg-[rgba(15,154,146,0.1)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-secondary)]">
                  Lvl {s.level}
                </span>
                <span className="text-xs text-[var(--ink-muted)]">{s.xp} XP</span>
                {s.streak > 0 && <span className="text-xs">🔥 {s.streak}</span>}
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  s.readinessScore >= 75
                    ? "bg-emerald-100 text-emerald-700"
                    : s.readinessScore >= 50
                      ? "bg-amber-100 text-amber-800"
                      : "bg-orange-100 text-orange-700"
                }`}>
                  {s.readinessScore}% Ready
                </span>
              </div>

              {/* Progress bars */}
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-[10px] text-[var(--ink-muted)] mb-0.5">
                    <span>Orientation</span>
                    <span>{s.orientationDone}/{s.orientationTotal}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${s.orientationTotal > 0 ? (s.orientationDone / s.orientationTotal) * 100 : 0}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-[var(--ink-muted)] mb-0.5">
                    <span>Certifications</span>
                    <span>{s.certDone}/{s.certTotal}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${s.certTotal > 0 ? (s.certDone / s.certTotal) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>

              {/* Bottom row */}
              <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-[var(--ink-muted)]">
                <span className="rounded-full bg-[rgba(16,37,62,0.04)] px-2.5 py-1">
                  {s.goalsCount} goals {s.hasBhag && "• BHAG ✓"}
                </span>
                {s.certPendingVerify > 0 && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">{s.certPendingVerify} pending</span>
                )}
                {s.openAlertCount > 0 && (
                  <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-700">{s.openAlertCount} alert{s.openAlertCount > 1 ? "s" : ""}</span>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-[rgba(18,38,63,0.08)] pt-3">
                <Link
                  href={links.record}
                  prefetch={false}
                  className="rounded-full border border-[rgba(18,38,63,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[rgba(16,37,62,0.04)]"
                >
                  Record
                </Link>
                <Link
                  href={links.orientation}
                  prefetch={false}
                  className="rounded-full border border-[rgba(15,154,146,0.2)] bg-[rgba(15,154,146,0.08)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-secondary)] transition-colors hover:bg-[rgba(15,154,146,0.14)]"
                >
                  Orientation
                </Link>
                <Link
                  href={links.forms}
                  prefetch={false}
                  className="rounded-full border border-[rgba(18,38,63,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[rgba(16,37,62,0.04)]"
                >
                  Forms
                </Link>
                <Link
                  href={links.goals}
                  prefetch={false}
                  className="rounded-full border border-[rgba(18,38,63,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[rgba(16,37,62,0.04)]"
                >
                  Goals
                </Link>
              </div>
            </div>
          )})}
        </div>
      ) : (

      /* Student Table */
      <div className="surface-section overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[66rem] w-full text-sm lg:min-w-[72rem]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th
                  className="cursor-pointer px-4 py-3 text-left font-medium text-gray-600 hover:text-gray-900"
                  onClick={() => handleSort("displayName")}
                >
                  Student {getSortIcon("displayName")}
                </th>
                <th
                  className="cursor-pointer px-3 py-3 text-center font-medium whitespace-nowrap text-gray-600 hover:text-gray-900"
                  onClick={() => handleSort("xp")}
                >
                  Level/XP {getSortIcon("xp")}
                </th>
                <th
                  className="cursor-pointer px-3 py-3 text-center font-medium whitespace-nowrap text-gray-600 hover:text-gray-900"
                  onClick={() => handleSort("orientationDone")}
                >
                  Orientation {getSortIcon("orientationDone")}
                </th>
                <th
                  className="cursor-pointer px-3 py-3 text-center font-medium whitespace-nowrap text-gray-600 hover:text-gray-900"
                  onClick={() => handleSort("certDone")}
                >
                  Certification {getSortIcon("certDone")}
                </th>
                <th
                  className="cursor-pointer px-3 py-3 text-center font-medium whitespace-nowrap text-gray-600 hover:text-gray-900"
                  onClick={() => handleSort("readinessScore")}
                >
                  Readiness {getSortIcon("readinessScore")}
                </th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap text-gray-600">Goals</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap text-gray-600">Portfolio</th>
                <th
                  className="cursor-pointer px-4 py-3 text-right font-medium whitespace-nowrap text-gray-600 hover:text-gray-900"
                  onClick={() => handleSort("lastActive")}
                >
                  Last Active {getSortIcon("lastActive")}
                </th>
                <th className="px-4 py-3 text-right font-medium whitespace-nowrap text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-400">
                    {search ? "No students match your search" : "No students enrolled yet"}
                  </td>
                </tr>
              ) : (
                filtered.map((s) => {
                  const links = studentActionLinks(s.id);

                  return (
                  <tr key={s.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors${!s.isActive ? " opacity-50" : ""}`}>
                    <td className="px-4 py-3">
                      <Link href={links.record} prefetch={false} className="block min-w-0 hover:text-[var(--accent-blue)]">
                        <div className="flex min-w-0 items-center gap-2">
                          {/* Activity indicator */}
                          {(() => {
                            if (!s.isActive) return <span className="h-2 w-2 rounded-full bg-gray-300" title="Inactive" />;
                            const lastActive = s.lastActive ? new Date(s.lastActive) : null;
                            const daysSince = lastActive ? Math.floor((Date.now() - lastActive.getTime()) / 86400000) : Infinity;
                            if (daysSince <= 1) return <span className="h-2 w-2 rounded-full bg-emerald-400" title="Active today" />;
                            if (daysSince <= 7) return <span className="h-2 w-2 rounded-full bg-amber-400" title={`Active ${daysSince}d ago`} />;
                            return <span className="h-2 w-2 rounded-full bg-red-400" title={`Inactive ${daysSince}d`} />;
                          })()}
                          <p className="break-words font-medium text-gray-900">{s.displayName}</p>
                        </div>
                        <p className="ml-4 text-xs break-words text-gray-400">{s.studentId}</p>
                        {s.openAlertCount > 0 && (
                          <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            {s.openAlertCount} alert{s.openAlertCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                        Lv {s.level}
                      </span>
                      <p className="text-xs text-gray-400 mt-0.5">{s.xp} XP</p>
                      {s.streak > 0 && (
                        <p className="text-xs text-orange-500">🔥 {s.streak}d</p>
                      )}
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className={`text-xs font-medium ${
                        s.orientationDone === s.orientationTotal && s.orientationTotal > 0
                          ? "text-green-600"
                          : "text-gray-600"
                      }`}>
                        {s.orientationDone}/{s.orientationTotal}
                      </span>
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className={`text-xs font-medium ${
                        s.certStatus === "completed" ? "text-green-600" : "text-gray-600"
                      }`}>
                        {s.certDone}/{s.certTotal}
                      </span>
                      {s.certPendingVerify > 0 && (
                        <p className="text-xs text-orange-500 font-medium">
                          {s.certPendingVerify} to verify
                        </p>
                      )}
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        s.readinessScore >= 75
                          ? "bg-emerald-100 text-emerald-700"
                          : s.readinessScore >= 50
                            ? "bg-amber-100 text-amber-800"
                            : "bg-orange-100 text-orange-700"
                      }`}>
                        {s.readinessScore}%
                      </span>
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className="text-xs text-gray-600">{s.goalsCount}</span>
                      {s.hasBhag && (
                        <p className="text-xs text-green-500">BHAG set</p>
                      )}
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className="text-xs text-gray-600">{s.portfolioItems}</span>
                      {s.hasResume && (
                        <p className="text-xs text-green-500">Resume ✓</p>
                      )}
                    </td>
                    <td className="text-right px-4 py-3">
                      <div>
                        <span className="text-xs text-gray-400">{relativeTime(s.lastActive)}</span>
                        {s.nextAppointmentAt && (
                          <p className="mt-1 text-xs text-teal-600">
                            Next: {formatAppointment(s.nextAppointmentAt)}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Link
                          href={links.record}
                          prefetch={false}
                          className="rounded-full border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-700 transition-colors hover:bg-gray-100"
                        >
                          Record
                        </Link>
                        <Link
                          href={links.orientation}
                          prefetch={false}
                          className="rounded-full border border-[rgba(15,154,146,0.2)] bg-[rgba(15,154,146,0.08)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-secondary)] transition-colors hover:bg-[rgba(15,154,146,0.14)]"
                        >
                          Orientation
                        </Link>
                        <Link
                          href={links.forms}
                          prefetch={false}
                          className="rounded-full border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-100"
                        >
                          Forms
                        </Link>
                        <Link
                          href={links.goals}
                          prefetch={false}
                          className="rounded-full border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-100"
                        >
                          Goals
                        </Link>
                      </div>
                    </td>
                  </tr>
                )})
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex flex-col gap-3 border-t border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              onClick={() => fetchStudents(page - 1)}
              disabled={page <= 1}
              className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-center text-sm text-gray-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => fetchStudents(page + 1)}
              disabled={page >= totalPages}
              className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
