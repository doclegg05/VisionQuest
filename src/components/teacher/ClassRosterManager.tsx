"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ClassRequirementEditor from "./ClassRequirementEditor";

interface InstructorOption {
  id: string;
  studentId: string;
  displayName: string;
  email: string | null;
}

interface ClassSummary {
  id: string;
  name: string;
  code: string;
  status: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  instructors: InstructorOption[];
  activeEnrollmentCount: number;
  archivedEnrollmentCount: number;
}

interface ClassEnrollment {
  id: string;
  status: string;
  enrolledAt: string;
  archivedAt: string | null;
  archiveReason: string | null;
  student: {
    id: string;
    studentId: string;
    displayName: string;
    email: string | null;
    isActive: boolean;
  };
}

interface ClassDetail {
  id: string;
  name: string;
  code: string;
  status: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  instructors: InstructorOption[];
  enrollments: ClassEnrollment[];
}

interface ClassesResponse {
  classes: ClassSummary[];
  availableInstructors: InstructorOption[];
}

interface ClassDetailResponse {
  class: ClassDetail;
}

function formatWhen(value: string | null) {
  if (!value) return "Not set";
  return new Date(value).toLocaleDateString();
}

export default function ClassRosterManager() {
  const adminMode = true; // Teachers and admins have the same access level
  const searchParams = useSearchParams();
  const requestedClassId = searchParams.get("classId")?.trim() || "";
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [availableInstructors, setAvailableInstructors] = useState<InstructorOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [classDetail, setClassDetail] = useState<ClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingClass, setCreatingClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [newClassCode, setNewClassCode] = useState("");
  const [newClassDescription, setNewClassDescription] = useState("");
  const [newClassStartDate, setNewClassStartDate] = useState("");
  const [newClassEndDate, setNewClassEndDate] = useState("");
  const [newInstructorIds, setNewInstructorIds] = useState<string[]>([]);
  const [className, setClassName] = useState("");
  const [classCode, setClassCode] = useState("");
  const [classDescription, setClassDescription] = useState("");
  const [classStartDate, setClassStartDate] = useState("");
  const [classEndDate, setClassEndDate] = useState("");
  const [selectedInstructorIds, setSelectedInstructorIds] = useState<string[]>([]);

  // Create student form state
  const [newStudentUsername, setNewStudentUsername] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [newStudentEmail, setNewStudentEmail] = useState("");
  const [newStudentPassword, setNewStudentPassword] = useState("");
  const [createdCredentials, setCreatedCredentials] = useState<{ username: string; password: string } | null>(null);

  async function loadClasses(preferredClassId?: string) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/teacher/classes${adminMode ? "?includeArchived=true" : ""}`);
      if (response.status === 401 || response.status === 403) {
        window.location.reload();
        return;
      }
      const payload = (await response.json()) as ClassesResponse;
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || "Could not load classes.");
      }

      setClasses(payload.classes || []);
      setAvailableInstructors(payload.availableInstructors || []);

      const nextClassId =
        preferredClassId && payload.classes.some((item) => item.id === preferredClassId)
          ? preferredClassId
          : selectedClassId && payload.classes.some((item) => item.id === selectedClassId)
            ? selectedClassId
            : payload.classes[0]?.id || "";

      setSelectedClassId(nextClassId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load classes.");
      setClasses([]);
      setAvailableInstructors([]);
      setSelectedClassId("");
    } finally {
      setLoading(false);
    }
  }

  async function loadClassDetail(classId: string) {
    if (!classId) {
      setClassDetail(null);
      return;
    }

    setDetailLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/teacher/classes/${classId}`);
      if (response.status === 401 || response.status === 403) {
        window.location.reload();
        return;
      }
      const payload = (await response.json()) as ClassDetailResponse;
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || "Could not load class details.");
      }

      setClassDetail(payload.class);
      setClassName(payload.class.name);
      setClassCode(payload.class.code);
      setClassDescription(payload.class.description || "");
      setClassStartDate(payload.class.startDate ? payload.class.startDate.slice(0, 10) : "");
      setClassEndDate(payload.class.endDate ? payload.class.endDate.slice(0, 10) : "");
      setSelectedInstructorIds(payload.class.instructors.map((instructor) => instructor.id));
    } catch (err) {
      setClassDetail(null);
      setError(err instanceof Error ? err.message : "Could not load class details.");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadClasses(requestedClassId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminMode, requestedClassId]);

  useEffect(() => {
    void loadClassDetail(selectedClassId);
  }, [selectedClassId]);

  async function createStudent() {
    if (!selectedClassId) return;

    setSaving(true);
    setError("");
    setMessage("");
    setCreatedCredentials(null);

    try {
      const response = await fetch(`/api/teacher/classes/${selectedClassId}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: newStudentUsername,
          displayName: newStudentName,
          email: newStudentEmail || undefined,
          password: newStudentPassword,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not create the student account.");
      }

      setCreatedCredentials({ username: newStudentUsername, password: newStudentPassword });
      setMessage(`Account created for ${newStudentName}.`);
      setNewStudentUsername("");
      setNewStudentName("");
      setNewStudentEmail("");
      setNewStudentPassword("");
      await loadClassDetail(selectedClassId);
      await loadClasses(selectedClassId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the student account.");
    } finally {
      setSaving(false);
    }
  }

  async function updateEnrollmentStatus(
    enrollmentId: string,
    status: "active" | "inactive" | "archived",
  ) {
    if (!selectedClassId) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/teacher/classes/${selectedClassId}/enrollments/${enrollmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          archiveReason: status === "archived" ? "Archived from class roster." : "",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not update the class enrollment.");
      }

      setMessage(
        status === "archived"
          ? "Student archived from this class."
          : status === "inactive"
            ? "Student marked inactive for this class."
            : "Student restored to active status in this class.",
      );
      await loadClassDetail(selectedClassId);
      await loadClasses(selectedClassId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the class enrollment.");
    } finally {
      setSaving(false);
    }
  }

  async function createClass() {
    setCreatingClass(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/teacher/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newClassName,
          code: newClassCode,
          description: newClassDescription,
          startDate: newClassStartDate || null,
          endDate: newClassEndDate || null,
          instructorIds: newInstructorIds,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not create the class.");
      }

      setMessage("Class created.");
      setNewClassName("");
      setNewClassCode("");
      setNewClassDescription("");
      setNewClassStartDate("");
      setNewClassEndDate("");
      setNewInstructorIds([]);
      await loadClasses(payload?.class?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the class.");
    } finally {
      setCreatingClass(false);
    }
  }

  async function saveClassSettings() {
    if (!selectedClassId) return;

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/teacher/classes/${selectedClassId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: className,
          code: classCode,
          description: classDescription,
          status: classDetail?.status || "active",
          startDate: classStartDate || null,
          endDate: classEndDate || null,
          instructorIds: selectedInstructorIds,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not save the class settings.");
      }

      setMessage("Class settings updated.");
      await loadClasses(selectedClassId);
      await loadClassDetail(selectedClassId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the class settings.");
    } finally {
      setSaving(false);
    }
  }

  async function updateClassStatus(status: "active" | "archived") {
    if (!selectedClassId) return;

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/teacher/classes/${selectedClassId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: className,
          code: classCode,
          description: classDescription,
          status,
          startDate: classStartDate || null,
          endDate: classEndDate || null,
          instructorIds: selectedInstructorIds,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not update class status.");
      }

      setMessage(status === "archived" ? "Class archived." : "Class reactivated.");
      await loadClasses(selectedClassId);
      await loadClassDetail(selectedClassId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update class status.");
    } finally {
      setSaving(false);
    }
  }

  function toggleInstructor(instructorId: string) {
    setSelectedInstructorIds((current) =>
      current.includes(instructorId)
        ? current.filter((id) => id !== instructorId)
        : [...current, instructorId],
    );
  }

  function toggleNewInstructor(instructorId: string) {
    setNewInstructorIds((current) =>
      current.includes(instructorId)
        ? current.filter((id) => id !== instructorId)
        : [...current, instructorId],
    );
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading classes...</p>;
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="surface-section border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="surface-section border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] p-4 text-sm text-[var(--ink-strong)]">
          {message}
        </div>
      ) : null}

      {adminMode ? (
        <div className="surface-section space-y-4 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Admin</p>
            <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Create a class</h2>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Classes organize students and instructors. Create student accounts from the class roster below.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={newClassName}
              onChange={(event) => setNewClassName(event.target.value)}
              placeholder="Class name"
              className="field px-4 py-3 text-sm"
            />
            <input
              value={newClassCode}
              onChange={(event) => setNewClassCode(event.target.value)}
              placeholder="Class code"
              className="field px-4 py-3 text-sm"
            />
            <input
              type="date"
              value={newClassStartDate}
              onChange={(event) => setNewClassStartDate(event.target.value)}
              className="field px-4 py-3 text-sm"
            />
            <input
              type="date"
              value={newClassEndDate}
              onChange={(event) => setNewClassEndDate(event.target.value)}
              className="field px-4 py-3 text-sm"
            />
          </div>
          <textarea
            value={newClassDescription}
            onChange={(event) => setNewClassDescription(event.target.value)}
            placeholder="Class description"
            rows={3}
            className="field px-4 py-3 text-sm"
          />
          <div className="rounded-2xl border border-[rgba(18,38,63,0.08)] p-4">
            <p className="text-sm font-semibold text-[var(--ink-strong)]">Assign instructors</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {availableInstructors.map((instructor) => (
                <label key={instructor.id} className="flex items-center gap-3 rounded-xl border border-[rgba(18,38,63,0.08)] px-3 py-2 text-sm text-[var(--ink-strong)]">
                  <input
                    type="checkbox"
                    checked={newInstructorIds.includes(instructor.id)}
                    onChange={() => toggleNewInstructor(instructor.id)}
                  />
                  <span>{instructor.displayName}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void createClass()}
            disabled={creatingClass}
            className="primary-button px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingClass ? "Creating..." : "Create Class"}
          </button>
        </div>
      ) : null}

      <div className="surface-section space-y-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              {adminMode ? "Admin settings" : "Teacher roster"}
            </p>
            <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Class roster</h2>
          </div>
          <label className="min-w-[18rem]">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Select class
            </span>
            <select
              value={selectedClassId}
              onChange={(event) => setSelectedClassId(event.target.value)}
              className="field w-full px-4 py-3 text-sm"
            >
              {classes.length === 0 ? <option value="">No classes yet</option> : null}
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.code})
                </option>
              ))}
            </select>
          </label>
        </div>

        {detailLoading ? (
          <p className="text-sm text-[var(--ink-muted)]">Loading class details...</p>
        ) : classDetail ? (
          <div className="space-y-5">
            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-[rgba(18,38,63,0.08)] bg-[rgba(255,255,255,0.55)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-2xl text-[var(--ink-strong)]">{classDetail.name}</h3>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      {classDetail.code} • {classDetail.status}
                    </p>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      Starts {formatWhen(classDetail.startDate)} • Ends {formatWhen(classDetail.endDate)}
                    </p>
                  </div>
                  {adminMode ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void saveClassSettings()}
                        disabled={saving}
                        className="rounded-full border border-[rgba(18,38,63,0.12)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Save Settings
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateClassStatus(classDetail.status === "archived" ? "active" : "archived")}
                        disabled={saving}
                        className="rounded-full border border-[rgba(18,38,63,0.12)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {classDetail.status === "archived" ? "Reactivate Class" : "Archive Class"}
                      </button>
                    </div>
                  ) : null}
                </div>

                {adminMode ? (
                  <div className="mt-4 space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        value={className}
                        onChange={(event) => setClassName(event.target.value)}
                        className="field px-4 py-3 text-sm"
                      />
                      <input
                        value={classCode}
                        onChange={(event) => setClassCode(event.target.value)}
                        className="field px-4 py-3 text-sm"
                      />
                      <input
                        type="date"
                        value={classStartDate}
                        onChange={(event) => setClassStartDate(event.target.value)}
                        className="field px-4 py-3 text-sm"
                      />
                      <input
                        type="date"
                        value={classEndDate}
                        onChange={(event) => setClassEndDate(event.target.value)}
                        className="field px-4 py-3 text-sm"
                      />
                    </div>
                    <textarea
                      value={classDescription}
                      onChange={(event) => setClassDescription(event.target.value)}
                      rows={3}
                      className="field px-4 py-3 text-sm"
                    />
                    <div className="grid gap-2 md:grid-cols-2">
                      {availableInstructors.map((instructor) => (
                        <label key={instructor.id} className="flex items-center gap-3 rounded-xl border border-[rgba(18,38,63,0.08)] px-3 py-2 text-sm text-[var(--ink-strong)]">
                          <input
                            type="checkbox"
                            checked={selectedInstructorIds.includes(instructor.id)}
                            onChange={() => toggleInstructor(instructor.id)}
                          />
                          <span>{instructor.displayName}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Instructors</p>
                    <p className="mt-2 text-sm text-[var(--ink-strong)]">
                      {classDetail.instructors.map((instructor) => instructor.displayName).join(", ") || "No instructors assigned"}
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-[rgba(18,38,63,0.08)] bg-[rgba(255,255,255,0.55)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Add student</p>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">Create an account and enroll in this class.</p>
                <div className="mt-3 space-y-3">
                  <input
                    value={newStudentName}
                    onChange={(event) => setNewStudentName(event.target.value)}
                    placeholder="Name"
                    className="field px-4 py-3 text-sm"
                  />
                  <input
                    value={newStudentUsername}
                    onChange={(event) => setNewStudentUsername(event.target.value)}
                    placeholder="Username"
                    className="field px-4 py-3 text-sm"
                  />
                  <input
                    value={newStudentEmail}
                    onChange={(event) => setNewStudentEmail(event.target.value)}
                    placeholder="Email (optional)"
                    type="email"
                    className="field px-4 py-3 text-sm"
                  />
                  <input
                    value={newStudentPassword}
                    onChange={(event) => setNewStudentPassword(event.target.value)}
                    placeholder="Password"
                    type="text"
                    autoComplete="off"
                    className="field px-4 py-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void createStudent()}
                    disabled={saving || classDetail.status === "archived"}
                    className="primary-button w-full px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Create Account
                  </button>
                  {createdCredentials ? (
                    <div className="rounded-xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] p-3 text-sm text-[var(--ink-strong)]">
                      <p className="font-semibold">Account created — share these credentials:</p>
                      <div className="mt-2 space-y-1 font-mono text-sm">
                        <p>Username: <span className="font-semibold">{createdCredentials.username}</span></p>
                        <p>Password: <span className="font-semibold">{createdCredentials.password}</span></p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[rgba(18,38,63,0.08)] bg-[rgba(255,255,255,0.55)] p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Requirements</p>
                <h3 className="mt-2 font-display text-xl text-[var(--ink-strong)]">Requirement Matrix</h3>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  Define which certifications and courses are required, optional, or not applicable for this class.
                </p>
              </div>
              <div className="mt-4">
                <ClassRequirementEditor classId={classDetail.id} />
              </div>
            </div>

            <div className="rounded-2xl border border-[rgba(18,38,63,0.08)] bg-[rgba(255,255,255,0.55)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Roster</p>
                  <h3 className="mt-2 font-display text-xl text-[var(--ink-strong)]">Students in this class</h3>
                </div>
                <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-3 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                  {classDetail.enrollments.length} total
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {classDetail.enrollments.length === 0 ? (
                  <p className="text-sm text-[var(--ink-muted)]">No students enrolled in this class yet. Use the form above to create student accounts.</p>
                ) : (
                  classDetail.enrollments.map((enrollment) => (
                    <div key={enrollment.id} className="rounded-xl border border-[rgba(18,38,63,0.08)] px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--ink-strong)]">{enrollment.student.displayName}</p>
                          <p className="mt-1 text-sm text-[var(--ink-muted)]">
                            {enrollment.student.studentId} {enrollment.student.email ? `• ${enrollment.student.email}` : ""}
                          </p>
                          <p className="mt-1 text-xs text-[var(--ink-muted)]">
                            Enrolled {new Date(enrollment.enrolledAt).toLocaleDateString()}
                            {enrollment.archivedAt ? ` • Archived ${new Date(enrollment.archivedAt).toLocaleDateString()}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-3 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                            {enrollment.status}
                          </span>
                          {enrollment.status === "archived" ? (
                            <button
                              type="button"
                              onClick={() => void updateEnrollmentStatus(enrollment.id, "active")}
                              disabled={saving}
                              className="rounded-full border border-[rgba(18,38,63,0.12)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Restore
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => void updateEnrollmentStatus(enrollment.id, enrollment.status === "inactive" ? "active" : "inactive")}
                                disabled={saving}
                                className="rounded-full border border-[rgba(18,38,63,0.12)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {enrollment.status === "inactive" ? "Mark Active" : "Mark Inactive"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void updateEnrollmentStatus(enrollment.id, "archived")}
                                disabled={saving}
                                className="rounded-full border border-[rgba(18,38,63,0.12)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Archive
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--ink-muted)]">
            {classes.length === 0
              ? adminMode
                ? "Create your first class to start adding students."
                : "No classes are assigned to your account yet."
              : "Select a class to load the roster."}
          </p>
        )}
      </div>
    </div>
  );
}
