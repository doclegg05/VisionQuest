"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import OrientationChecklist from "@/components/orientation/OrientationChecklist";
import ResourceLibrary from "@/components/resources/ResourceLibrary";

interface ManagedClass {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface ManagedStudent {
  id: string;
  studentId: string;
  displayName: string;
  email: string | null;
  isActive: boolean;
  enrollmentStatus: string;
}

interface TeacherClassesResponse {
  classes: ManagedClass[];
}

interface TeacherClassDetailResponse {
  class: {
    id: string;
    name: string;
    code: string;
    enrollments: Array<{
      id: string;
      status: string;
      student: {
        id: string;
        studentId: string;
        displayName: string;
        email: string | null;
        isActive: boolean;
      };
    }>;
  };
}

export default function TeacherOrientationWorkspace() {
  const searchParams = useSearchParams();
  const requestedClassId = searchParams.get("classId")?.trim() || "";
  const requestedStudentId = searchParams.get("studentId")?.trim() || "";
  const [classes, setClasses] = useState<ManagedClass[]>([]);
  const [currentClassId, setCurrentClassId] = useState("");
  const [students, setStudents] = useState<ManagedStudent[]>([]);
  const [currentStudentId, setCurrentStudentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [studentLoading, setStudentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchRoster(classId: string): Promise<ManagedStudent[]> {
    const response = await fetch(`/api/teacher/classes/${encodeURIComponent(classId)}`);
    if (!response.ok) {
      throw new Error("Could not load class roster.");
    }

    const data = (await response.json()) as TeacherClassDetailResponse;
    return data.class.enrollments
      .filter((entry) => entry.status !== "archived")
      .map((entry) => ({
        ...entry.student,
        enrollmentStatus: entry.status,
      }));
  }

  useEffect(() => {
    let cancelled = false;

    async function loadClasses() {
      try {
        setLoading(true);
        const response = await fetch("/api/teacher/classes");
        if (!response.ok) throw new Error("Could not load classes.");

        const data = (await response.json()) as TeacherClassesResponse;
        if (cancelled) return;

        const availableClasses = data.classes.filter((item) => item.status !== "archived");
        setClasses(availableClasses);
        setCurrentClassId((prev) => {
          if (prev) return prev;
          if (requestedClassId && availableClasses.some((item) => item.id === requestedClassId)) {
            return requestedClassId;
          }
          return availableClasses[0]?.id || "";
        });
        setError(null);
      } catch {
        if (!cancelled) setError("Could not load your classes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadClasses();

    return () => {
      cancelled = true;
    };
  }, [requestedClassId]);

  useEffect(() => {
    if (!currentClassId) {
      setStudents([]);
      setCurrentStudentId("");
      return;
    }

    let cancelled = false;

    async function loadStudents() {
      try {
        setStudentLoading(true);
        const roster = await fetchRoster(currentClassId);
        if (cancelled) return;

        setStudents(roster);

        const hasRequestedStudent = requestedStudentId
          ? roster.some((student) => student.id === requestedStudentId)
          : false;

        if (hasRequestedStudent) {
          setCurrentStudentId(requestedStudentId);
          setError(null);
          return;
        }

        if (requestedStudentId && !requestedClassId) {
          for (const managedClass of classes) {
            if (managedClass.id === currentClassId) continue;

            const nextRoster = await fetchRoster(managedClass.id);
            if (cancelled) return;

            if (nextRoster.some((student) => student.id === requestedStudentId)) {
              setCurrentClassId(managedClass.id);
              setStudents(nextRoster);
              setCurrentStudentId(requestedStudentId);
              setError(null);
              return;
            }
          }
        }

        setCurrentStudentId((prev) => {
          if (prev && roster.some((student) => student.id === prev)) {
            return prev;
          }
          return roster[0]?.id || "";
        });
        setError(null);
      } catch {
        if (!cancelled) setError("Could not load the class roster.");
      } finally {
        if (!cancelled) setStudentLoading(false);
      }
    }

    void loadStudents();

    return () => {
      cancelled = true;
    };
  }, [classes, currentClassId, requestedClassId, requestedStudentId]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === currentStudentId) || null,
    [students, currentStudentId],
  );

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading orientation workspace...</p>;
  }

  if (error && classes.length === 0) {
    return (
      <div className="surface-section px-6 py-10 text-center">
        <p className="mb-4 text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (classes.length === 0) {
    return (
      <div className="surface-section px-6 py-10 text-center">
        <p className="text-sm text-[var(--ink-muted)]">You do not have any active classes yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="surface-section p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Class
            </span>
            <select
              value={currentClassId}
              onChange={(event) => setCurrentClassId(event.target.value)}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]/80 px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent-secondary)]/40"
            >
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.code})
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Student
            </span>
            <select
              value={currentStudentId}
              onChange={(event) => setCurrentStudentId(event.target.value)}
              disabled={studentLoading || students.length === 0}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]/80 px-4 py-3 text-sm text-[var(--ink-strong)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent-secondary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.displayName} ({student.studentId})
                </option>
              ))}
            </select>
          </label>

          {selectedStudent ? (
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Link
                href={`/teacher/students/${selectedStudent.id}`}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
              >
                Open record
              </Link>
              <Link
                href={`/teacher/students/${selectedStudent.id}#submitted-forms`}
                className="rounded-full border border-[rgba(15,154,146,0.2)] bg-[rgba(15,154,146,0.08)] px-4 py-2 text-xs font-semibold text-[var(--accent-secondary)] transition-colors hover:bg-[rgba(15,154,146,0.14)]"
              >
                Submitted forms
              </Link>
              <Link
                href={`/teacher/students/${selectedStudent.id}#goal-plans`}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)]"
              >
                Goals
              </Link>
            </div>
          ) : null}
        </div>

        {selectedStudent ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--ink-muted)]">
            Actions in this workspace are applied to{" "}
            <span className="font-semibold text-[var(--ink-strong)]">
              {selectedStudent.displayName}
            </span>
            {" "}({selectedStudent.studentId}).
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </div>

      {!selectedStudent ? (
        <div className="surface-section px-6 py-10 text-center">
          <p className="text-sm text-[var(--ink-muted)]">
            Select a student to manage orientation.
          </p>
        </div>
      ) : (
        <>
          <div className="surface-section p-5">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Orientation checklist
              </p>
              <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">
                Complete Orientation for {selectedStudent.displayName}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
                This mirrors the student orientation checklist, but every change is saved directly to the selected student&apos;s record.
              </p>
            </div>

            <OrientationChecklist
              key={`orientation-${selectedStudent.id}`}
              targetStudentId={selectedStudent.id}
              emptyStateHint="Create orientation items in Manage Content before using this workspace."
            />
          </div>

          <div className="surface-section p-5">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Action forms
              </p>
              <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">
                Orientation Forms
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
                Open, download, upload, and re-upload onboarding forms on behalf of the selected student.
              </p>
            </div>

            <ResourceLibrary
              key={`forms-${selectedStudent.id}`}
              categories={["onboarding"]}
              targetStudentId={selectedStudent.id}
              helperText={`Uploads save to ${selectedStudent.displayName}'s record.`}
              helperHref={`/teacher/students/${selectedStudent.id}#submitted-forms`}
              helperLabel="Open student forms →"
            />
          </div>
        </>
      )}
    </div>
  );
}
