"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import SageInsightList from "@/components/sage/SageInsightList";
import type {
  MoodEntryData,
  StudentData,
} from "./student-detail/types";
import StudentDetailTabs from "./student-detail/StudentDetailTabs";
import OverviewTab from "./student-detail/OverviewTab";
import GoalsPlanTab, { goalButtonFor, type GoalButton } from "./student-detail/GoalsPlanTab";
import ProgressTab from "./student-detail/ProgressTab";
import OperationsTab from "./student-detail/OperationsTab";
import { toIsoDueAt } from "@/lib/dashboard/due-date";
import {
  buildFormReviewBody,
  reviewResultMessage,
  type FormReviewExtras,
} from "./student-detail/form-review";
import { useConfirm } from "@/components/ui/useConfirm";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import {
  nextNotice,
  orientationOutcome,
  releaseFlag,
  runStudentAction,
  sendStudentAction,
  type Notice,
  type StudentActionPage,
  type StudentActionResult,
} from "@/lib/teacher/student-action";
import { ActionNotice, ShownTab, isTabChange } from "./student-detail/ActionNotice";

type AppointmentStatusValue = "scheduled" | "completed" | "missed" | "cancelled";

/** Where a password reset stands. A failure goes to the pinned message. */
type ResetState = { kind: "idle" } | { kind: "saving" } | { kind: "done" };

type GoalAction = { status?: string; content?: string; confirm?: boolean; reviewed?: boolean; pathwayId?: string | null };

interface ArchiveResult {
  storageKey: string;
  fileCount: number;
}

/**
 * The archive was made on the server, but the answer had no link to it. A
 * reload does not bring the link back: the page keeps it only from the answer
 * to this request. Archiving again does, and writes over the same day's
 * archive instead of adding a second one.
 */
export const ARCHIVE_LINK_MISSING =
  "The archive was made, but we could not show its download link. Press Archive Student Records again to get the link.";

const EMPTY_APPOINTMENT_FORM = {
  title: "",
  description: "",
  startsAt: "",
  endsAt: "",
  locationType: "virtual",
  locationLabel: "",
  meetingUrl: "",
  notes: "",
  followUpRequired: false,
};

const EMPTY_TASK_FORM = {
  title: "",
  description: "",
  dueAt: "",
  priority: "normal",
  appointmentId: "",
};

const EMPTY_NOTE_FORM = { category: "general", body: "" };

function isArchiveResult(payload: unknown): payload is ArchiveResult {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "storageKey" in payload &&
    typeof payload.storageKey === "string" &&
    "fileCount" in payload &&
    typeof payload.fileCount === "number"
  );
}

/**
 * Only an empty page shows the loading line. A reload after a save keeps the
 * student on screen, so a note or a task no longer blanks the instructor's
 * view. Try Again after a failed load shows the line again.
 */
export function showsLoadingLine(state: { loading: boolean; hasData: boolean; hasError: boolean }): boolean {
  return state.loading && (!state.hasData || state.hasError);
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error
  ) {
    return payload.error;
  }
  return fallback;
}

interface LoadFailedProps {
  error: string;
  onRetry: () => void;
  notice: Notice | null;
  onDismiss: () => void;
}

/**
 * The page when the student could not be loaded. A save can work and the
 * reload after it fail, so the message from that action still shows here.
 */
export function LoadFailed({ error, onRetry, notice, onDismiss }: LoadFailedProps) {
  return (
    <>
      <div className="text-center py-12">
        <p className="text-[var(--badge-error-text)] mb-4">{error}</p>
        <button onClick={onRetry} className="primary-button px-4 py-2 pointer-coarse:min-h-11">
          Try Again
        </button>
      </div>
      <ActionNotice notice={notice} onDismiss={onDismiss} />
    </>
  );
}

export default function StudentDetail({ studentId }: { studentId: string }) {
  const [data, setData] = useState<StudentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [certOutcomeVerifying, setCertOutcomeVerifying] = useState(false);
  const [applicationVerifying, setApplicationVerifying] = useState<string | null>(null);
  const [orientationVerifying, setOrientationVerifying] = useState<string | null>(null);
  const [showResetPw, setShowResetPw] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [reset, setReset] = useState<ResetState>({ kind: "idle" });
  const [deactivating, setDeactivating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveResult, setArchiveResult] = useState<ArchiveResult | null>(null);
  const [showAllConversations, setShowAllConversations] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const shownTab = useRef<string | null>(null);
  const [goalActionId, setGoalActionId] = useState<string | null>(null);
  const [goalActionButton, setGoalActionButton] = useState<GoalButton | null>(null);
  const goalActionRef = useRef<string | null>(null);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [reviewingFormId, setReviewingFormId] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [updatingAppointmentId, setUpdatingAppointmentId] = useState<string | null>(null);
  const { confirm, prompt, confirmDialog } = useConfirm();
  const [appointmentForm, setAppointmentForm] = useState(EMPTY_APPOINTMENT_FORM);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK_FORM);
  const [noteForm, setNoteForm] = useState(EMPTY_NOTE_FORM);
  const [moodEntries, setMoodEntries] = useState<MoodEntryData[]>([]);

  useEffect(() => {
    fetch(`/api/teacher/students/${studentId}/mood`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { entries: MoodEntryData[] } | null) => {
        if (d?.entries) setMoodEntries(d.entries);
      })
      .catch(() => {
        // Non-critical
      });
  }, [studentId]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/teacher/students/${studentId}`);
      if (res.ok) {
        setData(await res.json());
        setError(null);
      } else {
        const payload = await res.json().catch(() => null);
        setError(getErrorMessage(payload, "Failed to load. Please try again."));
      }
    } catch (err) {
      console.error("Failed to load student:", err instanceof Error ? err.message : "Unknown error");
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void (async () => {
      await loadData();
    })();
  }, [loadData]);

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  /**
   * How an action reports to this page: one pinned message, then a reload on
   * success. Two actions can overlap, so `nextNotice` decides what shows: a
   * failure stays until Dismiss, a tab change or a newer failure.
   */
  const notify = useCallback((incoming: Notice | null) => setNotice((showing) => nextNotice(showing, incoming)), []);
  const page: StudentActionPage = { notify, reload: loadData };
  /** Dismiss. It clears a failure too, which `notify` never does. */
  const clearNotice = useCallback(() => setNotice(null), []);

  /**
   * A tab change drops the message and everything the reset panel holds, so a
   * new password cannot come back when the instructor returns to the tab.
   */
  function handleTabShown(tab: string) {
    const changed = isTabChange(shownTab.current, tab);
    shownTab.current = tab;
    if (!changed) return;
    setNotice(null);
    setShowResetPw(false);
    setNewPassword("");
    setReset({ kind: "idle" });
  }

  /**
   * Try Again after a failed load. The tabs were taken down and come back on
   * the first tab. That is not the instructor changing tab, so the old tab is
   * forgotten and a message that outlived the failed load stays.
   */
  function retryLoad() {
    shownTab.current = null;
    void loadData();
  }

  async function handleVerify(requirementId: string, verified: boolean, label: string) {
    if (
      !verified &&
      !(await confirm({
        title: `Remove the verification for ${label}?`,
        message: "Grant reports count only verified steps.",
        confirmLabel: "Remove verification",
      }))
    ) {
      return;
    }
    setVerifying(requirementId);
    try {
      await runStudentAction(
        {
          url: "/api/teacher/certifications",
          method: "PUT",
          body: { requirementId, verified },
          failed: verified ? "That step was not verified." : "That step is still verified.",
          done: verified ? "Step verified." : "Verification removed.",
        },
        page,
      );
    } finally {
      setVerifying((current) => releaseFlag(current, requirementId));
    }
  }

  // P1-4: cert-level outcome verification — stamps the Certification row
  // (verificationStatus "verified") that grant reports count.
  async function handleCertOutcomeVerify(certificationId: string) {
    setCertOutcomeVerifying(true);
    try {
      await runStudentAction(
        {
          url: "/api/teacher/outcomes/verify",
          method: "POST",
          body: { targetType: "certification", targetId: certificationId },
          failed: "The certification was not verified.",
          done: "Certification verified.",
        },
        page,
      );
    } finally {
      setCertOutcomeVerifying(false);
    }
  }

  /**
   * Per-application outcome verification (P1-4). Without it every placement in
   * the grant report stayed "self-reported". A failure goes to the pinned
   * message and the page does not reload, because nothing changed.
   */
  async function handleApplicationVerify(applicationId: string) {
    setApplicationVerifying(applicationId);
    try {
      await runStudentAction(
        {
          url: "/api/teacher/outcomes/verify",
          method: "POST",
          body: { targetType: "application", targetId: applicationId },
          failed: "That job application was not verified.",
          done: "Job application verified.",
        },
        page,
      );
    } finally {
      setApplicationVerifying((current) => releaseFlag(current, applicationId));
    }
  }

  async function handleOrientationVerify(itemId: string, decision: "confirm" | "decline") {
    setOrientationVerifying(itemId);
    notify(null);
    try {
      const result = await sendStudentAction({
        url: "/api/orientation",
        method: "POST",
        body: { itemId, completed: decision === "confirm", studentId, verify: decision },
        failed: decision === "confirm" ? "That step was not confirmed." : "That step was not sent back.",
      });
      // If that was the last required item, this awards the orientation
      // milestone. `orientationOutcome` reads the answer: the usual refusal
      // while steps remain is not shown, and any other failure is.
      let finish: StudentActionResult | null = null;
      if (result.ok && decision === "confirm") {
        finish = await sendStudentAction({
          url: "/api/orientation/complete",
          method: "POST",
          body: { studentId },
          failed: "Orientation was not marked finished.",
        });
      }
      const outcome = orientationOutcome(
        result,
        finish,
        decision === "confirm" ? "Step confirmed." : "Step sent back to the student.",
      );
      if (outcome.reload) await loadData();
      notify(outcome.notice);
    } finally {
      setOrientationVerifying((current) => releaseFlag(current, itemId));
    }
  }

  /** Opening or closing the panel drops any password still in it, so it cannot linger on a shared screen. */
  function toggleResetPanel() {
    setShowResetPw((prev) => !prev);
    setNewPassword("");
    setReset({ kind: "idle" });
  }

  /** Typing a new password clears a reset failure that no longer applies. */
  function handlePasswordInput(value: string) {
    setNewPassword(value);
    setNotice((current) => (current?.origin === "reset" ? null : current));
  }

  async function handleResetPassword() {
    const password = newPassword.trim();
    if (password.length < MIN_PASSWORD_LENGTH) return;
    if (
      !(await confirm({
        title: "Reset this student's password?",
        message: "They will need the new password to log in.",
        confirmLabel: "Reset password",
      }))
    ) {
      return;
    }
    setReset({ kind: "saving" });
    notify(null);
    let next: ResetState = { kind: "idle" };
    try {
      const result = await sendStudentAction({
        url: `/api/teacher/students/${studentId}/reset-password`,
        method: "POST",
        body: { newPassword: password },
        failed: "The password was not changed.",
      });
      if (!result.ok) {
        notify({ kind: "error", text: result.message, origin: "reset" });
      } else {
        // Kept on screen until the instructor presses Close or changes tab, which clears it.
        setNewPassword(password);
        next = { kind: "done" };
      }
    } finally {
      setReset(next);
    }
  }

  async function toggleStudentStatus() {
    if (!data) return;
    const active = data.student.isActive;
    setDeactivating(true);
    try {
      await runStudentAction(
        {
          url: `/api/teacher/students/${studentId}/status`,
          method: "PATCH",
          body: { isActive: !active },
          failed: active ? "The account is still active." : "The account is still inactive.",
          done: active ? "Account turned off." : "Account turned back on.",
        },
        page,
      );
    } finally {
      setDeactivating(false);
      setConfirmDeactivate(false);
    }
  }

  async function handleArchive() {
    setArchiving(true);
    notify(null);
    try {
      const result = await sendStudentAction({
        url: `/api/teacher/students/${studentId}/archive`,
        method: "POST",
        failed: "The records archive was not created.",
      });
      if (!result.ok) {
        notify({ kind: "error", text: result.message });
      } else if (isArchiveResult(result.payload)) {
        setArchiveResult(result.payload);
      } else {
        notify({ kind: "error", text: ARCHIVE_LINK_MISSING });
      }
    } finally {
      setArchiving(false);
    }
  }

  async function handleCreateAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingAppointment(true);
    try {
      const outcome = await runStudentAction(
        {
          url: `/api/teacher/students/${studentId}/appointments`,
          method: "POST",
          body: appointmentForm,
          failed: "The appointment was not saved.",
          done: "Appointment scheduled.",
        },
        page,
      );
      if (outcome.resetForm) setAppointmentForm(EMPTY_APPOINTMENT_FORM);
    } finally {
      setSavingAppointment(false);
    }
  }

  async function handleAppointmentStatusChange(appointmentId: string, status: AppointmentStatusValue) {
    setUpdatingAppointmentId(appointmentId);
    try {
      await runStudentAction(
        {
          url: `/api/teacher/appointments/${appointmentId}`,
          method: "PATCH",
          body: { status },
          failed: "The appointment was not changed.",
          done: "Appointment updated.",
        },
        page,
      );
    } finally {
      setUpdatingAppointmentId((current) => releaseFlag(current, appointmentId));
    }
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingTask(true);
    try {
      const outcome = await runStudentAction(
        {
          url: `/api/teacher/students/${studentId}/tasks`,
          method: "POST",
          body: { ...taskForm, dueAt: toIsoDueAt(taskForm.dueAt) },
          failed: "The task was not saved.",
          done: "Follow-up task created.",
        },
        page,
      );
      if (outcome.resetForm) setTaskForm(EMPTY_TASK_FORM);
    } finally {
      setSavingTask(false);
    }
  }

  async function handleTaskStatusChange(taskId: string, status: "open" | "completed") {
    setUpdatingTaskId(taskId);
    try {
      await runStudentAction(
        {
          url: `/api/tasks/${taskId}`,
          method: "PATCH",
          body: { status },
          failed: "The task was not changed.",
          done: "Task updated.",
        },
        page,
      );
    } finally {
      setUpdatingTaskId((current) => releaseFlag(current, taskId));
    }
  }

  async function handleCreateNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingNote(true);
    try {
      const outcome = await runStudentAction(
        {
          url: `/api/teacher/students/${studentId}/notes`,
          method: "POST",
          body: noteForm,
          failed: "The note was not saved.",
          done: "Case note saved.",
        },
        page,
      );
      if (outcome.resetForm) setNoteForm(EMPTY_NOTE_FORM);
    } finally {
      setSavingNote(false);
    }
  }

  const handleGoalAction = async (goalId: string, action: GoalAction) => {
    // A second tap lands before React re-renders the disabled button.
    if (goalActionRef.current) return;
    goalActionRef.current = goalId;
    setGoalActionId(goalId);
    setGoalActionButton(goalButtonFor(action));
    try {
      await runStudentAction(
        {
          url: `/api/teacher/students/${studentId}/goals/${goalId}`,
          method: "PATCH",
          body: action,
          failed: "The goal was not changed.",
          done: "Goal updated.",
        },
        page,
      );
    } finally {
      goalActionRef.current = null;
      setGoalActionId(null);
      setGoalActionButton(null);
    }
  };

  async function handleReviewForm(
    submissionId: string,
    status: "approved" | "rejected",
    extras?: FormReviewExtras,
  ) {
    const notes = status === "rejected"
      ? await prompt({
          title: "Return this form to the student?",
          label: "Note for the student (optional)",
          confirmLabel: "Return form",
        })
      : "";
    if (notes === null) {
      return;
    }

    setReviewingFormId(submissionId);
    try {
      await runStudentAction(
        {
          url: `/api/teacher/students/${studentId}/forms`,
          method: "PATCH",
          body: buildFormReviewBody(submissionId, status, notes || "", extras),
          failed: "The form review was not saved.",
          done: (payload) => reviewResultMessage(status, extras, payload),
        },
        page,
      );
    } finally {
      setReviewingFormId((current) => releaseFlag(current, submissionId));
    }
  }

  if (showsLoadingLine({ loading, hasData: data !== null, hasError: error !== null })) {
    return <p className="text-sm text-[var(--ink-faint)]">Loading student data...</p>;
  }

  if (error) {
    return <LoadFailed error={error} onRetry={retryLoad} notice={notice} onDismiss={clearNotice} />;
  }

  if (!data) return <p className="text-sm text-[var(--badge-error-text)]">Student not found.</p>;

  return (
    <div className="space-y-6">
      <Link href="/teacher" className="inline-flex items-center pointer-coarse:min-h-11 text-sm text-info hover:text-[var(--ink-strong)] hover:underline">
        &larr; Back to Class Dashboard
      </Link>

      <StudentDetailTabs
        studentId={studentId}
        studentName={data.student.displayName}
      >
        {{
          coach: (
            <ShownTab key="coach" onShown={() => handleTabShown("coach")}>
              <div className="space-y-6">
                <OverviewTab
                  data={data}
                  moodEntries={moodEntries}
                  dateFormatter={dateFormatter}
                  showResetPw={showResetPw}
                  onToggleResetPw={toggleResetPanel}
                  newPassword={newPassword}
                  onNewPasswordChange={handlePasswordInput}
                  resetStatus={reset.kind}
                  onResetPassword={handleResetPassword}
                  confirmDeactivate={confirmDeactivate}
                  onSetConfirmDeactivate={setConfirmDeactivate}
                  deactivating={deactivating}
                  onToggleStudentStatus={toggleStudentStatus}
                  archiving={archiving}
                  onArchive={handleArchive}
                  archiveResult={archiveResult}
                  hideAdminControls
                />
                <GoalsPlanTab
                  data={data}
                  dateFormatter={dateFormatter}
                  onChanged={loadData}
                  onGoalAction={handleGoalAction}
                  goalActionId={goalActionId}
                  goalActionButton={goalActionButton}
                />
                <SageInsightList
                  studentId={data.student.id}
                  title="Sage Coaching Notes"
                  limit={8}
                />
                <OperationsTab
                  data={data}
                  dateFormatter={dateFormatter}
                  reviewingFormId={reviewingFormId}
                  onReviewForm={handleReviewForm}
                  appointmentForm={appointmentForm}
                  onAppointmentFormChange={setAppointmentForm}
                  savingAppointment={savingAppointment}
                  onCreateAppointment={handleCreateAppointment}
                  updatingAppointmentId={updatingAppointmentId}
                  onAppointmentStatusChange={handleAppointmentStatusChange}
                  taskForm={taskForm}
                  onTaskFormChange={setTaskForm}
                  savingTask={savingTask}
                  onCreateTask={handleCreateTask}
                  updatingTaskId={updatingTaskId}
                  onTaskStatusChange={handleTaskStatusChange}
                  noteForm={noteForm}
                  onNoteFormChange={setNoteForm}
                  savingNote={savingNote}
                  onCreateNote={handleCreateNote}
                  scope="coaching"
                />
              </div>
            </ShownTab>
          ),
          progress: (
            <ShownTab key="progress" onShown={() => handleTabShown("progress")}>
              <ProgressTab
                data={data}
                dateFormatter={dateFormatter}
                verifying={verifying}
                onVerify={handleVerify}
                certOutcomeVerifying={certOutcomeVerifying}
                onCertOutcomeVerify={handleCertOutcomeVerify}
                applicationVerifying={applicationVerifying}
                onApplicationVerify={handleApplicationVerify}
                orientationVerifying={orientationVerifying}
                onOrientationVerify={handleOrientationVerify}
                showAllConversations={showAllConversations}
                onShowAllConversations={() => setShowAllConversations(true)}
              />
            </ShownTab>
          ),
          forms: (
            <ShownTab key="forms" onShown={() => handleTabShown("forms")}>
              <div id="forms-documents" className="space-y-6">
                <OperationsTab
                  data={data}
                  dateFormatter={dateFormatter}
                  reviewingFormId={reviewingFormId}
                  onReviewForm={handleReviewForm}
                  appointmentForm={appointmentForm}
                  onAppointmentFormChange={setAppointmentForm}
                  savingAppointment={savingAppointment}
                  onCreateAppointment={handleCreateAppointment}
                  updatingAppointmentId={updatingAppointmentId}
                  onAppointmentStatusChange={handleAppointmentStatusChange}
                  taskForm={taskForm}
                  onTaskFormChange={setTaskForm}
                  savingTask={savingTask}
                  onCreateTask={handleCreateTask}
                  updatingTaskId={updatingTaskId}
                  onTaskStatusChange={handleTaskStatusChange}
                  noteForm={noteForm}
                  onNoteFormChange={setNoteForm}
                  savingNote={savingNote}
                  onCreateNote={handleCreateNote}
                  scope="submittedForms"
                />
              </div>
            </ShownTab>
          ),
          admin: (
            <ShownTab key="admin" onShown={() => handleTabShown("admin")}>
              <div id="account-actions" className="space-y-6">
                <OverviewTab
                  data={data}
                  moodEntries={moodEntries}
                  dateFormatter={dateFormatter}
                  showResetPw={showResetPw}
                  onToggleResetPw={toggleResetPanel}
                  newPassword={newPassword}
                  onNewPasswordChange={handlePasswordInput}
                  resetStatus={reset.kind}
                  onResetPassword={handleResetPassword}
                  confirmDeactivate={confirmDeactivate}
                  onSetConfirmDeactivate={setConfirmDeactivate}
                  deactivating={deactivating}
                  onToggleStudentStatus={toggleStudentStatus}
                  archiving={archiving}
                  onArchive={handleArchive}
                  archiveResult={archiveResult}
                />
              </div>
            </ShownTab>
          ),
        }}
      </StudentDetailTabs>
      <ActionNotice notice={notice} onDismiss={clearNotice} />
      {confirmDialog}
    </div>
  );
}
