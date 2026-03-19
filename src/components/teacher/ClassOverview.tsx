"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

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

interface DashboardAlert {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
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

type SortKey = "displayName" | "lastActive" | "xp" | "certDone" | "orientationDone" | "readinessScore";

export default function ClassOverview() {
  const [students, setStudents] = useState<StudentOverview[]>([]);
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
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

  const applyStudentPage = useCallback((data: {
    students?: StudentOverview[];
    alerts?: DashboardAlert[];
    upcomingAppointments?: UpcomingAppointment[];
    totalPages?: number;
    page?: number;
  }) => {
    setStudents(data.students || []);
    setAlerts(data.alerts || []);
    setUpcomingAppointments(data.upcomingAppointments || []);
    setTotalPages(data.totalPages || 1);
    setPage(data.page || 1);
    setError(null);
  }, []);

  const fetchStudents = useCallback(async (p: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/teacher/dashboard?page=${p}&limit=50${showInactive ? "&showInactive=true" : ""}`;
      const response = await apiFetch(url);
      const data = await response.json();
      applyStudentPage(data);
    } catch {
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [applyStudentPage, showInactive]);

  useEffect(() => {
    async function loadStudents() {
      try {
        const url = `/api/teacher/dashboard?page=1&limit=50${showInactive ? "&showInactive=true" : ""}`;
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
  }, [applyStudentPage, showInactive]);

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
    return <span className="ml-1 text-blue-600">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  function formatAppointment(dateStr: string) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(dateStr));
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
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="surface-section p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
                Needs attention
              </p>
              <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Open student alerts</h2>
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
                <Link
                  key={alert.id}
                  href={`/teacher/students/${alert.student.id}`}
                  className="block rounded-[1rem] border border-amber-200 bg-amber-50/80 p-4 transition-colors hover:border-amber-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold text-[var(--ink-strong)]">{alert.title}</p>
                      <p className="mt-1 break-all text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                        {alert.student.displayName} • {alert.student.studentId}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                      {alert.severity}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{alert.summary}</p>
                  <p className="mt-2 text-xs text-[var(--ink-muted)]">
                    Detected {relativeTime(alert.detectedAt)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="surface-section p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-secondary)]">
                This week
              </p>
              <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Upcoming appointments</h2>
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
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold text-[var(--ink-strong)]">{appointment.title}</p>
                      <p className="mt-1 break-all text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                        {appointment.student.displayName} • {appointment.student.studentId}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-secondary)]">
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
          <p className="mt-3 text-3xl font-bold text-blue-600">{avgXp}</p>
        </div>
      </div>

      {/* Search + Export */}
      <div className="surface-section flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
        <label className="min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            Search students
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or student ID..."
            className="field px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-secondary)]"
          />
        </label>
        <a
          href="/api/teacher/export"
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
          {filtered.map((s) => (
            <Link
              key={s.id}
              href={`/teacher/students/${s.id}`}
              prefetch={false}
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
                    <p className="break-words font-display text-base leading-5 text-[var(--ink-strong)]">{s.displayName}</p>
                  </div>
                  <p className="ml-4 mt-1 break-all text-xs text-[var(--ink-muted)]">{s.studentId}</p>
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
                      ? "bg-amber-100 text-amber-700"
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
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-700">{s.certPendingVerify} pending</span>
                )}
                {s.openAlertCount > 0 && (
                  <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-600">{s.openAlertCount} alert{s.openAlertCount > 1 ? "s" : ""}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (

      /* Student Table */
      <div className="surface-section overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[52rem] w-full text-sm">
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
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-400">
                    {search ? "No students match your search" : "No students enrolled yet"}
                  </td>
                </tr>
              ) : (
                filtered.map((s) => (
                  <tr key={s.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors${!s.isActive ? " opacity-50" : ""}`}>
                    <td className="px-4 py-3">
                      <Link href={`/teacher/students/${s.id}`} className="block min-w-0 hover:text-blue-600">
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
                        <p className="ml-4 text-xs break-all text-gray-400">{s.studentId}</p>
                        {s.openAlertCount > 0 && (
                          <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
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
                            ? "bg-amber-100 text-amber-700"
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
                  </tr>
                ))
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
