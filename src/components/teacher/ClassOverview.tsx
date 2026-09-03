"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DashboardActionPanel, { type DashboardActionIntent } from "./DashboardActionPanel";
import InterventionQueue from "./InterventionQueue";
import DetailedQueues from "./class-overview/DetailedQueues";
import SummaryCards from "./class-overview/SummaryCards";
import StudentCards from "./class-overview/StudentCards";
import StudentTable from "./class-overview/StudentTable";
import { apiFetch } from "@/lib/api";
import { FileArchive } from "@phosphor-icons/react";
import { type TeacherDashboardPageData } from "@/lib/teacher/dashboard";
import {
  teacherDashboardAlertQuickAction,
  teacherDashboardReviewQuickAction,
} from "@/lib/intervention-notifications";
import type {
  DashboardAlert,
  InactivityQueueItem,
  InactivitySummary,
  ManagedClassOption,
  ReviewQueueItem,
  StudentOverview,
  UpcomingAppointment,
} from "@/lib/teacher/dashboard";

type SortKey = "displayName" | "lastActive" | "xp" | "certDone" | "orientationDone" | "readinessScore";
type IntakeFilter = "all" | "certified" | "needs_review" | "missing";

const EMPTY_INACTIVITY_SUMMARY: InactivitySummary = {
  followUp14: 0,
  inactive30: 0,
  reengage60: 0,
  archiveReview90: 0,
};

export default function ClassOverview({
  initialData,
}: {
  initialData?: TeacherDashboardPageData;
}) {
  const [classes, setClasses] = useState<ManagedClassOption[]>(initialData?.classes ?? []);
  const [currentClassId, setCurrentClassId] = useState(initialData?.currentClassId ?? "");
  const [students, setStudents] = useState<StudentOverview[]>(initialData?.students ?? []);
  const [alerts, setAlerts] = useState<DashboardAlert[]>(initialData?.alerts ?? []);
  const [inactivityQueue, setInactivityQueue] = useState<InactivityQueueItem[]>(
    initialData?.inactivityQueue ?? [],
  );
  const [inactivitySummary, setInactivitySummary] = useState<InactivitySummary>(initialData?.inactivitySummary ?? {
    followUp14: 0,
    inactive30: 0,
    reengage60: 0,
    archiveReview90: 0,
  });
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>(initialData?.reviewQueue ?? []);
  const [upcomingAppointments, setUpcomingAppointments] = useState<UpcomingAppointment[]>(
    initialData?.upcomingAppointments ?? [],
  );
  const [loading, setLoading] = useState(initialData === undefined);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("displayName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [intakeFilter, setIntakeFilter] = useState<IntakeFilter>("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialData?.totalPages ?? 1);
  const [showInactive, setShowInactive] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [actionIntent, setActionIntent] = useState<DashboardActionIntent | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const skipInitialFetchRef = useRef(initialData !== undefined);

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
    setInactivitySummary(data.inactivitySummary || EMPTY_INACTIVITY_SUMMARY);
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
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      return;
    }

    void fetchStudents(1);
  }, [fetchStudents]);

  function handleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  }

  const filtered = students
    .filter((s) => {
      const matchesSearch =
        s.displayName.toLowerCase().includes(search.toLowerCase()) ||
        s.studentId.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      if (intakeFilter === "certified") return s.intakeStatus === "certified";
      if (intakeFilter === "needs_review") return s.intakeStatus === "needs_review";
      if (intakeFilter === "missing") return s.intakeStatus === "missing";
      return true;
    })
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

  // Summary stats & compliance counts
  const totalStudents = students.length;
  const certifiedCount = students.filter((s) => s.intakeStatus === "certified").length;
  const needsReviewCount = students.filter((s) => s.intakeStatus === "needs_review").length;
  const missingCount = students.filter((s) => s.intakeStatus === "missing").length;
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
    if (sortBy !== col) return <span className="ml-1 text-[var(--ink-faint)]">↕</span>;
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
      alertId: alert.id,
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
      alertId: item.id,
      goalId: item.sourceType === "goal" ? item.sourceId : null,
      linkId: item.sourceType === "goal_resource_link" ? item.sourceId : null,
    };
  }

  const snoozeAlert = useCallback(async (alertId: string) => {
    const res = await fetch(`/api/teacher/alerts/${alertId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "snooze", hours: 24 }),
    });
    if (!res.ok) return;
    setAlerts((prev) => prev.filter((alert) => alert.id !== alertId));
  }, []);

  const dismissAlert = useCallback(async (alertId: string) => {
    const res = await fetch(`/api/teacher/alerts/${alertId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    });
    if (!res.ok) return;
    setAlerts((prev) => prev.filter((alert) => alert.id !== alertId));
  }, []);

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
          alertId: intent.alertId,
        })}
      />

      <SummaryCards
        totalStudents={totalStudents}
        pendingVerifications={pendingVerifications}
        studentsNeedingAttention={studentsNeedingAttention}
        avgXp={avgXp}
      />

      <DetailedQueues
        detailsOpen={detailsOpen}
        alerts={alerts}
        reviewQueue={reviewQueue}
        upcomingAppointments={upcomingAppointments}
        inactivityQueue={inactivityQueue}
        inactivitySummary={inactivitySummary}
        currentClassId={currentClassId}
        onToggle={() => setDetailsOpen((prev) => !prev)}
        onSetActionIntent={setActionIntent}
        onSnoozeAlert={snoozeAlert}
        onDismissAlert={dismissAlert}
        relativeTime={relativeTime}
        formatAppointment={formatAppointment}
        buildAlertQuickIntent={buildAlertQuickIntent}
        buildReviewQuickIntent={buildReviewQuickIntent}
      />

      {/* ── All Students ────────────────────────────────────────────────── */}
      <div className="border-t-2 border-[var(--border)] pt-6">
        <h2 className="mb-4 font-display text-2xl text-[var(--ink-strong)]">All Students</h2>
      </div>

      {/* Search + Export */}
      <div className="surface-section flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:justify-between rounded-2xl border border-[var(--border)] shadow-sm">
        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <label>
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[var(--ink-strong)]">
              Class scope
            </span>
            <select
              value={currentClassId}
              onChange={(event) => setCurrentClassId(event.target.value)}
              className="field w-full rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-4 py-2.5 text-sm font-semibold text-[var(--ink-strong)] focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
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
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[var(--ink-strong)]">
              Search students
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by student name or ID..."
              className="field w-full rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-4 py-2.5 text-sm font-semibold text-[var(--ink-strong)] placeholder:text-[var(--ink-faint)] focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/teacher/classes/export-packets${currentClassId ? `?classId=${encodeURIComponent(currentClassId)}` : ""}`}
            className="inline-flex items-center gap-1.5 justify-center rounded-xl border-2 border-emerald-600 bg-emerald-600 hover:bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all active:scale-95 cursor-pointer"
            title="Download all stamped intake packets for this cohort as a ZIP"
          >
            <FileArchive size={18} weight="bold" />
            Download Cohort Packets (.zip)
          </a>
          <a
            href={`/api/teacher/export${currentClassId ? `?classId=${encodeURIComponent(currentClassId)}` : ""}`}
            className="inline-flex items-center justify-center rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 py-2.5 text-sm font-bold text-[var(--ink-strong)] shadow-sm transition-all hover:border-sky-500 hover:bg-[var(--surface-base)] active:scale-95"
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* View & Filter Controls */}
      <div className="surface-section flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-[var(--border)] shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-1">
            <button
              onClick={() => setViewMode("table")}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
                viewMode === "table"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-[var(--ink-strong)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode("cards")}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
                viewMode === "cards"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-[var(--ink-strong)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              Cards
            </button>
          </div>

          {/* Intake Compliance Filter Chips */}
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-base)] p-1">
            <button
              type="button"
              onClick={() => setIntakeFilter("all")}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                intakeFilter === "all"
                  ? "bg-slate-800 text-white shadow-xs"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
              }`}
            >
              All ({students.length})
            </button>
            <button
              type="button"
              onClick={() => setIntakeFilter("certified")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                intakeFilter === "certified"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
              }`}
            >
              ✓ Certified ({certifiedCount})
            </button>
            <button
              type="button"
              onClick={() => setIntakeFilter("needs_review")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                intakeFilter === "needs_review"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
              }`}
            >
              ✍ Needs Sign-off ({needsReviewCount})
            </button>
            <button
              type="button"
              onClick={() => setIntakeFilter("missing")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                intakeFilter === "missing"
                  ? "bg-rose-600 text-white shadow-xs"
                  : "text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              }`}
            >
              ⚠ Missing ({missingCount})
            </button>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--ink-strong)]">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-2 border-[var(--border-strong)] text-sky-600 focus:ring-sky-500"
            />
            Show inactive students
          </label>
        </div>

        <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-strong)]">
          {filtered.length} visible
        </p>
      </div>

      {/* Student Cards View */}
      {viewMode === "cards" ? (
        <StudentCards
          students={filtered}
          studentActionLinks={studentActionLinks}
        />
      ) : (
        <StudentTable
          students={filtered}
          totalPages={totalPages}
          page={page}
          onPreviousPage={() => fetchStudents(page - 1)}
          onNextPage={() => fetchStudents(page + 1)}
          getSortIcon={getSortIcon}
          handleSort={handleSort}
          relativeTime={relativeTime}
          formatAppointment={formatAppointment}
          studentActionLinks={studentActionLinks}
        />
      )}
    </div>
  );
}
