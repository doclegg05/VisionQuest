"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface StudentSummary {
  id: string;
  studentId: string;
  displayName: string;
  email: string | null;
}

interface ChecklistTemplate {
  id: string;
  label: string;
  description: string | null;
  category: string;
  sortOrder: number;
  required: boolean;
  active: boolean;
}

interface ChecklistProgress {
  id: string;
  templateId: string;
  completed: boolean;
  completedAt: string | null;
  notes: string | null;
}

interface ModuleTemplate {
  id: string;
  label: string;
  description: string | null;
  required: boolean;
  active: boolean;
}

interface ModuleProgress {
  id: string;
  templateId: string;
  completedAt: string;
  notes: string | null;
}

interface EmploymentFollowUp {
  id: string;
  checkpointMonths: number;
  status: string;
  checkedAt: string;
  notes: string | null;
}

interface SpokesRecord {
  id: string;
  firstName: string;
  lastName: string;
  referralEmail: string | null;
  county: string | null;
  householdType: string | null;
  requiredParticipationHours: number | null;
  referralDate: string | null;
  status: string;
  enrolledAt: string | null;
  exitDate: string | null;
  gender: string | null;
  birthDate: string | null;
  race: string | null;
  ethnicity: string | null;
  barriersOnEntry: string[];
  barriersRemaining: string[];
  jobRetentionStudent: boolean;
  tabeDate: string | null;
  educationalLevel: string | null;
  documentedAcademicAchievementAt: string | null;
  highSchoolEquivalencyAt: string | null;
  familySurveyOfferedAt: string | null;
  postSecondaryEnteredAt: string | null;
  postSecondaryProgram: string | null;
  unsubsidizedEmploymentAt: string | null;
  employerName: string | null;
  hourlyWage: number | null;
  nonCompleterAt: string | null;
  nonCompleterReason: string | null;
  notes: string | null;
  checklistProgress: ChecklistProgress[];
  moduleProgress: ModuleProgress[];
  employmentFollowUps: EmploymentFollowUp[];
}

interface SummaryPayload {
  status: string;
  orientation: {
    done: number;
    total: number;
    isComplete: boolean;
  };
  programFiles: {
    done: number;
    total: number;
    isComplete: boolean;
  };
  modules: {
    done: number;
    total: number;
    isComplete: boolean;
  };
  referralLogged: boolean;
  enrolled: boolean;
  exited: boolean;
  familySurveyOffered: boolean;
  postSecondaryEntered: boolean;
  nonCompleter: boolean;
  employmentFollowUpsCompleted: number;
  employmentFollowUpsDue: number;
  employmentFollowUpSchedule: Array<{
    checkpointMonths: number;
    dueAt: string | null;
    status: "not_applicable" | "upcoming" | "due" | "completed";
    completed: boolean;
    followUp: EmploymentFollowUp | null;
  }>;
}

interface WorkspacePayload {
  student: StudentSummary;
  record: SpokesRecord;
  checklistTemplates: ChecklistTemplate[];
  moduleTemplates: ModuleTemplate[];
  summary: SummaryPayload;
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

function formatDateInput(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export default function SpokesStudentWorkspace({ studentId }: { studentId: string }) {
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [moduleDates, setModuleDates] = useState<Record<string, string>>({});
  const [savingChecklistId, setSavingChecklistId] = useState<string | null>(null);
  const [savingModuleId, setSavingModuleId] = useState<string | null>(null);
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [profileForm, setProfileForm] = useState({
    firstName: "",
    lastName: "",
    referralEmail: "",
    county: "",
    householdType: "",
    requiredParticipationHours: "",
    referralDate: "",
    status: "referred",
    enrolledAt: "",
    exitDate: "",
    gender: "",
    birthDate: "",
    race: "",
    ethnicity: "",
    barriersOnEntry: "",
    barriersRemaining: "",
    jobRetentionStudent: false,
    tabeDate: "",
    educationalLevel: "",
    documentedAcademicAchievementAt: "",
    highSchoolEquivalencyAt: "",
    familySurveyOfferedAt: "",
    postSecondaryEnteredAt: "",
    postSecondaryProgram: "",
    unsubsidizedEmploymentAt: "",
    employerName: "",
    hourlyWage: "",
    nonCompleterAt: "",
    nonCompleterReason: "",
    notes: "",
  });
  const [followUpForm, setFollowUpForm] = useState({
    checkpointMonths: "1",
    status: "employed",
    checkedAt: todayInputValue(),
    notes: "",
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/teacher/students/${studentId}/spokes`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not load the SPOKES record."));
      }

      setData(payload);
      setProfileForm({
        firstName: payload.record.firstName || "",
        lastName: payload.record.lastName || "",
        referralEmail: payload.record.referralEmail || "",
        county: payload.record.county || "",
        householdType: payload.record.householdType || "",
        requiredParticipationHours: payload.record.requiredParticipationHours?.toString() || "",
        referralDate: formatDateInput(payload.record.referralDate),
        status: payload.record.status || "referred",
        enrolledAt: formatDateInput(payload.record.enrolledAt),
        exitDate: formatDateInput(payload.record.exitDate),
        gender: payload.record.gender || "",
        birthDate: formatDateInput(payload.record.birthDate),
        race: payload.record.race || "",
        ethnicity: payload.record.ethnicity || "",
        barriersOnEntry: payload.record.barriersOnEntry?.join("\n") ?? "",
        barriersRemaining: payload.record.barriersRemaining?.join("\n") ?? "",
        jobRetentionStudent: Boolean(payload.record.jobRetentionStudent),
        tabeDate: formatDateInput(payload.record.tabeDate),
        educationalLevel: payload.record.educationalLevel || "",
        documentedAcademicAchievementAt: formatDateInput(payload.record.documentedAcademicAchievementAt),
        highSchoolEquivalencyAt: formatDateInput(payload.record.highSchoolEquivalencyAt),
        familySurveyOfferedAt: formatDateInput(payload.record.familySurveyOfferedAt),
        postSecondaryEnteredAt: formatDateInput(payload.record.postSecondaryEnteredAt),
        postSecondaryProgram: payload.record.postSecondaryProgram || "",
        unsubsidizedEmploymentAt: formatDateInput(payload.record.unsubsidizedEmploymentAt),
        employerName: payload.record.employerName || "",
        hourlyWage: payload.record.hourlyWage?.toString() || "",
        nonCompleterAt: formatDateInput(payload.record.nonCompleterAt),
        nonCompleterReason: payload.record.nonCompleterReason || "",
        notes: payload.record.notes || "",
      });
      setModuleDates(
        Object.fromEntries(
          payload.moduleTemplates.map((template: ModuleTemplate) => {
            const progress = payload.record.moduleProgress.find(
              (item: ModuleProgress) => item.templateId === template.id
            );
            return [template.id, formatDateInput(progress?.completedAt || todayInputValue())];
          })
        )
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the SPOKES record.");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSaveProfile() {
    setSavingProfile(true);
    try {
      const response = await fetch(`/api/teacher/students/${studentId}/spokes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profileForm,
          barriersOnEntry: profileForm.barriersOnEntry.split("\n").map(s => s.trim()).filter(Boolean),
          barriersRemaining: profileForm.barriersRemaining.split("\n").map(s => s.trim()).filter(Boolean),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not save the SPOKES record."));
      }

      setMessage("SPOKES record saved.");
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save the SPOKES record.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function toggleChecklist(templateId: string, completed: boolean) {
    setSavingChecklistId(templateId);
    try {
      const response = await fetch(`/api/teacher/students/${studentId}/spokes/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, completed }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not update checklist item."));
      }

      setMessage(completed ? "Checklist item completed." : "Checklist item reopened.");
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update checklist item.");
    } finally {
      setSavingChecklistId(null);
    }
  }

  async function saveModule(templateId: string) {
    setSavingModuleId(templateId);
    try {
      const response = await fetch(`/api/teacher/students/${studentId}/spokes/modules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          completedAt: moduleDates[templateId] || todayInputValue(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not record module completion."));
      }

      setMessage("Module completion saved.");
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not record module completion.");
    } finally {
      setSavingModuleId(null);
    }
  }

  async function removeModule(templateId: string) {
    setSavingModuleId(templateId);
    try {
      const response = await fetch(`/api/teacher/students/${studentId}/spokes/modules`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not remove module completion."));
      }

      setMessage("Module completion removed.");
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not remove module completion.");
    } finally {
      setSavingModuleId(null);
    }
  }

  async function saveFollowUp() {
    setSavingFollowUp(true);
    try {
      const response = await fetch(`/api/teacher/students/${studentId}/spokes/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(followUpForm),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not save the follow-up."));
      }

      setMessage("Employment follow-up saved.");
      setFollowUpForm({
        checkpointMonths: "1",
        status: "employed",
        checkedAt: todayInputValue(),
        notes: "",
      });
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save the follow-up.");
    } finally {
      setSavingFollowUp(false);
    }
  }

  async function removeFollowUp(checkpointMonths: number) {
    setSavingFollowUp(true);
    try {
      const response = await fetch(`/api/teacher/students/${studentId}/spokes/follow-up`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkpointMonths }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not remove the follow-up."));
      }

      setMessage("Employment follow-up removed.");
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not remove the follow-up.");
    } finally {
      setSavingFollowUp(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading SPOKES workspace...</p>;
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={() => void loadData()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-red-500">SPOKES record not found.</p>;
  }

  const payload = data;
  const orientationTemplates = payload.checklistTemplates.filter((template) => template.category === "orientation");
  const programFileTemplates = payload.checklistTemplates.filter((template) => template.category === "program_file");
  const countyOptions = payload.checklistTemplates
    .filter((template) => template.category === "county" && template.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  const checklistProgress = payload.record.checklistProgress;

  function renderChecklistSection(title: string, templates: ChecklistTemplate[]) {
    return (
      <div className="rounded-[1.25rem] border border-[var(--border-soft)] bg-white/70 p-4">
        <h3 className="text-sm font-semibold text-[var(--ink-strong)]">{title}</h3>
        <div className="mt-3 space-y-2">
          {templates.map((template) => {
            const progress = checklistProgress.find((item) => item.templateId === template.id);
            const completed = Boolean(progress?.completed);

            return (
              <label
                key={template.id}
                className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${
                  completed
                    ? "border-emerald-200 bg-emerald-50/80"
                    : "border-[var(--border-soft)] bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  checked={completed}
                  disabled={savingChecklistId === template.id}
                  onChange={() => void toggleChecklist(template.id, !completed)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--ink-strong)]">
                    {template.label}
                    {template.required ? <span className="ml-1 text-xs text-rose-500">*</span> : null}
                  </p>
                  {template.description ? (
                    <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{template.description}</p>
                  ) : null}
                </div>
                {progress?.completedAt ? (
                  <span className="text-[11px] uppercase tracking-[0.12em] text-emerald-700">
                    {formatDateInput(progress.completedAt)}
                  </span>
                ) : null}
              </label>
            );
          })}
          {templates.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">No items configured yet.</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link href={`/teacher/students/${studentId}`} className="text-sm text-[var(--accent-strong)] hover:text-[var(--ink-strong)]">
            ← Back to student detail
          </Link>
          <h1 className="mt-2 font-display text-3xl text-[var(--ink-strong)]">{payload.student.displayName}</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Official SPOKES record for {payload.student.studentId}
            {payload.student.email ? ` • ${payload.student.email}` : ""}
          </p>
        </div>
        <div className="rounded-[1rem] border border-[var(--border-soft)] bg-white/75 px-4 py-3 text-sm text-[var(--ink-muted)]">
          Status: <span className="font-semibold text-[var(--ink-strong)]">{payload.summary.status.replaceAll("_", " ")}</span>
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] px-4 py-3 text-sm text-[var(--ink-strong)]">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="surface-section p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Orientation</p>
          <p className="mt-2 text-3xl font-bold text-[var(--ink-strong)]">
            {payload.summary.orientation.done}/{payload.summary.orientation.total}
          </p>
        </div>
        <div className="surface-section p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Program files</p>
          <p className="mt-2 text-3xl font-bold text-[var(--ink-strong)]">
            {payload.summary.programFiles.done}/{payload.summary.programFiles.total}
          </p>
        </div>
        <div className="surface-section p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Required modules</p>
          <p className="mt-2 text-3xl font-bold text-[var(--ink-strong)]">
            {payload.summary.modules.done}/{payload.summary.modules.total}
          </p>
        </div>
        <div className="surface-section p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Employment follow-up</p>
          <p className="mt-2 text-3xl font-bold text-[var(--ink-strong)]">
            {payload.summary.employmentFollowUpsCompleted}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">{payload.summary.employmentFollowUpsDue} due now</p>
        </div>
      </div>

      <section className="surface-section p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Intake</p>
            <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Referral, enrollment, and outcomes</h2>
          </div>
          <button
            type="button"
            onClick={() => void handleSaveProfile()}
            disabled={savingProfile}
            className="rounded-xl bg-[var(--ink-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
          >
            {savingProfile ? "Saving..." : "Save Record"}
          </button>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-3">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Referral</h3>
            <input value={profileForm.firstName} onChange={(event) => setProfileForm((current) => ({ ...current, firstName: event.target.value }))} placeholder="First name" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input value={profileForm.lastName} onChange={(event) => setProfileForm((current) => ({ ...current, lastName: event.target.value }))} placeholder="Last name" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input value={profileForm.referralEmail} onChange={(event) => setProfileForm((current) => ({ ...current, referralEmail: event.target.value }))} placeholder="Referral email" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            {countyOptions.length > 0 ? (
              <select
                value={profileForm.county}
                onChange={(event) => setProfileForm((current) => ({ ...current, county: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              >
                <option value="">Select county</option>
                {profileForm.county && !countyOptions.some((option) => option.label === profileForm.county) ? (
                  <option value={profileForm.county}>{profileForm.county}</option>
                ) : null}
                {countyOptions.map((option) => (
                  <option key={option.id} value={option.label}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input value={profileForm.county} onChange={(event) => setProfileForm((current) => ({ ...current, county: event.target.value }))} placeholder="County" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={profileForm.householdType} onChange={(event) => setProfileForm((current) => ({ ...current, householdType: event.target.value }))} placeholder="Household (1P/2P)" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
              <input value={profileForm.requiredParticipationHours} onChange={(event) => setProfileForm((current) => ({ ...current, requiredParticipationHours: event.target.value }))} placeholder="Required hours" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            </div>
            <input type="date" value={profileForm.referralDate} onChange={(event) => setProfileForm((current) => ({ ...current, referralDate: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <select value={profileForm.status} onChange={(event) => setProfileForm((current) => ({ ...current, status: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]">
              <option value="referred">Referred</option>
              <option value="enrolled">Enrolled</option>
              <option value="completed">Completed</option>
              <option value="exited">Exited</option>
              <option value="non_completer">Non-completer</option>
            </select>
            <input type="date" value={profileForm.enrolledAt} onChange={(event) => setProfileForm((current) => ({ ...current, enrolledAt: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input type="date" value={profileForm.exitDate} onChange={(event) => setProfileForm((current) => ({ ...current, exitDate: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Profile & barriers</h3>
            <input value={profileForm.gender} onChange={(event) => setProfileForm((current) => ({ ...current, gender: event.target.value }))} placeholder="Gender" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input type="date" value={profileForm.birthDate} onChange={(event) => setProfileForm((current) => ({ ...current, birthDate: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input value={profileForm.race} onChange={(event) => setProfileForm((current) => ({ ...current, race: event.target.value }))} placeholder="Race" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input value={profileForm.ethnicity} onChange={(event) => setProfileForm((current) => ({ ...current, ethnicity: event.target.value }))} placeholder="Ethnicity" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <textarea value={profileForm.barriersOnEntry} onChange={(event) => setProfileForm((current) => ({ ...current, barriersOnEntry: event.target.value }))} placeholder="Barriers on entry (one per line)" rows={3} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <input type="checkbox" checked={profileForm.jobRetentionStudent} onChange={(event) => setProfileForm((current) => ({ ...current, jobRetentionStudent: event.target.checked }))} />
              Job retention student
            </label>
            <input type="date" value={profileForm.tabeDate} onChange={(event) => setProfileForm((current) => ({ ...current, tabeDate: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input value={profileForm.educationalLevel} onChange={(event) => setProfileForm((current) => ({ ...current, educationalLevel: event.target.value }))} placeholder="Educational level / TABE level" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <textarea value={profileForm.barriersRemaining} onChange={(event) => setProfileForm((current) => ({ ...current, barriersRemaining: event.target.value }))} placeholder="Barriers remaining on exit (one per line)" rows={3} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Outcomes & follow-through</h3>
            <input type="date" value={profileForm.documentedAcademicAchievementAt} onChange={(event) => setProfileForm((current) => ({ ...current, documentedAcademicAchievementAt: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input type="date" value={profileForm.highSchoolEquivalencyAt} onChange={(event) => setProfileForm((current) => ({ ...current, highSchoolEquivalencyAt: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input type="date" value={profileForm.familySurveyOfferedAt} onChange={(event) => setProfileForm((current) => ({ ...current, familySurveyOfferedAt: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input type="date" value={profileForm.postSecondaryEnteredAt} onChange={(event) => setProfileForm((current) => ({ ...current, postSecondaryEnteredAt: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input value={profileForm.postSecondaryProgram} onChange={(event) => setProfileForm((current) => ({ ...current, postSecondaryProgram: event.target.value }))} placeholder="Post-secondary school or training" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input type="date" value={profileForm.unsubsidizedEmploymentAt} onChange={(event) => setProfileForm((current) => ({ ...current, unsubsidizedEmploymentAt: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input value={profileForm.employerName} onChange={(event) => setProfileForm((current) => ({ ...current, employerName: event.target.value }))} placeholder="Employer name" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input value={profileForm.hourlyWage} onChange={(event) => setProfileForm((current) => ({ ...current, hourlyWage: event.target.value }))} placeholder="Hourly wage" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <input type="date" value={profileForm.nonCompleterAt} onChange={(event) => setProfileForm((current) => ({ ...current, nonCompleterAt: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <textarea value={profileForm.nonCompleterReason} onChange={(event) => setProfileForm((current) => ({ ...current, nonCompleterReason: event.target.value }))} placeholder="Non-completer notes" rows={2} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
            <textarea value={profileForm.notes} onChange={(event) => setProfileForm((current) => ({ ...current, notes: event.target.value }))} placeholder="General SPOKES notes" rows={3} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]" />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="surface-section p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Checklist</p>
          <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Orientation and program files</h2>
          <div className="mt-5 space-y-4">
            {renderChecklistSection("Orientation items", orientationTemplates)}
            {renderChecklistSection("Program files", programFileTemplates)}
          </div>
        </section>

        <section className="surface-section p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Modules</p>
          <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Required SPOKES modules</h2>
          <div className="mt-5 space-y-3">
            {payload.moduleTemplates.map((template) => {
              const progress = payload.record.moduleProgress.find((item) => item.templateId === template.id);

              return (
                <div key={template.id} className="rounded-[1rem] border border-[var(--border-soft)] p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink-strong)]">{template.label}</p>
                      {template.description ? (
                        <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{template.description}</p>
                      ) : null}
                    </div>
                    {progress ? (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                        Completed {formatDateInput(progress.completedAt)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        Not completed
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <input
                      type="date"
                      value={moduleDates[template.id] || todayInputValue()}
                      onChange={(event) =>
                        setModuleDates((current) => ({ ...current, [template.id]: event.target.value }))
                      }
                      className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                    />
                    <button
                      type="button"
                      onClick={() => void saveModule(template.id)}
                      disabled={savingModuleId === template.id}
                      className="rounded-xl bg-[var(--ink-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
                    >
                      {progress ? "Update completion" : "Mark complete"}
                    </button>
                    {progress ? (
                      <button
                        type="button"
                        onClick={() => void removeModule(template.id)}
                        disabled={savingModuleId === template.id}
                        className="rounded-xl border border-rose-200 px-4 py-2 text-sm text-rose-800 transition hover:bg-rose-50 disabled:opacity-60"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {payload.moduleTemplates.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">No SPOKES modules configured yet.</p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="surface-section p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Exit follow-through</p>
            <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Employment follow-up</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              Record the 1-, 3-, and 6-month check-ins required after unsubsidized employment.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[1.25rem] border border-[var(--border-soft)] bg-white/70 p-4">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Schedule</h3>
            <div className="mt-3 space-y-3">
              {payload.summary.employmentFollowUpSchedule.map((item) => (
                <div key={item.checkpointMonths} className="rounded-xl border border-[var(--border-soft)] p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink-strong)]">{item.checkpointMonths}-month follow-up</p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        {item.dueAt ? `Due ${formatDateInput(item.dueAt)}` : "Available after employment is recorded"}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        item.status === "completed"
                          ? "bg-emerald-100 text-emerald-700"
                          : item.status === "due"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {item.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  {item.followUp ? (
                    <div className="mt-3 flex items-center gap-3 flex-wrap text-sm text-[var(--ink-muted)]">
                      <span>{formatDateInput(item.followUp.checkedAt)}</span>
                      <span className="font-medium text-[var(--ink-strong)]">{item.followUp.status}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setFollowUpForm({
                            checkpointMonths: String(item.checkpointMonths),
                            status: item.followUp?.status || "employed",
                            checkedAt: formatDateInput(item.followUp?.checkedAt || todayInputValue()),
                            notes: item.followUp?.notes || "",
                          })
                        }
                        className="text-xs text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeFollowUp(item.checkpointMonths)}
                        className="text-xs text-rose-600 hover:text-rose-800"
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.25rem] border border-[var(--border-soft)] bg-white/70 p-4">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Record a follow-up</h3>
            <div className="mt-3 grid gap-3">
              <select
                value={followUpForm.checkpointMonths}
                onChange={(event) => setFollowUpForm((current) => ({ ...current, checkpointMonths: event.target.value }))}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              >
                <option value="1">1-month</option>
                <option value="3">3-month</option>
                <option value="6">6-month</option>
              </select>
              <select
                value={followUpForm.status}
                onChange={(event) => setFollowUpForm((current) => ({ ...current, status: event.target.value }))}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              >
                <option value="employed">Employed</option>
                <option value="unemployed">Unemployed</option>
              </select>
              <input
                type="date"
                value={followUpForm.checkedAt}
                onChange={(event) => setFollowUpForm((current) => ({ ...current, checkedAt: event.target.value }))}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <textarea
                value={followUpForm.notes}
                onChange={(event) => setFollowUpForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Follow-up notes"
                rows={3}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <button
                type="button"
                onClick={() => void saveFollowUp()}
                disabled={savingFollowUp}
                className="rounded-xl bg-[var(--ink-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
              >
                {savingFollowUp ? "Saving..." : "Save Follow-Up"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
