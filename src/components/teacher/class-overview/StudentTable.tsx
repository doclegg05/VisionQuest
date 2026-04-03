"use client";

import Link from "next/link";
import type { StudentOverview } from "@/lib/teacher/dashboard";

interface StudentActionLinks {
  record: string;
  orientation: string;
  forms: string;
  goals: string;
}

export default function StudentTable({
  students,
  totalPages,
  page,
  onPreviousPage,
  onNextPage,
  getSortIcon,
  handleSort,
  relativeTime,
  formatAppointment,
  studentActionLinks,
}: {
  students: StudentOverview[];
  totalPages: number;
  page: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  getSortIcon: (
    col:
      | "displayName"
      | "lastActive"
      | "xp"
      | "certDone"
      | "orientationDone"
      | "readinessScore",
  ) => React.ReactNode;
  handleSort: (
    key:
      | "displayName"
      | "lastActive"
      | "xp"
      | "certDone"
      | "orientationDone"
      | "readinessScore",
  ) => void;
  relativeTime: (dateStr: string) => string;
  formatAppointment: (dateStr: string) => string;
  studentActionLinks: (studentId: string) => StudentActionLinks;
}) {
  return (
    <div className="surface-section overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-[66rem] w-full text-sm lg:min-w-[72rem]">
          <thead>
            <tr className="bg-[var(--surface-soft)] border-b border-[var(--border)]">
              <th
                className="cursor-pointer px-4 py-3 text-left font-medium text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                onClick={() => handleSort("displayName")}
              >
                Student {getSortIcon("displayName")}
              </th>
              <th
                className="cursor-pointer px-3 py-3 text-center font-medium whitespace-nowrap text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                onClick={() => handleSort("xp")}
              >
                Level/XP {getSortIcon("xp")}
              </th>
              <th
                className="cursor-pointer px-3 py-3 text-center font-medium whitespace-nowrap text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                onClick={() => handleSort("orientationDone")}
              >
                Orientation {getSortIcon("orientationDone")}
              </th>
              <th
                className="cursor-pointer px-3 py-3 text-center font-medium whitespace-nowrap text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                onClick={() => handleSort("certDone")}
              >
                Certification {getSortIcon("certDone")}
              </th>
              <th
                className="cursor-pointer px-3 py-3 text-center font-medium whitespace-nowrap text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                onClick={() => handleSort("readinessScore")}
              >
                Readiness {getSortIcon("readinessScore")}
              </th>
              <th className="px-3 py-3 text-center font-medium whitespace-nowrap text-[var(--ink-muted)]">
                Requirements
              </th>
              <th className="px-3 py-3 text-center font-medium whitespace-nowrap text-[var(--ink-muted)]">
                Goals
              </th>
              <th className="px-3 py-3 text-center font-medium whitespace-nowrap text-[var(--ink-muted)]">
                Portfolio
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-right font-medium whitespace-nowrap text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                onClick={() => handleSort("lastActive")}
              >
                Last Active {getSortIcon("lastActive")}
              </th>
              <th className="px-4 py-3 text-right font-medium whitespace-nowrap text-[var(--ink-muted)]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-[var(--ink-faint)]">
                  No students enrolled yet
                </td>
              </tr>
            ) : (
              students.map((student) => {
                const links = studentActionLinks(student.id);

                return (
                  <tr
                    key={student.id}
                    className={`border-b border-[var(--border)] hover:bg-[var(--surface-soft)] transition-colors${!student.isActive ? " opacity-50" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <Link href={links.record} prefetch={false} className="block min-w-0 hover:text-blue-600">
                        <div className="flex min-w-0 items-center gap-2">
                          {(() => {
                            if (!student.isActive) {
                              return <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" title="Inactive" />;
                            }
                            const lastActive = student.lastActive ? new Date(student.lastActive) : null;
                            const daysSince = lastActive
                              ? Math.floor((Date.now() - lastActive.getTime()) / 86400000)
                              : Infinity;
                            if (daysSince <= 1) {
                              return <span className="h-2 w-2 rounded-full bg-emerald-400" title="Active today" />;
                            }
                            if (daysSince <= 7) {
                              return <span className="h-2 w-2 rounded-full bg-amber-400" title={`Active ${daysSince}d ago`} />;
                            }
                            return <span className="h-2 w-2 rounded-full bg-red-400" title={`Inactive ${daysSince}d`} />;
                          })()}
                          <p className="break-words font-medium text-[var(--ink-strong)]">{student.displayName}</p>
                        </div>
                        <p className="ml-4 text-xs break-words text-[var(--ink-faint)]">{student.studentId}</p>
                        {student.openAlertCount > 0 && (
                          <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            {student.openAlertCount} alert{student.openAlertCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                        Lv {student.level}
                      </span>
                      <p className="text-xs text-[var(--ink-faint)] mt-0.5">{student.xp} XP</p>
                      {student.streak > 0 && (
                        <p className="text-xs text-orange-500">🔥 {student.streak}d</p>
                      )}
                    </td>
                    <td className="text-center px-3 py-3">
                      <span
                        className={`text-xs font-medium ${
                          student.orientationDone === student.orientationTotal &&
                          student.orientationTotal > 0
                            ? "text-green-600"
                            : "text-[var(--ink-muted)]"
                        }`}
                      >
                        {student.orientationDone}/{student.orientationTotal}
                      </span>
                    </td>
                    <td className="text-center px-3 py-3">
                      <span
                        className={`text-xs font-medium ${
                          student.certStatus === "completed" ? "text-green-600" : "text-[var(--ink-muted)]"
                        }`}
                      >
                        {student.certDone}/{student.certTotal}
                      </span>
                      {student.certPendingVerify > 0 && (
                        <p className="text-xs text-orange-500 font-medium">
                          {student.certPendingVerify} to verify
                        </p>
                      )}
                    </td>
                    <td className="text-center px-3 py-3">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          student.readinessScore >= 75
                            ? "bg-emerald-100 text-emerald-700"
                            : student.readinessScore >= 50
                              ? "bg-amber-100 text-amber-800"
                              : "bg-orange-100 text-orange-700"
                        }`}
                      >
                        {student.readinessScore}%
                      </span>
                    </td>
                    <td className="text-center px-3 py-3">
                      {student.requirementsTotal > 0 ? (
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            student.requirementsMet >= student.requirementsTotal
                              ? "bg-emerald-100 text-emerald-700"
                              : student.requirementsMet > 0
                                ? "bg-amber-100 text-amber-800"
                                : "bg-red-100 text-red-700"
                          }`}
                        >
                          {student.requirementsMet}/{student.requirementsTotal}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className="text-xs text-[var(--ink-muted)]">{student.goalsCount}</span>
                      {student.hasBhag && <p className="text-xs text-green-500">BHAG set</p>}
                    </td>
                    <td className="text-center px-3 py-3">
                      <span className="text-xs text-[var(--ink-muted)]">{student.portfolioItems}</span>
                      {student.hasResume && <p className="text-xs text-green-500">Resume ✓</p>}
                    </td>
                    <td className="text-right px-4 py-3">
                      <div>
                        <span className="text-xs text-[var(--ink-faint)]">
                          {relativeTime(student.lastActive)}
                        </span>
                        {student.nextAppointmentAt && (
                          <p className="mt-1 text-xs text-teal-600">
                            Next: {formatAppointment(student.nextAppointmentAt)}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Link
                          href={links.record}
                          prefetch={false}
                          className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-interactive)]"
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
                          className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-interactive)]"
                        >
                          Forms
                        </Link>
                        <Link
                          href={links.goals}
                          prefetch={false}
                          className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-interactive)]"
                        >
                          Goals
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={onPreviousPage}
            disabled={page <= 1}
            className="rounded-lg bg-[var(--surface-interactive)] px-3 py-1.5 text-sm text-[var(--ink-muted)] hover:bg-[var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-center text-sm text-[var(--ink-muted)]">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={onNextPage}
            disabled={page >= totalPages}
            className="rounded-lg bg-[var(--surface-interactive)] px-3 py-1.5 text-sm text-[var(--ink-muted)] hover:bg-[var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
