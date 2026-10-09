"use client";

import { useState } from "react";
import Link from "next/link";
import ProgramBadge from "@/components/ui/ProgramBadge";
import ReadinessScore from "@/components/ui/ReadinessScore";
import { MoodSparkline } from "@/components/progression/MoodSparkline";
import { WellbeingCrisisCard } from "@/components/teacher/WellbeingCrisisCard";
import { WorkAvailabilityPanel } from "./WorkAvailabilityPanel";
import { WELLBEING_ALERT_TYPE } from "@/lib/sage/wellbeing-card";
import {
  DiscoveryClusterPicker,
  needsPathwayCluster,
  submitPathwayCluster,
} from "./DiscoveryClusterPicker";
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
  /**
   * Phase 6 tab reorg: the Coach tab composes OverviewTab and hides the
   * admin controls (password reset, deactivate, archive). Those move to
   * the dedicated Admin tab. Keep prop optional so direct renders behave
   * as before.
   */
  hideAdminControls?: boolean;
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
  hideAdminControls = false,
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

  // Discovery manual override — local state only; the card flips to
  // "Complete" immediately on success without a full reload.
  const [confirmDiscoveryOverride, setConfirmDiscoveryOverride] = useState(false);
  const [overridingDiscovery, setOverridingDiscovery] = useState(false);
  const [discoveryOverridden, setDiscoveryOverridden] = useState(false);
  const [discoveryOverrideError, setDiscoveryOverrideError] = useState<string | null>(null);

  const discoveryStatus = discoveryOverridden
    ? "complete"
    : careerDiscovery?.status ?? "not_started";

  // Pathway picker — the exit from the awaiting_cluster state (discovery
  // complete, no cluster recorded). It also appears the moment the override
  // above succeeds, since that flips status to "complete" with no cluster.
  const [clusterChoice, setClusterChoice] = useState("");
  const [savingCluster, setSavingCluster] = useState(false);
  const [savedClusterId, setSavedClusterId] = useState<string | null>(null);
  const [clusterError, setClusterError] = useState<string | null>(null);

  const awaitingCluster = needsPathwayCluster({
    status: discoveryStatus,
    topClusters: careerDiscovery?.topClusters ?? [],
  });

  async function handleSavePathwayCluster() {
    setSavingCluster(true);
    setClusterError(null);
    const result = await submitPathwayCluster(student.id, clusterChoice);
    if (result.ok) {
      setSavedClusterId(clusterChoice);
    } else {
      setClusterError(result.error);
    }
    setSavingCluster(false);
  }

  async function handleDiscoveryOverride() {
    setOverridingDiscovery(true);
    setDiscoveryOverrideError(null);
    try {
      const res = await fetch(`/api/teacher/students/${student.id}/discovery`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "complete" }),
      });
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : "Could not mark discovery complete.";
        throw new Error(message);
      }
      setDiscoveryOverridden(true);
      setConfirmDiscoveryOverride(false);
    } catch (error: unknown) {
      setDiscoveryOverrideError(
        error instanceof Error ? error.message : "Could not mark discovery complete.",
      );
    } finally {
      setOverridingDiscovery(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Student Identity Card */}
      <div className="theme-card rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-[var(--ink-strong)]">{student.displayName}</h2>
              <ProgramBadge programType={student.programType} />
            </div>
            <p className="text-sm text-[var(--ink-muted)]">
              ID: {student.studentId} {student.email && `\u2022 ${student.email}`}
            </p>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <p className="text-xs text-[var(--ink-faint)]">
                Enrolled {new Date(student.createdAt).toLocaleDateString()}
              </p>
              <Link
                href={`/teacher/students/${student.id}/spokes`}
                className="inline-flex items-center text-xs text-[var(--accent-strong)] hover:text-[var(--ink-strong)] pointer-coarse:min-h-11"
              >
                Open SPOKES record
              </Link>
              <Link
                href={`/teacher/students/${student.id}/dashboard`}
                className="inline-flex items-center text-xs text-[var(--accent-strong)] hover:text-[var(--ink-strong)] pointer-coarse:min-h-11"
              >
                Preview Dashboard
              </Link>
              {!hideAdminControls && (
                <button
                  onClick={onToggleResetPw}
                  className="inline-flex items-center text-xs text-[var(--badge-info-text)] hover:text-[var(--ink-strong)] pointer-coarse:min-h-11"
                >
                  Reset Password
                </button>
              )}
            </div>
            {!hideAdminControls && showResetPw && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <label htmlFor="reset-password-input" className="text-xs text-[var(--ink-muted)]">
                  New password:
                </label>
                <input
                  id="reset-password-input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => onNewPasswordChange(event.target.value)}
                  placeholder="New password (6+ chars)"
                  className="text-sm theme-input rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                />
                <button
                  onClick={onResetPassword}
                  disabled={resetStatus === "saving" || newPassword.length < 6}
                  className="primary-button text-xs px-3 py-1.5 rounded-lg pointer-coarse:min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resetStatus === "saving" ? "..." : resetStatus === "done" ? "Done!" : "Reset"}
                </button>
                <span role="alert" aria-live="polite" className="text-xs">
                  {resetStatus === "done" && <span className="text-[var(--badge-success-text)]">Done!</span>}
                  {resetStatus === "error" && <span className="text-[var(--badge-error-text)]">Failed</span>}
                </span>
              </div>
            )}

            {/* Account Status — always visible across Coach + Admin tabs */}
            <div className="mt-4 flex items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                student.isActive
                  ? "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]"
                  : "bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]"
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

            {hideAdminControls ? null : (
            <>
            {/* Deactivate/Reactivate */}
            <div className="mt-3 flex flex-wrap gap-2">
              {!confirmDeactivate ? (
                <button
                  onClick={() => onSetConfirmDeactivate(true)}
                  className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold transition-colors pointer-coarse:min-h-11 ${
                    student.isActive
                      ? "border border-[var(--badge-error-bg)] text-[var(--badge-error-text)] hover:bg-[var(--badge-error-bg)]"
                      : "border border-[var(--badge-success-bg)] text-[var(--badge-success-text)] hover:bg-[var(--badge-success-bg)]"
                  }`}
                >
                  {student.isActive ? "Deactivate Account" : "Reactivate Account"}
                </button>
              ) : (
                <div className="w-full rounded-xl border border-[var(--badge-error-bg)] bg-[var(--badge-error-bg)] p-3">
                  <p className="text-sm text-[var(--badge-error-text)]">
                    {student.isActive
                      ? "This will log the student out and prevent future login. Their data is preserved and an archive will be created."
                      : "This will allow the student to log in again."}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={onToggleStudentStatus}
                      disabled={deactivating}
                      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold pointer-coarse:min-h-11 ${
                        student.isActive ? "bg-[var(--error)] text-[var(--on-error)] hover:brightness-95" : "primary-button"
                      }`}
                    >
                      {deactivating ? "Processing..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => onSetConfirmDeactivate(false)}
                      className="theme-card-subtle inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface-soft)] pointer-coarse:min-h-11"
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
                className="inline-flex items-center justify-center rounded-lg border border-[var(--badge-info-bg)] px-4 py-2 text-xs font-semibold text-[var(--badge-info-text)] transition-colors hover:bg-[var(--badge-info-bg)] disabled:opacity-50 pointer-coarse:min-h-11"
              >
                {archiving ? "Archiving..." : "Archive Student Records"}
              </button>
            </div>

            {archiveResult && (
              <div className="mt-2 rounded-xl border border-[var(--badge-info-bg)] bg-[var(--badge-info-bg)] p-3">
                <p className="text-sm text-[var(--badge-info-text)]">
                  Archive created with {archiveResult.fileCount} files.
                </p>
                <a
                  href={`/api/teacher/students/${student.id}/archive?key=${encodeURIComponent(archiveResult.storageKey)}`}
                  download
                  className="mt-1 inline-flex items-center text-xs font-semibold text-[var(--badge-info-text)] hover:text-[var(--ink-strong)] pointer-coarse:min-h-11"
                >
                  Download ZIP archive
                </a>
              </div>
            )}
            {archiveError && (
              <p className="mt-2 text-xs text-[var(--badge-error-text)]">{archiveError}</p>
            )}
            </>
            )}
          </div>

          <div className="flex gap-4 text-center flex-wrap items-start">
            <ReadinessScore score={readinessScore} size="sm" />
            <div>
              <p className="text-lg font-bold text-[var(--badge-info-text)]">Lv {progression.level}</p>
              <p className="text-xs text-[var(--ink-faint)]">{progression.xp} XP</p>
            </div>
            {(progression.streaks?.daily?.current ?? 0) > 0 && (
              <div>
                <p className="text-lg font-bold text-[var(--badge-success-text)]">{"\uD83D\uDD25"} {progression.streaks?.daily?.current ?? 0}</p>
                <p className="text-xs text-[var(--ink-faint)]">Day Streak</p>
              </div>
            )}
            <div>
              <p className="text-lg font-bold text-[var(--badge-info-text)]">{appointments.length}</p>
              <p className="text-xs text-[var(--ink-faint)]">Appointments</p>
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--badge-info-text)]">{openTasks.length}</p>
              <p className="text-xs text-[var(--ink-faint)]">Open Tasks</p>
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--badge-info-text)]">{activeApplications.length}</p>
              <p className="text-xs text-[var(--ink-faint)]">Applications</p>
            </div>
            {alerts.length > 0 && (
              <div>
                <p className="text-lg font-bold text-[var(--badge-error-text)]">{alerts.length}</p>
                <p className="text-xs text-[var(--ink-faint)]">Alerts</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="theme-card rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Open Advising Alerts</h3>
            <span className="rounded-full bg-[var(--urgency-high-bg)] px-3 py-1 text-xs font-semibold text-[var(--urgency-high-text)]">
              {alerts.length} active
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {alerts.map((alert: AlertData) => (
              <div key={alert.id} className="rounded-lg border border-[var(--border-strong)] bg-[var(--urgency-high-bg)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-[var(--ink-strong)]">{alert.title}</p>
                  <span className="rounded-full bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--urgency-high-text)]">
                    {alert.severity}
                  </span>
                </div>
                {alert.type === WELLBEING_ALERT_TYPE ? (
                  <WellbeingCrisisCard summary={alert.summary} className="mt-2" />
                ) : (
                  <p className="mt-2 text-sm text-[var(--ink-muted)]">{alert.summary}</p>
                )}
                <p className="mt-2 text-xs text-[var(--ink-faint)]">
                  Detected {dateFormatter.format(new Date(alert.detectedAt))}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Career Discovery Summary — always rendered so staff can override a
          stalled discovery even when the extractor never created a record. */}
      <div className="theme-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--ink-strong)] mb-3">
          Career Discovery
          {discoveryStatus === "complete" && (
            <span className="ml-2 text-xs bg-[var(--badge-success-bg)] text-[var(--badge-success-text)] px-2 py-0.5 rounded-full">Complete</span>
          )}
          {discoveryStatus === "in_progress" && (
            <span className="ml-2 text-xs bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)] px-2 py-0.5 rounded-full">In Progress</span>
          )}
          {discoveryStatus === "not_started" && (
            <span className="ml-2 text-xs bg-[var(--surface-muted)] text-[var(--ink-muted)] px-2 py-0.5 rounded-full">Not Started</span>
          )}
        </h3>
        <div className="space-y-3">
          {careerDiscovery?.sageSummary && (
            <p className="text-sm text-[var(--ink-strong)]">{careerDiscovery.sageSummary}</p>
          )}
          {careerDiscovery && careerDiscovery.topClusters.length > 0 && (
            <div>
              <span className="text-xs font-medium text-[var(--ink-muted)] uppercase">Top Pathways</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {careerDiscovery.topClusters.map((cluster) => (
                  <span key={cluster} className="text-xs bg-[var(--badge-info-bg)] text-[var(--badge-info-text)] px-2 py-1 rounded-md">
                    {cluster.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                ))}
              </div>
            </div>
          )}
          {discoveryOverridden && (
            <p className="text-xs text-[var(--badge-success-text)]">Discovery marked complete by staff.</p>
          )}
          {(awaitingCluster || savedClusterId) && (
            <DiscoveryClusterPicker
              value={clusterChoice}
              onChange={setClusterChoice}
              onConfirm={handleSavePathwayCluster}
              saving={savingCluster}
              error={clusterError}
              savedClusterId={savedClusterId}
            />
          )}
          {discoveryStatus !== "complete" && (
            <div className="pt-1">
              {!confirmDiscoveryOverride ? (
                <button
                  onClick={() => {
                    setDiscoveryOverrideError(null);
                    setConfirmDiscoveryOverride(true);
                  }}
                  className="inline-flex items-center justify-center rounded-lg border border-[var(--badge-success-bg)] px-4 py-2 text-xs font-semibold text-[var(--badge-success-text)] transition-colors hover:bg-[var(--badge-success-bg)] pointer-coarse:min-h-11"
                >
                  Mark discovery complete
                </button>
              ) : (
                <div className="rounded-xl border border-[var(--badge-success-bg)] bg-[var(--badge-success-bg)] p-3">
                  <p className="text-sm text-[var(--badge-success-text)]">
                    This unblocks the student&apos;s next step when Sage never marked
                    discovery complete automatically. The override is recorded in the
                    audit log.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={handleDiscoveryOverride}
                      disabled={overridingDiscovery}
                      className="primary-button rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50 pointer-coarse:min-h-11"
                    >
                      {overridingDiscovery ? "Saving..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => setConfirmDiscoveryOverride(false)}
                      className="theme-card-subtle inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface-soft)] pointer-coarse:min-h-11"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {discoveryOverrideError && (
                <p className="mt-2 text-xs text-[var(--badge-error-text)]">{discoveryOverrideError}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Motivation Trend */}
      {moodEntries.length > 0 && (
        <div className="theme-card rounded-xl p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
              Motivation Trend
            </h3>
            {(() => {
              const last3 = moodEntries.slice(-3);
              const isDeclining =
                last3.length === 3 &&
                last3[0].score > last3[1].score &&
                last3[1].score > last3[2].score;
              return isDeclining ? (
                <span className="rounded-full bg-[var(--badge-error-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--badge-error-text)]">
                  Motivation declining
                </span>
              ) : null;
            })()}
          </div>
          <MoodSparkline entries={moodEntries} showDateLabels />
        </div>
      )}

      {/* Match & Connect Phase 2: read-only view of the student's own work
          constraints, so an instructor knows which jobs are reachable before
          proposing one. The student edits it, never staff. */}
      <div className="mt-6">
        <WorkAvailabilityPanel workProfile={data.workProfile} />
      </div>
    </div>
  );
}
