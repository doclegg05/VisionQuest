"use client";

import Link from "next/link";
import type { StudentOverview } from "@/lib/teacher/dashboard";

interface StudentActionLinks {
  record: string;
  orientation: string;
  forms: string;
  goals: string;
}

export default function StudentCards({
  students,
  studentActionLinks,
}: {
  students: StudentOverview[];
  studentActionLinks: (studentId: string) => StudentActionLinks;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {students.map((student) => {
        const links = studentActionLinks(student.id);

        return (
          <div
            key={student.id}
            className={`surface-section group p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg sm:p-5 ${!student.isActive ? "opacity-50" : ""}`}
          >
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  {(() => {
                    if (!student.isActive) {
                      return <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />;
                    }
                    const lastActive = student.lastActive ? new Date(student.lastActive) : null;
                    const daysSince = lastActive
                      ? Math.floor((Date.now() - lastActive.getTime()) / 86400000)
                      : Infinity;
                    if (daysSince <= 1) {
                      return <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />;
                    }
                    if (daysSince <= 7) {
                      return <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />;
                    }
                    return <span className="h-2.5 w-2.5 rounded-full bg-red-400" />;
                  })()}
                  <Link
                    href={links.record}
                    prefetch={false}
                    className="break-words font-display text-base leading-5 text-[var(--ink-strong)] transition-colors hover:text-[var(--accent-secondary)]"
                  >
                    {student.displayName}
                  </Link>
                </div>
                <p className="ml-4 mt-1 break-words text-xs text-[var(--ink-muted)]">
                  {student.studentId}
                </p>
              </div>
              {!student.isActive && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                  Inactive
                </span>
              )}
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              <span className="rounded-full bg-[rgba(15,154,146,0.1)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-secondary)]">
                Lvl {student.level}
              </span>
              <span className="text-xs text-[var(--ink-muted)]">{student.xp} XP</span>
              {student.streak > 0 && <span className="text-xs">🔥 {student.streak}</span>}
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  student.readinessScore >= 75
                    ? "bg-emerald-100 text-emerald-700"
                    : student.readinessScore >= 50
                      ? "bg-amber-100 text-amber-800"
                      : "bg-orange-100 text-orange-700"
                }`}
              >
                {student.readinessScore}% Ready
              </span>
            </div>

            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] text-[var(--ink-muted)] mb-0.5">
                  <span>Orientation</span>
                  <span>
                    {student.orientationDone}/{student.orientationTotal}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-400"
                    style={{
                      width: `${student.orientationTotal > 0 ? (student.orientationDone / student.orientationTotal) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-[var(--ink-muted)] mb-0.5">
                  <span>Certifications</span>
                  <span>
                    {student.certDone}/{student.certTotal}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400"
                    style={{
                      width: `${student.certTotal > 0 ? (student.certDone / student.certTotal) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-[var(--ink-muted)]">
              <span className="rounded-full bg-[rgba(16,37,62,0.04)] px-2.5 py-1">
                {student.goalsCount} goals {student.hasBhag && "• BHAG ✓"}
              </span>
              {student.certPendingVerify > 0 && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">
                  {student.certPendingVerify} pending
                </span>
              )}
              {student.openAlertCount > 0 && (
                <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-600">
                  {student.openAlertCount} alert{student.openAlertCount > 1 ? "s" : ""}
                </span>
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
        );
      })}
    </div>
  );
}
