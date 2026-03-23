"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import GoalTree from "./GoalTree";
import GoalSupportPlanner from "./GoalSupportPlanner";
import ReadinessScore from "@/components/ui/ReadinessScore";
import { type ReadinessBreakdown } from "@/lib/progression/readiness-score";
import {
  GOAL_RESOURCE_TYPE_LABELS,
  type GoalPlanEntry,
} from "@/lib/goal-resource-links";

interface GoalData {
  id: string;
  level: string;
  content: string;
  status: string;
  parentId: string | null;
  createdAt: string;
}

interface OrientationItemData {
  id: string;
  label: string;
  required: boolean;
}

interface OrientationProgressData {
  itemId: string;
  completed: boolean;
  completedAt: string | null;
}

interface CertTemplateData {
  id: string;
  label: string;
  required: boolean;
  needsFile: boolean;
  needsVerify: boolean;
  url: string | null;
}

interface CertRequirementData {
  id: string;
  templateId: string;
  completed: boolean;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  fileId: string | null;
  notes: string | null;
}

interface ConversationSummary {
  id: string;
  module: string;
  stage: string;
  title: string | null;
  updatedAt: string;
  lastMessagePreview: string | null;
  messageCount: number;
  userMessageCount: number;
  createdAt: string;
  duration: number | null;
}

interface PortfolioItemData {
  id: string;
  title: string;
  type: string;
  createdAt: string;
}

interface FileData {
  id: string;
  filename: string;
  category: string;
  uploadedAt: string;
}

interface AppointmentData {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  locationType: string;
  locationLabel: string | null;
  meetingUrl: string | null;
  notes: string | null;
  followUpRequired: boolean;
  advisorName: string;
}

interface TaskData {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  status: string;
  priority: string;
  completedAt: string | null;
  createdAt: string;
  appointmentId: string | null;
  createdByName: string;
}

interface NoteData {
  id: string;
  category: string;
  body: string;
  visibility: string;
  createdAt: string;
  authorName: string;
}

interface AlertData {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  detectedAt: string;
}

interface GoalEvidenceData {
  goalId: string;
  linkId: string;
  resourceType: keyof typeof GOAL_RESOURCE_TYPE_LABELS;
  resourceId: string;
  title: string;
  linkStatus: string;
  evidenceStatus: "not_started" | "in_progress" | "submitted" | "completed" | "approved" | "blocked";
  evidenceSource: "none" | "student_update" | "system" | "teacher_review";
  reviewNeeded: boolean;
  evidenceLabel: string;
  summary: string;
  lastObservedAt: string | null;
  dueAt: string | null;
  notes: string | null;
}

interface ReviewQueueItemData {
  key: string;
  kind: "goal_needs_resource" | "goal_resource_stale" | "goal_review_pending";
  severity: "medium" | "high";
  goalId: string;
  goalTitle: string;
  linkId: string | null;
  resourceTitle: string | null;
  summary: string;
  dueAt: string | null;
  detectedAt: string | null;
}

interface FormSubmissionData {
  id: string;
  formId: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  notes: string | null;
  file: {
    id: string;
    filename: string;
    mimeType: string;
    uploadedAt: string;
  } | null;
}

interface PublicCredentialPageData {
  isPublic: boolean;
  slug: string;
  headline: string | null;
  updatedAt?: string;
}

interface ApplicationData {
  id: string;
  status: string;
  updatedAt: string;
  appliedAt: string | null;
  opportunity: {
    id: string;
    title: string;
    company: string;
    type: string;
    deadline: string | null;
  };
}

interface EventRegistrationData {
  id: string;
  status: string;
  registeredAt: string;
  updatedAt: string;
  event: {
    id: string;
    title: string;
    startsAt: string;
    location: string | null;
  };
}

interface StudentData {
  student: {
    id: string;
    studentId: string;
    displayName: string;
    email: string | null;
    createdAt: string;
    isActive: boolean;
  };
  progression: {
    xp: number;
    level: number;
    streaks: { daily: { current: number; longest: number } };
    achievements: string[];
  };
  readinessScore: number;
  readinessBreakdown: ReadinessBreakdown;
  goals: GoalData[];
  goalPlans: GoalPlanEntry[];
  goalEvidence: GoalEvidenceData[];
  reviewQueue: ReviewQueueItemData[];
  formSubmissions: FormSubmissionData[];
  orientation: {
    items: OrientationItemData[];
    progress: OrientationProgressData[];
  };
  certification: {
    templates: CertTemplateData[];
    cert: {
      id: string;
      status: string;
      requirements: CertRequirementData[];
    } | null;
  };
  publicCredentialPage: PublicCredentialPageData | null;
  applications: ApplicationData[];
  eventRegistrations: EventRegistrationData[];
  portfolio: PortfolioItemData[];
  hasResume: boolean;
  files: FileData[];
  appointments: AppointmentData[];
  tasks: TaskData[];
  notes: NoteData[];
  alerts: AlertData[];
  conversations: ConversationSummary[];
  careerDiscovery: {
    status: string;
    topClusters: string[];
    sageSummary: string | null;
    interests: string[];
    strengths: string[];
    subjects: string[];
    problems: string[];
    values: string[];
    circumstances: string[];
    completedAt: string | null;
  } | null;
}

const EVIDENCE_STATUS_STYLES: Record<GoalEvidenceData["evidenceStatus"], string> = {
  not_started: "bg-slate-100 text-slate-600",
  in_progress: "bg-sky-100 text-sky-700",
  submitted: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700",
  approved: "bg-emerald-100 text-emerald-700",
  blocked: "bg-rose-100 text-rose-700",
};

const REVIEW_KIND_LABELS: Record<ReviewQueueItemData["kind"], string> = {
  goal_needs_resource: "Needs assignment",
  goal_resource_stale: "Needs follow-up",
  goal_review_pending: "Needs review",
};

const NOTE_CATEGORIES = [
  { value: "general", label: "General" },
  { value: "check_in", label: "Check-in" },
  { value: "risk", label: "Risk" },
  { value: "career", label: "Career" },
  { value: "celebration", label: "Celebration" },
] as const;
const TASK_PRIORITIES = ["low", "normal", "high"] as const;
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

function statusBadge(status: string) {
  if (status === "completed") return "bg-emerald-100 text-emerald-700";
  if (status === "missed") return "bg-rose-100 text-rose-700";
  if (status === "cancelled") return "bg-slate-100 text-slate-600";
  return "bg-sky-100 text-sky-700";
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

  const {
    student,
    progression,
    readinessScore,
    readinessBreakdown,
    goals,
    goalPlans,
    goalEvidence,
    reviewQueue,
    formSubmissions,
    orientation,
    certification,
    publicCredentialPage,
    applications,
    eventRegistrations,
    portfolio,
    hasResume,
    files,
    appointments,
    tasks,
    notes,
    alerts,
    conversations,
  } = data;

  const orientDone = orientation.progress.filter((progressItem) => progressItem.completed).length;
  const orientTotal = orientation.items.length;
  const certDone = certification.cert
    ? certification.cert.requirements.filter((requirement) => requirement.completed).length
    : 0;
  const openTasks = tasks.filter((task) => task.status !== "completed");
  const activeApplications = applications.filter((application) =>
    ["applied", "interviewing", "offer"].includes(application.status)
  );
  const activeEventRegistrations = eventRegistrations.filter(
    (registration) => registration.status === "registered"
  );
  const evidenceByLinkId = new Map(goalEvidence.map((entry) => [entry.linkId, entry]));
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const reviewActionForItem = (item: ReviewQueueItemData) => {
    const evidence = item.linkId ? evidenceByLinkId.get(item.linkId) : null;
    if (item.kind === "goal_needs_resource") {
      return { href: "#goal-plans", label: "Assign support" };
    }
    if (evidence?.resourceType === "form") {
      return { href: "#submitted-forms", label: "Review form" };
    }
    if (evidence?.resourceType === "certification") {
      return { href: "#certification-review", label: "Review certification" };
    }
    if (evidence?.resourceType === "career_step") {
      return { href: "#career-progress", label: "Open career progress" };
    }
    return { href: "#goal-evidence", label: "Open evidence" };
  };

  return (
    <div className="space-y-6">
      <Link href="/teacher" className="text-sm text-blue-600 hover:text-blue-800">
        ← Back to Class Dashboard
      </Link>

      {panelMessage ? (
        <div className="rounded-xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] px-4 py-3 text-sm text-[var(--ink-strong)]">
          {panelMessage}
        </div>
      ) : null}

      <div id="goal-evidence" className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{student.displayName}</h2>
            <p className="text-sm text-gray-500">
              ID: {student.studentId} {student.email && `• ${student.email}`}
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
              <button
                onClick={() => setShowResetPw(!showResetPw)}
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
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="New password (6+ chars)"
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleResetPassword}
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
            <div className="mt-3">
              {!confirmDeactivate ? (
                <button
                  onClick={() => setConfirmDeactivate(true)}
                  className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                    student.isActive
                      ? "border border-red-200 text-red-600 hover:bg-red-50"
                      : "border border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                  }`}
                >
                  {student.isActive ? "Deactivate Account" : "Reactivate Account"}
                </button>
              ) : (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-800">
                    {student.isActive
                      ? "This will log the student out and prevent future login. Their data is preserved."
                      : "This will allow the student to log in again."}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={toggleStudentStatus}
                      disabled={deactivating}
                      className={`rounded-lg px-4 py-2 text-xs font-semibold text-white ${
                        student.isActive ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                    >
                      {deactivating ? "Processing..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => setConfirmDeactivate(false)}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-4 text-center flex-wrap items-start">
            <ReadinessScore score={readinessScore} size="sm" />
            <div>
              <p className="text-lg font-bold text-blue-600">Lv {progression.level}</p>
              <p className="text-xs text-gray-400">{progression.xp} XP</p>
            </div>
            {progression.streaks.daily.current > 0 && (
              <div>
                <p className="text-lg font-bold text-orange-500">🔥 {progression.streaks.daily.current}</p>
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

      {alerts.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-700">Open Advising Alerts</h3>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
              {alerts.length} active
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-gray-900">{alert.title}</p>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700">
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

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Goal Evidence & Review</h3>
            <p className="mt-1 text-sm text-gray-500">
              Track which assigned resources have real student activity and what still needs instructor follow-up.
            </p>
          </div>
          <span className="rounded-full bg-[rgba(15,154,146,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-secondary)]">
            {reviewQueue.length} open review item{reviewQueue.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Review queue</p>
            {reviewQueue.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-gray-500">
                No goal-linked review items are open right now.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {reviewQueue.map((item) => (
                  <div
                    key={item.key}
                    className={`rounded-lg border p-4 ${
                      item.severity === "high"
                        ? "border-rose-200 bg-rose-50/70"
                        : "border-amber-200 bg-amber-50/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-600">
                            {REVIEW_KIND_LABELS[item.kind]}
                          </span>
                          <p className="text-sm font-semibold text-gray-900">
                            {item.resourceTitle || item.goalTitle}
                          </p>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-gray-600">{item.summary}</p>
                        <p className="mt-2 text-xs text-gray-400">
                          Goal: {item.goalTitle}
                          {item.detectedAt ? ` • ${dateFormatter.format(new Date(item.detectedAt))}` : ""}
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-700">
                        {item.severity}
                      </span>
                    </div>
                    {item.dueAt ? (
                      <p className="mt-2 text-xs font-medium text-rose-600">
                        Due {dateFormatter.format(new Date(item.dueAt))}
                      </p>
                    ) : null}
                    <a
                      href={reviewActionForItem(item).href}
                      className="mt-3 inline-flex text-xs font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
                    >
                      {reviewActionForItem(item).label} →
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Assigned resource evidence</p>
            {goalPlans.every((plan) => plan.links.length === 0) ? (
              <p className="mt-3 rounded-lg border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-gray-500">
                No assigned goal resources yet.
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {goalPlans
                  .filter((plan) => plan.links.length > 0)
                  .map((plan) => {
                    const goal = goalById.get(plan.goalId);
                    if (!goal) return null;

                    return (
                      <div key={plan.goalId} className="rounded-lg border border-gray-100 p-4">
                        <p className="text-sm font-semibold text-gray-900">{goal.content}</p>
                        <div className="mt-3 space-y-3">
                          {plan.links.map((link) => {
                            const evidence = evidenceByLinkId.get(link.id);
                            return (
                              <div key={link.id} className="rounded-lg border border-[rgba(18,38,63,0.08)] bg-[rgba(16,37,62,0.02)] p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                                        {GOAL_RESOURCE_TYPE_LABELS[link.resourceType]}
                                      </span>
                                      <p className="text-sm font-semibold text-gray-900">{link.title}</p>
                                    </div>
                                    <p className="mt-2 text-sm text-gray-600">
                                      {evidence?.summary || "No evidence summary available."}
                                    </p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                      {evidence?.lastObservedAt ? (
                                        <span>
                                          Last update {dateFormatter.format(new Date(evidence.lastObservedAt))}
                                        </span>
                                      ) : null}
                                      {evidence?.dueAt ? (
                                        <span>Due {dateFormatter.format(new Date(evidence.dueAt))}</span>
                                      ) : null}
                                      {link.url ? (
                                        <a
                                          href={link.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
                                        >
                                          Open resource
                                        </a>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${EVIDENCE_STATUS_STYLES[evidence?.evidenceStatus || "not_started"]}`}>
                                      {evidence?.evidenceLabel || "Waiting for activity"}
                                    </span>
                                    {evidence?.reviewNeeded ? (
                                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                                        Teacher review
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div id="submitted-forms" className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Submitted Forms</h3>
            <p className="mt-1 text-sm text-gray-500">
              Review uploaded paperwork and clear pending review items from the advising queue.
            </p>
          </div>
          <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-3 py-1 text-xs font-semibold text-[var(--ink-muted)]">
            {formSubmissions.length} submission{formSubmissions.length === 1 ? "" : "s"}
          </span>
        </div>

        {formSubmissions.length === 0 ? (
          <p className="mt-4 text-sm text-gray-400">No form submissions yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {formSubmissions.map((submission) => (
              <div key={submission.id} className="rounded-lg border border-gray-100 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{submission.title}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        submission.status === "approved"
                          ? "bg-emerald-100 text-emerald-700"
                          : submission.status === "rejected"
                            ? "bg-rose-100 text-rose-700"
                            : "bg-amber-100 text-amber-700"
                      }`}>
                        {submission.status}
                      </span>
                    </div>
                    {submission.description ? (
                      <p className="mt-2 text-sm text-gray-600">{submission.description}</p>
                    ) : null}
                    <p className="mt-2 text-xs text-gray-400">
                      Updated {dateFormatter.format(new Date(submission.updatedAt))}
                      {submission.reviewedAt ? ` • Reviewed ${dateFormatter.format(new Date(submission.reviewedAt))}` : ""}
                    </p>
                    {submission.notes ? (
                      <p className="mt-2 text-sm text-gray-600">Note: {submission.notes}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {submission.file ? (
                      <a
                        href={`/api/files/download?id=${submission.file.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-[rgba(18,38,63,0.12)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] hover:bg-white"
                      >
                        Open file
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleReviewForm(submission.id, "approved")}
                      disabled={reviewingFormId === submission.id}
                      className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-60"
                    >
                      {reviewingFormId === submission.id ? "Saving..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReviewForm(submission.id, "rejected")}
                      disabled={reviewingFormId === submission.id}
                      className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-200 disabled:opacity-60"
                    >
                      Return
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Appointments</h3>
              <p className="mt-1 text-sm text-gray-500">
                Schedule check-ins and update the outcome after each meeting.
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateAppointment} className="mt-4 space-y-3">
            <input
              type="text"
              value={appointmentForm.title}
              onChange={(event) => setAppointmentForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Appointment title"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              value={appointmentForm.description}
              onChange={(event) => setAppointmentForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="What is this session for?"
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-gray-600">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">
                  Start
                </span>
                <input
                  type="datetime-local"
                  value={appointmentForm.startsAt}
                  onChange={(event) => setAppointmentForm((current) => ({ ...current, startsAt: event.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="text-sm text-gray-600">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">
                  End
                </span>
                <input
                  type="datetime-local"
                  value={appointmentForm.endsAt}
                  onChange={(event) => setAppointmentForm((current) => ({ ...current, endsAt: event.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm text-gray-600">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">
                  Format
                </span>
                <select
                  value={appointmentForm.locationType}
                  onChange={(event) => setAppointmentForm((current) => ({ ...current, locationType: event.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="virtual">Virtual</option>
                  <option value="in_person">In person</option>
                  <option value="phone">Phone</option>
                </select>
              </label>
              <label className="text-sm text-gray-600 sm:col-span-2">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">
                  Location or label
                </span>
                <input
                  type="text"
                  value={appointmentForm.locationLabel}
                  onChange={(event) => setAppointmentForm((current) => ({ ...current, locationLabel: event.target.value }))}
                  placeholder="Zoom room, Office 201, Phone call"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>
            <input
              type="url"
              value={appointmentForm.meetingUrl}
              onChange={(event) => setAppointmentForm((current) => ({ ...current, meetingUrl: event.target.value }))}
              placeholder="Meeting URL (optional)"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={appointmentForm.notes}
              onChange={(event) => setAppointmentForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Student-facing note (optional)"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={appointmentForm.followUpRequired}
                onChange={(event) => setAppointmentForm((current) => ({ ...current, followUpRequired: event.target.checked }))}
              />
              Follow-up will be required after this appointment
            </label>
            <button
              type="submit"
              disabled={savingAppointment}
              className="w-full rounded-full bg-[var(--ink-strong)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[rgba(16,37,62,0.9)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingAppointment ? "Scheduling..." : "Schedule Appointment"}
            </button>
          </form>

          <div className="mt-5 space-y-3">
            {appointments.length === 0 ? (
              <p className="text-sm text-gray-400">No appointments scheduled yet.</p>
            ) : (
              appointments.map((appointment) => (
                <div key={appointment.id} className="rounded-lg border border-gray-100 p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{appointment.title}</p>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusBadge(appointment.status)}`}>
                          {appointment.status}
                        </span>
                        {appointment.followUpRequired && (
                          <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                            follow-up
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-500">
                        {dateFormatter.format(new Date(appointment.startsAt))} • {appointment.locationLabel || appointment.locationType.replace("_", " ")}
                      </p>
                      {appointment.description ? (
                        <p className="mt-2 text-sm text-gray-600">{appointment.description}</p>
                      ) : null}
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      {appointment.status === "scheduled" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleAppointmentStatusChange(appointment.id, "completed")}
                            disabled={updatingAppointmentId === appointment.id}
                            className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-60"
                          >
                            Complete
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAppointmentStatusChange(appointment.id, "missed")}
                            disabled={updatingAppointmentId === appointment.id}
                            className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-200 disabled:opacity-60"
                          >
                            Missed
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAppointmentStatusChange(appointment.id, "cancelled")}
                            disabled={updatingAppointmentId === appointment.id}
                            className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAppointmentStatusChange(appointment.id, "scheduled")}
                          disabled={updatingAppointmentId === appointment.id}
                          className="rounded-full bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-200 disabled:opacity-60"
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-3 text-sm">
                    {appointment.meetingUrl ? (
                      <a
                        href={appointment.meetingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Open link
                      </a>
                    ) : null}
                    {appointment.notes ? <span className="text-gray-500">Note: {appointment.notes}</span> : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700">Follow-Up Tasks</h3>
          <p className="mt-1 text-sm text-gray-500">
            Assign next steps that the student can track and complete.
          </p>

          <form onSubmit={handleCreateTask} className="mt-4 space-y-3">
            <input
              type="text"
              value={taskForm.title}
              onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Task title"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              value={taskForm.description}
              onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="What should the student do next?"
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm text-gray-600">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">
                  Due
                </span>
                <input
                  type="datetime-local"
                  value={taskForm.dueAt}
                  onChange={(event) => setTaskForm((current) => ({ ...current, dueAt: event.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="text-sm text-gray-600">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">
                  Priority
                </span>
                <select
                  value={taskForm.priority}
                  onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {TASK_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-gray-600">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">
                  Linked appointment
                </span>
                <select
                  value={taskForm.appointmentId}
                  onChange={(event) => setTaskForm((current) => ({ ...current, appointmentId: event.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">None</option>
                  {appointments.map((appointment) => (
                    <option key={appointment.id} value={appointment.id}>
                      {appointment.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="submit"
              disabled={savingTask}
              className="w-full rounded-full bg-[var(--ink-strong)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[rgba(16,37,62,0.9)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingTask ? "Saving..." : "Create Task"}
            </button>
          </form>

          <div className="mt-5 space-y-3">
            {tasks.length === 0 ? (
              <p className="text-sm text-gray-400">No follow-up tasks yet.</p>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className={`rounded-lg border p-4 ${
                    task.status === "completed"
                      ? "border-emerald-200 bg-emerald-50/70"
                      : "border-gray-100 bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{task.title}</p>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          task.priority === "high"
                            ? "bg-rose-100 text-rose-700"
                            : task.priority === "low"
                              ? "bg-slate-100 text-slate-600"
                              : "bg-amber-100 text-amber-700"
                        }`}>
                          {task.priority}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">
                        {task.dueAt ? `Due ${dateFormatter.format(new Date(task.dueAt))}` : "No due date"}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.12em] text-gray-400">
                        Created by {task.createdByName}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTaskStatusChange(task.id, task.status === "completed" ? "open" : "completed")}
                      disabled={updatingTaskId === task.id}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
                        task.status === "completed"
                          ? "bg-white text-slate-700 hover:bg-slate-100"
                          : "bg-[var(--ink-strong)] text-white hover:bg-[rgba(16,37,62,0.9)]"
                      }`}
                    >
                      {updatingTaskId === task.id
                        ? "Saving..."
                        : task.status === "completed"
                          ? "Reopen"
                          : "Mark complete"}
                    </button>
                  </div>

                  {task.description ? (
                    <p className="mt-3 text-sm text-gray-600">{task.description}</p>
                  ) : null}
                  {task.completedAt ? (
                    <p className="mt-2 text-xs text-emerald-700">
                      Completed {dateFormatter.format(new Date(task.completedAt))}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700">Case Notes</h3>
        <p className="mt-1 text-sm text-gray-500">
          Capture advising context, concerns, and wins for the teaching team.
        </p>

        <form onSubmit={handleCreateNote} className="mt-4 grid gap-3 lg:grid-cols-[12rem_1fr_auto]">
          <select
            value={noteForm.category}
            onChange={(event) => setNoteForm((current) => ({ ...current, category: event.target.value }))}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {NOTE_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
          <textarea
            value={noteForm.body}
            onChange={(event) => setNoteForm((current) => ({ ...current, body: event.target.value }))}
            placeholder="What happened, what matters, and what should happen next?"
            rows={3}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={savingNote}
            className="rounded-full bg-[var(--ink-strong)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[rgba(16,37,62,0.9)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingNote ? "Saving..." : "Add Note"}
          </button>
        </form>

        <div className="mt-5 space-y-3">
          {notes.length === 0 ? (
            <p className="text-sm text-gray-400">No case notes yet.</p>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="rounded-lg border border-gray-100 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                      {note.category.replace("_", " ")}
                    </span>
                    <span className="text-xs text-gray-400">
                      {note.authorName} • {dateFormatter.format(new Date(note.createdAt))}
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-gray-600">{note.body}</p>
              </div>
            ))
          )}
        </div>
      </div>

      <div id="goal-plans" className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Goals ({goals.length})</h3>
        <div className="mb-5">
          <GoalSupportPlanner goals={goals} goalPlans={goalPlans} onChanged={loadData} />
        </div>
        <GoalTree goals={goals} />
      </div>

      {/* Career Discovery */}
      <div id="career-discovery" className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Career Discovery
          {data.careerDiscovery?.status === "complete" && (
            <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Complete</span>
          )}
          {data.careerDiscovery?.status === "in_progress" && (
            <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">In Progress</span>
          )}
        </h3>
        {!data.careerDiscovery ? (
          <p className="text-sm text-gray-400">Student has not started career discovery yet.</p>
        ) : (
          <div className="space-y-3">
            {data.careerDiscovery.sageSummary && (
              <p className="text-sm text-gray-700">{data.careerDiscovery.sageSummary}</p>
            )}
            {data.careerDiscovery.topClusters.length > 0 && (
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase">Top Pathways</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {data.careerDiscovery.topClusters.map((cluster) => (
                    <span key={cluster} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md">
                      {cluster.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(data.careerDiscovery.interests.length > 0 || data.careerDiscovery.strengths.length > 0 || data.careerDiscovery.subjects.length > 0 || data.careerDiscovery.problems.length > 0 || data.careerDiscovery.values.length > 0) && (
              <details className="text-sm">
                <summary className="text-xs font-medium text-gray-500 uppercase cursor-pointer">Signals</summary>
                <div className="mt-2 space-y-2">
                  {data.careerDiscovery.interests.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Interests:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {data.careerDiscovery.interests.map((item, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.careerDiscovery.strengths.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Strengths:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {data.careerDiscovery.strengths.map((item, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.careerDiscovery.subjects.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Preferred Subjects:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {data.careerDiscovery.subjects.map((item, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.careerDiscovery.problems.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Problems They Care About:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {data.careerDiscovery.problems.map((item, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.careerDiscovery.values.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Values:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {data.careerDiscovery.values.map((item, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.careerDiscovery.circumstances.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">Circumstances:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {data.careerDiscovery.circumstances.map((item, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      <div id="orientation-review" className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Orientation ({orientDone}/{orientTotal})
        </h3>
        {orientTotal === 0 ? (
          <p className="text-sm text-gray-400">No orientation items configured.</p>
        ) : (
          <div className="space-y-1">
            {orientation.items.map((item) => {
              const progressItem = orientation.progress.find((progress) => progress.itemId === item.id);
              return (
                <div key={item.id} className="flex items-center gap-2 text-sm">
                  <span className={progressItem?.completed ? "text-green-500" : "text-gray-300"}>
                    {progressItem?.completed ? "✓" : "○"}
                  </span>
                  <span className={progressItem?.completed ? "text-gray-700" : "text-gray-500"}>
                    {item.label}
                  </span>
                  {item.required && !progressItem?.completed && (
                    <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">Required</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div id="certification-review" className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Ready to Work Certification ({certDone}/{certification.templates.length})
          {certification.cert?.status === "completed" && (
            <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Completed</span>
          )}
        </h3>
        {!certification.cert ? (
          <p className="text-sm text-gray-400">Student hasn&apos;t started certification yet.</p>
        ) : (
          <div className="space-y-2">
            {certification.templates.map((template) => {
              const requirement = certification.cert?.requirements.find((item) => item.templateId === template.id);
              return (
                <div key={template.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className={requirement?.completed ? "text-green-500" : "text-gray-300"}>
                        {requirement?.completed ? "✓" : "○"}
                      </span>
                      <span className="text-sm text-gray-700">{template.label}</span>
                      {template.required && (
                        <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Required</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {requirement?.fileId && (
                        <a
                          href={`/api/files/download?id=${requirement.fileId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          📎 View file
                        </a>
                      )}

                      {template.needsVerify && requirement?.completed && (
                        <button
                          onClick={() => handleVerify(requirement.id, !requirement.verifiedBy)}
                          disabled={verifying === requirement.id}
                          className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                            requirement.verifiedBy
                              ? "bg-green-100 text-green-700 hover:bg-red-50 hover:text-red-600"
                              : "bg-orange-100 text-orange-700 hover:bg-green-100 hover:text-green-700"
                          }`}
                        >
                          {verifying === requirement.id
                            ? "..."
                            : requirement.verifiedBy
                              ? "✓ Verified"
                              : "Verify"}
                        </button>
                      )}
                    </div>
                  </div>

                  {requirement?.verifiedAt && (
                    <p className="text-xs text-gray-400 mt-1 ml-6">
                      Verified {new Date(requirement.verifiedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 rounded-lg border border-[rgba(15,154,146,0.14)] bg-[rgba(15,154,146,0.07)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-secondary)]">
            Public credential
          </p>
          <p className="mt-2 text-sm text-gray-700">
            {publicCredentialPage?.isPublic
              ? "This student's credential page is live and shareable."
              : "No public credential page is live yet."}
          </p>
          {publicCredentialPage?.isPublic ? (
            <a
              href={`/credentials/${publicCredentialPage.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex text-sm font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
            >
              Open public credential →
            </a>
          ) : null}
        </div>
      </div>

      <div id="career-progress" className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Career Progress ({activeApplications.length} active apps • {activeEventRegistrations.length} event registrations)
        </h3>

        <div className="grid gap-6 xl:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-400">Applications</p>
            {applications.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400">No tracked applications yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {applications.slice(0, 6).map((application) => (
                  <div key={application.id} className="rounded-lg border border-gray-100 p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{application.opportunity.title}</p>
                        <p className="mt-1 text-sm text-gray-500">
                          {application.opportunity.company} • {application.opportunity.type}
                        </p>
                      </div>
                      <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                        {application.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      Updated {dateFormatter.format(new Date(application.updatedAt))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-400">Event engagement</p>
            {eventRegistrations.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400">No event registrations yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {eventRegistrations.slice(0, 6).map((registration) => (
                  <div key={registration.id} className="rounded-lg border border-gray-100 p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{registration.event.title}</p>
                        <p className="mt-1 text-sm text-gray-500">
                          {dateFormatter.format(new Date(registration.event.startsAt))}
                        </p>
                      </div>
                      <span className="rounded-full bg-teal-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-700">
                        {registration.status}
                      </span>
                    </div>
                    {registration.event.location ? (
                      <p className="mt-2 text-xs text-gray-400">{registration.event.location}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Portfolio ({portfolio.length} items)
          {hasResume && <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Resume built</span>}
        </h3>
        {portfolio.length === 0 ? (
          <p className="text-sm text-gray-400">No portfolio items yet.</p>
        ) : (
          <div className="space-y-1">
            {portfolio.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-gray-400 capitalize bg-gray-100 px-1.5 py-0.5 rounded">
                  {item.type}
                </span>
                <span className="text-gray-700">{item.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Files ({files.length})</h3>
        {files.length === 0 ? (
          <p className="text-sm text-gray-400">No files uploaded.</p>
        ) : (
          <div className="space-y-1">
            {files.map((file) => (
              <div key={file.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 capitalize bg-gray-100 px-1.5 py-0.5 rounded">
                    {file.category}
                  </span>
                  <a
                    href={`/api/files/download?id=${file.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800"
                  >
                    {file.filename}
                  </a>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(file.uploadedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Conversations ({conversations.length})
        </h3>
        {conversations.length === 0 ? (
          <p className="text-sm text-gray-400">No conversations yet.</p>
        ) : (
          <div className="space-y-2">
            {(showAllConversations ? conversations : conversations.slice(0, 20)).map((conv) => (
              <div key={conv.id} className="surface-section p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{conv.module === "goal" ? "\uD83C\uDFAF" : "\uD83D\uDCAC"}</span>
                      <p className="text-sm font-semibold text-[var(--ink-strong)]">
                        {conv.title || `${conv.stage} conversation`}
                      </p>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <span className="rounded-full bg-[rgba(15,154,146,0.1)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-secondary)]">
                        {conv.stage}
                      </span>
                      <span className="text-[10px] text-[var(--ink-muted)]">
                        {conv.messageCount} messages ({conv.userMessageCount} from student)
                      </span>
                    </div>
                    {conv.lastMessagePreview && (
                      <p className="mt-2 text-xs text-[var(--ink-muted)] line-clamp-2">&ldquo;{conv.lastMessagePreview}&rdquo;</p>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">
                    {new Date(conv.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
            {!showAllConversations && conversations.length > 20 && (
              <button
                onClick={() => setShowAllConversations(true)}
                className="w-full text-xs text-[var(--accent-strong)] hover:text-[var(--ink-strong)] py-2"
              >
                Show all {conversations.length} conversations
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
