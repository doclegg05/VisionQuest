"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type {
  MoodEntryData,
  StudentData,
} from "./student-detail/types";
import StudentDetailTabs from "./student-detail/StudentDetailTabs";
import OverviewTab from "./student-detail/OverviewTab";
import GoalsPlanTab from "./student-detail/GoalsPlanTab";
import ProgressTab from "./student-detail/ProgressTab";
import OperationsTab from "./student-detail/OperationsTab";

type AppointmentStatusValue = "scheduled" | "completed" | "missed" | "cancelled";

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
  const [showResetPw, setShowResetPw] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetStatus, setResetStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [deactivating, setDeactivating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveResult, setArchiveResult] = useState<{ storageKey: string; fileCount: number } | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [showAllConversations, setShowAllConversations] = useState(false);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [reviewingFormId, setReviewingFormId] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [updatingAppointmentId, setUpdatingAppointmentId] = useState<string | null>(null);
  const [appointmentForm, setAppointmentForm] = useState({
    title: "",
    description: "",
    startsAt: "",
    endsAt: "",
    locationType: "virtual",
    locationLabel: "",
    meetingUrl: "",
    notes: "",
    followUpRequired: false,
  });
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    dueAt: "",
    priority: "normal",
    appointmentId: "",
  });
  const [noteForm, setNoteForm] = useState({
    category: "general",
    body: "",
  });
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
      console.error("Failed to load student:", err);
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  async function handleVerify(requirementId: string, verified: boolean) {
    setVerifying(requirementId);
    try {
      await fetch("/api/teacher/certifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirementId, verified }),
      });
      await loadData();
    } catch (err) {
      console.error("Failed to verify:", err);
    } finally {
      setVerifying(null);
    }
  }

  async function handleResetPassword() {
    if (!newPassword || newPassword.length < 6) return;
    if (!confirm("Reset password for this student? They will need the new password to log in.")) return;
    setResetStatus("saving");
    try {
      const res = await fetch(`/api/teacher/students/${studentId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      if (res.ok) {
        setResetStatus("done");
        setNewPassword("");
        setTimeout(() => {
          setResetStatus("idle");
          setShowResetPw(false);
        }, 2000);
      } else {
        setResetStatus("error");
      }
    } catch {
      setResetStatus("error");
    }
  }

  async function toggleStudentStatus() {
    if (!data) return;
    setDeactivating(true);
    try {
      const res = await fetch(`/api/teacher/students/${studentId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !data.student.isActive }),
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error("Failed to toggle student status:", err);
    } finally {
      setDeactivating(false);
      setConfirmDeactivate(false);
    }
  }

  async function handleArchive() {
    setArchiving(true);
    setArchiveError(null);
    try {
      const res = await apiFetch(`/api/teacher/students/${studentId}/archive`, { method: "POST" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setArchiveError((payload as { error?: string }).error || "Archive failed.");
        return;
      }
      const result = await res.json();
      setArchiveResult(result as { storageKey: string; fileCount: number });
    } catch {
      setArchiveError("Archive failed. Please try again.");
    } finally {
      setArchiving(false);
    }
  }

  async function handleCreateAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingAppointment(true);
    setPanelMessage(null);

    try {
      const response = await fetch(`/api/teacher/students/${studentId}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appointmentForm),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not create the appointment."));
      }

      setAppointmentForm({
        title: "",
        description: "",
        startsAt: "",
        endsAt: "",
        locationType: "virtual",
        locationLabel: "",
        meetingUrl: "",
        notes: "",
        followUpRequired: false,
      });
      setPanelMessage("Appointment scheduled.");
      await loadData();
    } catch (err) {
      setPanelMessage(err instanceof Error ? err.message : "Could not create the appointment.");
    } finally {
      setSavingAppointment(false);
    }
  }

  async function handleAppointmentStatusChange(appointmentId: string, status: AppointmentStatusValue) {
    setUpdatingAppointmentId(appointmentId);
    setPanelMessage(null);

    try {
      const response = await fetch(`/api/teacher/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not update the appointment."));
      }

      setPanelMessage("Appointment updated.");
      await loadData();
    } catch (err) {
      setPanelMessage(err instanceof Error ? err.message : "Could not update the appointment.");
    } finally {
      setUpdatingAppointmentId(null);
    }
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingTask(true);
    setPanelMessage(null);

    try {
      const response = await fetch(`/api/teacher/students/${studentId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskForm),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not create the task."));
      }

      setTaskForm({
        title: "",
        description: "",
        dueAt: "",
        priority: "normal",
        appointmentId: "",
      });
      setPanelMessage("Follow-up task created.");
      await loadData();
    } catch (err) {
      setPanelMessage(err instanceof Error ? err.message : "Could not create the task.");
    } finally {
      setSavingTask(false);
    }
  }

  async function handleTaskStatusChange(taskId: string, status: "open" | "completed") {
    setUpdatingTaskId(taskId);
    setPanelMessage(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not update the task."));
      }

      setPanelMessage("Task updated.");
      await loadData();
    } catch (err) {
      setPanelMessage(err instanceof Error ? err.message : "Could not update the task.");
    } finally {
      setUpdatingTaskId(null);
    }
  }

  async function handleCreateNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingNote(true);
    setPanelMessage(null);

    try {
      const response = await fetch(`/api/teacher/students/${studentId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(noteForm),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not save the note."));
      }

      setNoteForm({ category: "general", body: "" });
      setPanelMessage("Case note saved.");
      await loadData();
    } catch (err) {
      setPanelMessage(err instanceof Error ? err.message : "Could not save the note.");
    } finally {
      setSavingNote(false);
    }
  }

  const handleGoalAction = async (goalId: string, action: { status?: string; content?: string; confirm?: boolean; reviewed?: boolean }) => {
    try {
      const res = await apiFetch(`/api/teacher/students/${studentId}/goals/${goalId}`, {
        method: "PATCH",
        body: JSON.stringify(action),
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      setPanelMessage(err instanceof Error ? err.message : "Could not update the goal.");
    }
  };

  async function handleReviewForm(submissionId: string, status: "approved" | "rejected") {
    const notes = status === "rejected"
      ? window.prompt("Optional note for the student:", "")
      : "";
    if (status === "rejected" && notes === null) {
      return;
    }

    setReviewingFormId(submissionId);
    setPanelMessage(null);

    try {
      const response = await fetch(`/api/teacher/students/${studentId}/forms`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          status,
          notes: notes || "",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not update the form review."));
      }

      setPanelMessage(status === "approved" ? "Form approved." : "Form returned for revision.");
      await loadData();
    } catch (err) {
      setPanelMessage(err instanceof Error ? err.message : "Could not update the form review.");
    } finally {
      setReviewingFormId(null);
    }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading student data...</p>;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error}</p>
        <button onClick={loadData} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Try Again
        </button>
      </div>
    );
  }

  if (!data) return <p className="text-sm text-red-500">Student not found.</p>;

  return (
    <div className="space-y-6">
      <Link href="/teacher" className="text-sm text-blue-600 hover:text-blue-800">
        &larr; Back to Class Dashboard
      </Link>

      {panelMessage ? (
        <div className="rounded-xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] px-4 py-3 text-sm text-[var(--ink-strong)]">
          {panelMessage}
        </div>
      ) : null}

      <StudentDetailTabs
        studentId={studentId}
        studentName={data.student.displayName}
      >
        {{
          overview: (
            <OverviewTab
              data={data}
              moodEntries={moodEntries}
              dateFormatter={dateFormatter}
              showResetPw={showResetPw}
              onToggleResetPw={() => setShowResetPw((prev) => !prev)}
              newPassword={newPassword}
              onNewPasswordChange={setNewPassword}
              resetStatus={resetStatus}
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
          ),
          goals: (
            <GoalsPlanTab
              data={data}
              dateFormatter={dateFormatter}
              onChanged={loadData}
              onGoalAction={handleGoalAction}
            />
          ),
          progress: (
            <ProgressTab
              data={data}
              dateFormatter={dateFormatter}
              verifying={verifying}
              onVerify={handleVerify}
              showAllConversations={showAllConversations}
              onShowAllConversations={() => setShowAllConversations(true)}
            />
          ),
          operations: (
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
            />
          ),
        }}
      </StudentDetailTabs>
    </div>
  );
}
