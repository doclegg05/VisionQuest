"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SummaryCards from "./class-overview/SummaryCards";
import StudentCards from "./class-overview/StudentCards";
import StudentTable from "./class-overview/StudentTable";
import { UpcomingAppointments } from "./class-overview/UpcomingAppointments";
import { apiFetch } from "@/lib/api";
import type {
  ManagedClassOption,
  StudentOverview,
  TeacherDashboardPageData,
  UpcomingAppointment,
} from "@/lib/teacher/dashboard";

type SortKey = "displayName" | "lastActive" | "xp" | "certDone" | "orientationDone" | "readinessScore";

export default function ClassOverview({
  initialData,
}: {
  initialData?: TeacherDashboardPageData;
}) {
  const [classes, setClasses] = useState<ManagedClassOption[]>(initialData?.classes ?? []);
  const [currentClassId, setCurrentClassId] = useState(initialData?.currentClassId ?? "");
  const [students, setStudents] = useState<StudentOverview[]>(initialData?.students ?? []);
  const [upcomingAppointments, setUpcomingAppointments] = useState<UpcomingAppointment[]>(
    initialData?.upcomingAppointments ?? [],
  );
  const [loading, setLoading] = useState(initialData === undefined);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("displayName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialData?.totalPages ?? 1);
  const [showInactive, setShowInactive] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const skipInitialFetchRef = useRef(initialData !== undefined);

  const applyStudentPage = useCallback((data: {
    classes?: ManagedClassOption[];
    currentClassId?: string | null;
    students?: StudentOverview[];
    upcomingAppointments?: UpcomingAppointment[];
    totalPages?: number;
    page?: number;
  }) => {
    setClasses(data.classes || []);
    setCurrentClassId(data.currentClassId || "");
    setStudents(data.students || []);
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
    return <span className="ml-1 text-info">{sortDir === "asc" ? "↑" : "↓"}</span>;
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

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading class data...</p>;

  if (error) return (
    <div className="surface-section px-6 py-10 text-center">
      <p className="mb-4 text-sm text-[var(--badge-error-text)]">{error}</p>
      <button onClick={() => fetchStudents()} className="primary-button px-4 py-2 text-sm pointer-coarse:min-h-11">
        Try Again
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <SummaryCards
        totalStudents={totalStudents}
        pendingVerifications={pendingVerifications}
        avgXp={avgXp}
      />

      <UpcomingAppointments appointments={upcomingAppointments} formatAppointment={formatAppointment} />

      {/* ── All Students ────────────────────────────────────────────────── */}
      <div className="border-t-2 border-[var(--border)] pt-6">
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
          className="inline-flex items-center justify-center rounded-full border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
        >
          Export CSV
        </a>
      </div>

      {/* View & Filter Controls */}
      <div className="surface-section flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-full border border-[var(--border)] bg-[var(--surface-raised)]/70 p-1">
            <button
              onClick={() => setViewMode("table")}
              className={`inline-flex items-center pointer-coarse:min-h-11 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${
                viewMode === "table" ? "bg-[var(--accent-strong)] text-[var(--on-accent)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode("cards")}
              className={`inline-flex items-center pointer-coarse:min-h-11 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${
                viewMode === "cards" ? "bg-[var(--accent-strong)] text-[var(--on-accent)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
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
              className="h-4 w-4 rounded border-[var(--border-strong)] text-info"
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
