import Link from "next/link";
import ReadinessScore from "@/components/ui/ReadinessScore";
import { MoodSparkline } from "@/components/progression/MoodSparkline";
import type {
  StudentData,
  MoodEntryData,
  AlertData,
} from "./types";

interface OverviewTabProps {
  data: StudentData;
  moodEntries: MoodEntryData[];
  dateFormatter: Intl.DateTimeFormat;
  /** Password-reset UI state & callbacks */
  showResetPw: boolean;
  onToggleResetPw: () => void;
  newPassword: string;
  onNewPasswordChange: (value: string) => void;
  resetStatus: "idle" | "saving" | "done" | "error";
  onResetPassword: () => void;
  /** Deactivation */
  confirmDeactivate: boolean;
  onSetConfirmDeactivate: (value: boolean) => void;
  deactivating: boolean;
  onToggleStudentStatus: () => void;
  /** Archive */
  archiving: boolean;
  onArchive: () => void;
  archiveResult: { storageKey: string; fileCount: number } | null;
  archiveError: string | null;
}

export default function OverviewTab({
  data,
  moodEntries,
  dateFormatter,
  showResetPw,
  onToggleResetPw,
  newPassword,
  onNewPasswordChange,
  resetStatus,
  onResetPassword,
  confirmDeactivate,
  onSetConfirmDeactivate,
  deactivating,
  onToggleStudentStatus,
  archiving,
  onArchive,
  archiveResult,
  archiveError,
}: OverviewTabProps) {
  const {
    student,
    progression,
    readinessScore,
    alerts,
    appointments,
    tasks,
    applications,
    careerDiscovery,
  } = data;

  const openTasks = tasks.filter((task) => task.status !== "completed");
  const activeApplications = applications.filter((application) =>
    ["applied", "interviewing", "offer"].includes(application.status)
  );

  return (
    <div className="space-y-6">
      {/* Student Identity Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{student.displayName}</h2>
            <p className="text-sm text-gray-500">
              ID: {student.studentId} {student.email && `\u2022 ${student.email}`}
            </p>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <p className="text-xs text-gray-400">
                Enrolled {new Date(student.createdAt).toLocaleDateString()}
              </p>
              <Link
                href={`/teacher/students/${student.id}/spokes`}
                className="text-xs text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
              >
                Open SPOKES record
              </Link>
              <Link
                href={`/teacher/students/${student.id}/dashboard`}
                className="text-xs text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
              >
                Preview Dashboard
              </Link>
              <button
                onClick={onToggleResetPw}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Reset Password
              </button>
            </div>
            {showResetPw && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <label htmlFor="reset-password-input" className="text-xs text-gray-600">
                  New password:
                </label>
                <input
                  id="reset-password-input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => onNewPasswordChange(event.target.value)}
                  placeholder="New password (6+ chars)"
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={onResetPassword}
                  disabled={resetStatus === "saving" || newPassword.length < 6}
                  className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {resetStatus === "saving" ? "..." : resetStatus === "done" ? "Done!" : "Reset"}
                </button>
                <span role="alert" aria-live="polite" className="text-xs">
                  {resetStatus === "done" && <span className="text-green-600">Done!</span>}
                  {resetStatus === "error" && <span className="text-red-500">Failed</span>}
                </span>
              </div>
            )}

            {/* Account Status */}
            <div className="mt-4 flex items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                student.isActive
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-100 text-red-700"
              }`}>
                {student.isActive ? "Active" : "Inactive"}
              </span>
              <span className="text-xs text-[var(--ink-muted)]">
                Registered {new Date(student.createdAt).toLocaleDateString()}
              </span>
              {student.email && (
                <span className="text-xs text-[var(--ink-muted)]">{student.email}</span>
              )}
            </div>

            {/* Deactivate/Reactivate */}
            <div className="mt-3 flex flex-wrap gap-2">
              {!confirmDeactivate ? (
                <button
                  onClick={() => onSetConfirmDeactivate(true)}
                  className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                    student.isActive
                      ? "border border-red-200 text-red-600 hover:bg-red-50"
                      : "border border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                  }`}
                >
                  {student.isActive ? "Deactivate Account" : "Reactivate Account"}
                </button>
              ) : (
                <div className="w-full rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-800">
                    {student.isActive
                      ? "This will log the student out and prevent future login. Their data is preserved and an archive will be created."
                      : "This will allow the student to log in again."}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={onToggleStudentStatus}
                      disabled={deactivating}
                      className={`rounded-lg px-4 py-2 text-xs font-semibold text-white ${
                        student.isActive ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                    >
                      {deactivating ? "Processing..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => onSetConfirmDeactivate(false)}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Archive Records */}
              <button
                onClick={onArchive}
                disabled={archiving}
                className="rounded-lg border border-indigo-200 px-4 py-2 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-50"
              >
                {archiving ? "Archiving..." : "Archive Student Records"}
              </button>
            </div>

            {archiveResult && (
              <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-sm text-indigo-800">
                  Archive created with {archiveResult.fileCount} files.
                </p>
                <a
                  href={`/api/teacher/students/${student.id}/archive?key=${encodeURIComponent(archiveResult.storageKey)}`}
                  download
                  className="mt-1 inline-block text-xs font-semibold text-indigo-700 hover:text-indigo-900"
                >
                  Download ZIP archive
                </a>
              </div>
            )}
            {archiveError && (
              <p className="mt-2 text-xs text-red-500">{archiveError}</p>
            )}
          </div>

          <div className="flex gap-4 text-center flex-wrap items-start">
            <ReadinessScore score={readinessScore} size="sm" />
            <div>
              <p className="text-lg font-bold text-blue-600">Lv {progression.level}</p>
              <p className="text-xs text-gray-400">{progression.xp} XP</p>
            </div>
            {progression.streaks.daily.current > 0 && (
              <div>
                <p className="text-lg font-bold text-orange-500">{"\uD83D\uDD25"} {progression.streaks.daily.current}</p>
                <p className="text-xs text-gray-400">Day Streak</p>
              </div>
            )}
            <div>
              <p className="text-lg font-bold text-teal-600">{appointments.length}</p>
              <p className="text-xs text-gray-400">Appointments</p>
            </div>
            <div>
              <p className="text-lg font-bold text-violet-600">{openTasks.length}</p>
              <p className="text-xs text-gray-400">Open Tasks</p>
            </div>
            <div>
              <p className="text-lg font-bold text-sky-600">{activeApplications.length}</p>
              <p className="text-xs text-gray-400">Applications</p>
            </div>
            {alerts.length > 0 && (
              <div>
                <p className="text-lg font-bold text-rose-600">{alerts.length}</p>
                <p className="text-xs text-gray-400">Alerts</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-700">Open Advising Alerts</h3>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              {alerts.length} active
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {alerts.map((alert: AlertData) => (
              <div key={alert.id} className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-gray-900">{alert.title}</p>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                    {alert.severity}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-600">{alert.summary}</p>
                <p className="mt-2 text-xs text-gray-400">
                  Detected {dateFormatter.format(new Date(alert.detectedAt))}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Career Discovery Summary */}
      {careerDiscovery && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Career Discovery
            {careerDiscovery.status === "complete" && (
              <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Complete</span>
            )}
            {careerDiscovery.status === "in_progress" && (
              <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">In Progress</span>
            )}
          </h3>
          <div className="space-y-3">
            {careerDiscovery.sageSummary && (
              <p className="text-sm text-gray-700">{careerDiscovery.sageSummary}</p>
            )}
            {careerDiscovery.topClusters.length > 0 && (
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase">Top Pathways</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {careerDiscovery.topClusters.map((cluster) => (
                    <span key={cluster} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md">
                      {cluster.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Motivation Trend */}
      {moodEntries.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-700">
              Motivation Trend
            </h3>
            {(() => {
              const last3 = moodEntries.slice(-3);
              const isDeclining =
                last3.length === 3 &&
                last3[0].score > last3[1].score &&
                last3[1].score > last3[2].score;
              return isDeclining ? (
                <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-800">
                  Motivation declining
                </span>
              ) : null;
            })()}
          </div>
          <MoodSparkline entries={moodEntries} showDateLabels />
        </div>
      )}
    </div>
  );
}
