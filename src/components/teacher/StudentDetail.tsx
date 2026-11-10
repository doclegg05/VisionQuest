"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SageInsightList from "@/components/sage/SageInsightList";
import type {
  MoodEntryData,
  StudentData,
} from "./student-detail/types";
import StudentDetailTabs from "./student-detail/StudentDetailTabs";
import OverviewTab from "./student-detail/OverviewTab";
import GoalsPlanTab from "./student-detail/GoalsPlanTab";
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
  runStudentAction,
  sendStudentAction,
  type StudentActionPage,
} from "@/lib/teacher/student-action";

type AppointmentStatusValue = "scheduled" | "completed" | "missed" | "cancelled";

/** Where a password reset stands. A failure always carries the words to show. */
type ResetState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done" }
  | { kind: "error"; message: string };

interface ArchiveResult {
  storageKey: string;
  fileCount: number;
}

/** What every failed request ends with, after the part that says what did not happen. */
const TRY_AGAIN = "Check your connection and try again.";

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

export default function StudentDetail({ studentId }: { studentId: string }) {
  const [data, setData] = useState<StudentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [certOutcomeVerifying, setCertOutcomeVerifying] = useState(false);
  const [applicationVerifying, setApplicationVerifying] = useState<string | null>(null);
  const [applicationVerifyError, setApplicationVerifyError] = useState<string | null>(null);
  const [orientationVerifying, setOrientationVerifying] = useState<string | null>(null);
  const [showResetPw, setShowResetPw] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [reset, setReset] = useState<ResetState>({ kind: "idle" });
  const [deactivating, setDeactivating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveResult, setArchiveResult] = useState<ArchiveResult | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [showAllConversations, setShowAllConversations] = useState(false);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);
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

  /** How an action reports to this page: failures go to the banner. */
  const page: StudentActionPage = { report: setPanelMessage, reload: loadData };

  async function handleVerify(requirementId: string, verified: boolean) {
    setVerifying(requirementId);
    await runStudentAction(
      {
        url: "/api/teacher/certifications",
        method: "PUT",
        body: { requirementId, verified },
        fallback: verified
          ? `That step was not verified. ${TRY_AGAIN}`
          : `That step is still verified. ${TRY_AGAIN}`,
      },
      page,
    );
    setVerifying(null);
  }

  // P1-4: cert-level outcome verification — stamps the Certification row
  // (verificationStatus "verified") that grant reports count.
  async function handleCertOutcomeVerify(certificationId: string) {
    setCertOutcomeVerifying(true);
    await runStudentAction(
      {
        url: "/api/teacher/outcomes/verify",
        method: "POST",
        body: { targetType: "certification", targetId: certificationId },
        fallback: `The certification was not verified. ${TRY_AGAIN}`,
      },
      page,
    );
    setCertOutcomeVerifying(false);
  }

  /**
   * Per-application outcome verification (P1-4). `/api/teacher/outcomes/verify`
   * has accepted `targetType: "application"` since P1-4 shipped, but nothing
   * called it — so every placement in the grant report stayed "self-reported".
   * This is the missing call site, not a new endpoint.
   */
  async function handleApplicationVerify(applicationId: string) {
    setApplicationVerifying(applicationId);
    setApplicationVerifyError(null);
    const res = await sendStudentAction({
      url: "/api/teacher/outcomes/verify",
      method: "POST",
      body: { targetType: "application", targetId: applicationId },
      fallback: `Could not verify that. ${TRY_AGAIN}`,
    });
    // A failed verify that silently reloaded left the row looking exactly as
    // it did before, so the instructor would conclude the button did nothing
    // and try again, or worse, assume it had worked. Say so next to the list,
    // and do not reload: the data has not changed.
    if (!res.ok) {
      setApplicationVerifyError(res.message);
    } else {
      await loadData();
    }
    setApplicationVerifying(null);
  }

  async function handleOrientationVerify(itemId: string, decision: "confirm" | "decline") {
    setOrientationVerifying(itemId);
    setPanelMessage(null);
    const result = await sendStudentAction({
      url: "/api/orientation",
      method: "POST",
      body: { itemId, completed: decision === "confirm", studentId, verify: decision },
      fallback:
        decision === "confirm"
          ? `That step was not confirmed. ${TRY_AGAIN}`
          : `That step was not declined. ${TRY_AGAIN}`,
    });
    if (!result.ok) {
      setPanelMessage(result.message);
    } else {
      if (decision === "confirm") {
        // If that was the last outstanding required item, this awards the
        // orientation-complete milestone (75 XP) through the existing
        // completion path. While steps remain the server refuses, which is
        // the usual answer, so this result is not shown.
        await sendStudentAction({
          url: "/api/orientation/complete",
          method: "POST",
          body: { studentId },
          fallback: "Orientation was not marked finished.",
        });
      }
      await loadData();
    }
    setOrientationVerifying(null);
  }

  async function handleResetPassword() {
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) return;
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
    const result = await sendStudentAction({
      url: `/api/teacher/students/${studentId}/reset-password`,
      method: "POST",
      body: { newPassword },
      fallback: `The password was not changed. ${TRY_AGAIN}`,
    });
    if (!result.ok) {
      setReset({ kind: "error", message: result.message });
      return;
    }
    setReset({ kind: "done" });
    setNewPassword("");
    setTimeout(() => {
      setReset({ kind: "idle" });
      setShowResetPw(false);
    }, 2000);
  }

  async function toggleStudentStatus() {
    if (!data) return;
    setDeactivating(true);
    await runStudentAction(
      {
        url: `/api/teacher/students/${studentId}/status`,
        method: "PATCH",
        body: { isActive: !data.student.isActive },
        fallback: data.student.isActive
          ? `The account is still active. ${TRY_AGAIN}`
          : `The account is still inactive. ${TRY_AGAIN}`,
      },
      page,
    );
    setDeactivating(false);
    setConfirmDeactivate(false);
  }

  async function handleArchive() {
    setArchiving(true);
    setArchiveError(null);
    const result = await sendStudentAction({
      url: `/api/teacher/students/${studentId}/archive`,
      method: "POST",
      fallback: `The archive was not made. ${TRY_AGAIN}`,
    });
    if (!result.ok) {
      setArchiveError(result.message);
    } else if (isArchiveResult(result.payload)) {
      setArchiveResult(result.payload);
    } else {
      setArchiveError("The archive was made, but its download link did not arrive. Reload the page and try again.");
    }
    setArchiving(false);
  }

  async function handleCreateAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingAppointment(true);
    setPanelMessage(null);
    const result = await sendStudentAction({
      url: `/api/teacher/students/${studentId}/appointments`,
      method: "POST",
      body: appointmentForm,
      fallback: `The appointment was not saved. ${TRY_AGAIN}`,
    });
    if (!result.ok) {
      setPanelMessage(result.message);
    } else {
      setAppointmentForm(EMPTY_APPOINTMENT_FORM);
      setPanelMessage("Appointment scheduled.");
      await loadData();
    }
    setSavingAppointment(false);
  }

  async function handleAppointmentStatusChange(appointmentId: string, status: AppointmentStatusValue) {
    setUpdatingAppointmentId(appointmentId);
    setPanelMessage(null);
    const result = await sendStudentAction({
      url: `/api/teacher/appointments/${appointmentId}`,
      method: "PATCH",
      body: { status },
      fallback: `The appointment was not changed. ${TRY_AGAIN}`,
    });
    if (!result.ok) {
      setPanelMessage(result.message);
    } else {
      setPanelMessage("Appointment updated.");
      await loadData();
    }
    setUpdatingAppointmentId(null);
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingTask(true);
    setPanelMessage(null);
    const result = await sendStudentAction({
      url: `/api/teacher/students/${studentId}/tasks`,
      method: "POST",
      body: { ...taskForm, dueAt: toIsoDueAt(taskForm.dueAt) },
      fallback: `The task was not saved. ${TRY_AGAIN}`,
    });
    if (!result.ok) {
      setPanelMessage(result.message);
    } else {
      setTaskForm(EMPTY_TASK_FORM);
      setPanelMessage("Follow-up task created.");
      await loadData();
    }
    setSavingTask(false);
  }

  async function handleTaskStatusChange(taskId: string, status: "open" | "completed") {
    setUpdatingTaskId(taskId);
    setPanelMessage(null);
    const result = await sendStudentAction({
      url: `/api/tasks/${taskId}`,
      method: "PATCH",
      body: { status },
      fallback: `The task was not changed. ${TRY_AGAIN}`,
    });
    if (!result.ok) {
      setPanelMessage(result.message);
    } else {
      setPanelMessage("Task updated.");
      await loadData();
    }
    setUpdatingTaskId(null);
  }

  async function handleCreateNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingNote(true);
    setPanelMessage(null);
    const result = await sendStudentAction({
      url: `/api/teacher/students/${studentId}/notes`,
      method: "POST",
      body: noteForm,
      fallback: `The note was not saved. ${TRY_AGAIN}`,
    });
    if (!result.ok) {
      setPanelMessage(result.message);
    } else {
      setNoteForm(EMPTY_NOTE_FORM);
      setPanelMessage("Case note saved.");
      await loadData();
    }
    setSavingNote(false);
  }

  const handleGoalAction = async (goalId: string, action: { status?: string; content?: string; confirm?: boolean; reviewed?: boolean; pathwayId?: string | null }) => {
    await runStudentAction(
      {
        url: `/api/teacher/students/${studentId}/goals/${goalId}`,
        method: "PATCH",
        body: action,
        fallback: `The goal was not changed. ${TRY_AGAIN}`,
      },
      page,
    );
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
    setPanelMessage(null);
    const result = await sendStudentAction({
      url: `/api/teacher/students/${studentId}/forms`,
      method: "PATCH",
      body: buildFormReviewBody(submissionId, status, notes || "", extras),
      fallback: `The form review was not saved. ${TRY_AGAIN}`,
    });
    if (!result.ok) {
      setPanelMessage(result.message);
    } else {
      setPanelMessage(reviewResultMessage(status, extras, result.payload));
      await loadData();
    }
    setReviewingFormId(null);
  }

  if (showsLoadingLine({ loading, hasData: data !== null, hasError: error !== null })) {
    return <p className="text-sm text-[var(--ink-faint)]">Loading student data...</p>;
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--badge-error-text)] mb-4">{error}</p>
        <button onClick={loadData} className="primary-button px-4 py-2 pointer-coarse:min-h-11">
          Try Again
        </button>
      </div>
    );
  }

  if (!data) return <p className="text-sm text-[var(--badge-error-text)]">Student not found.</p>;

  return (
    <div className="space-y-6">
      <Link href="/teacher" className="inline-flex items-center pointer-coarse:min-h-11 text-sm text-info hover:text-[var(--ink-strong)] hover:underline">
        &larr; Back to Class Dashboard
      </Link>

      {panelMessage ? (
        <div role="alert" className="rounded-xl border border-[rgba(0,123,175,0.18)] bg-[rgba(0,123,175,0.08)] px-4 py-3 text-sm text-[var(--ink-strong)]">
          {panelMessage}
        </div>
      ) : null}

      <StudentDetailTabs
        studentId={studentId}
        studentName={data.student.displayName}
      >
        {{
          coach: (
            <div className="space-y-6">
              <OverviewTab
                data={data}
                moodEntries={moodEntries}
                dateFormatter={dateFormatter}
                showResetPw={showResetPw}
                onToggleResetPw={() => setShowResetPw((prev) => !prev)}
                newPassword={newPassword}
                onNewPasswordChange={setNewPassword}
                resetStatus={reset.kind}
                resetError={reset.kind === "error" ? reset.message : null}
                onResetPassword={handleResetPassword}
                confirmDeactivate={confirmDeactivate}
                onSetConfirmDeactivate={setConfirmDeactivate}
                deactivating={deactivating}
                onToggleStudentStatus={toggleStudentStatus}
                archiving={archiving}
                onArchive={handleArchive}
                archiveResult={archiveResult}
                archiveError={archiveError}
                hideAdminControls
              />
              <GoalsPlanTab
                data={data}
                dateFormatter={dateFormatter}
                onChanged={loadData}
                onGoalAction={handleGoalAction}
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
          ),
          progress: (
            <ProgressTab
              data={data}
              dateFormatter={dateFormatter}
              verifying={verifying}
              onVerify={handleVerify}
              certOutcomeVerifying={certOutcomeVerifying}
              onCertOutcomeVerify={handleCertOutcomeVerify}
              applicationVerifying={applicationVerifying}
              applicationVerifyError={applicationVerifyError}
              onApplicationVerify={handleApplicationVerify}
              orientationVerifying={orientationVerifying}
              onOrientationVerify={handleOrientationVerify}
              showAllConversations={showAllConversations}
              onShowAllConversations={() => setShowAllConversations(true)}
            />
          ),
          forms: (
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
          ),
          admin: (
            <div id="account-actions" className="space-y-6">
              <OverviewTab
                data={data}
                moodEntries={moodEntries}
                dateFormatter={dateFormatter}
                showResetPw={showResetPw}
                onToggleResetPw={() => setShowResetPw((prev) => !prev)}
                newPassword={newPassword}
                onNewPasswordChange={setNewPassword}
                resetStatus={reset.kind}
                resetError={reset.kind === "error" ? reset.message : null}
                onResetPassword={handleResetPassword}
                confirmDeactivate={confirmDeactivate}
                onSetConfirmDeactivate={setConfirmDeactivate}
                deactivating={deactivating}
                onToggleStudentStatus={toggleStudentStatus}
                archiving={archiving}
                onArchive={handleArchive}
                archiveResult={archiveResult}
                archiveError={archiveError}
              />
            </div>
          ),
        }}
      </StudentDetailTabs>
      {confirmDialog}
    </div>
  );
}
