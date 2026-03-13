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

type SortKey = "displayName" | "lastActive" | "xp" | "certDone" | "orientationDone";

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
      const response = await apiFetch(`/api/teacher/dashboard?page=${p}&limit=50`);
      const data = await response.json();
      applyStudentPage(data);
    } catch {
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [applyStudentPage]);

  useEffect(() => {
    async function loadInitialStudents() {
      try {
        const response = await apiFetch("/api/teacher/dashboard?page=1&limit=50");
        const data = await response.json();
        applyStudentPage(data);
      } catch {
        setError("Failed to load. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    void loadInitialStudents();
  }, [applyStudentPage]);

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

  if (loading) return <p className="text-sm text-gray-400">Loading class data...</p>;

  if (error) return (
    <div className="text-center py-12">
      <p className="text-red-600 mb-4">{error}</p>
      <button onClick={() => fetchStudents()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
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
            <p className="rounded-[1rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--muted)]">
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
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink-strong)]">{alert.title}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                        {alert.student.displayName} • {alert.student.studentId}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                      {alert.severity}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{alert.summary}</p>
                  <p className="mt-2 text-xs text-[var(--muted)]">
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
            <p className="rounded-[1rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--muted)]">
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
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink-strong)]">{appointment.title}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                        {appointment.student.displayName} • {appointment.student.studentId}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-secondary)]">
                      {appointment.locationLabel || appointment.locationType.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {formatAppointment(appointment.startsAt)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalStudents}</p>
          <p className="text-xs text-gray-500">Students</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-orange-600">{pendingVerifications}</p>
          <p className="text-xs text-gray-500">Pending Verifications</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-rose-600">{studentsNeedingAttention}</p>
          <p className="text-xs text-gray-500">Need Attention</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{avgXp}</p>
          <p className="text-xs text-gray-500">Avg XP</p>
        </div>
      </div>

      {/* Search + Export */}
      <div className="flex gap-3 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students..."
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <a
          href="/api/teacher/export"
          className="text-sm bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200 text-gray-600 whitespace-nowrap"
        >
          Export CSV
        </a>
      </div>

      {/* Student Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th
                  className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort("displayName")}
                >
                  Student {getSortIcon("displayName")}
                </th>
                <th
                  className="text-center px-3 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort("xp")}
                >
                  Level/XP {getSortIcon("xp")}
                </th>
                <th
                  className="text-center px-3 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort("orientationDone")}
                >
                  Orientation {getSortIcon("orientationDone")}
                </th>
                <th
                  className="text-center px-3 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort("certDone")}
                >
                  Certification {getSortIcon("certDone")}
                </th>
                <th className="text-center px-3 py-3 font-medium text-gray-600">Goals</th>
                <th className="text-center px-3 py-3 font-medium text-gray-600">Portfolio</th>
                <th
                  className="text-right px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort("lastActive")}
                >
                  Last Active {getSortIcon("lastActive")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    {search ? "No students match your search" : "No students enrolled yet"}
                  </td>
                </tr>
              ) : (
                filtered.map((s) => (
                  <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/teacher/students/${s.id}`} className="hover:text-blue-600">
                        <p className="font-medium text-gray-900">{s.displayName}</p>
                        <p className="text-xs text-gray-400">{s.studentId}</p>
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <button
              onClick={() => fetchStudents(page - 1)}
              disabled={page <= 1}
              className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => fetchStudents(page + 1)}
              disabled={page >= totalPages}
              className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
