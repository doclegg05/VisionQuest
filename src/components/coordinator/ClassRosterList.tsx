"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";

interface RosterStudent {
  id: string;
  displayName: string;
  enrolledAt: string;
  orientationComplete: boolean;
  goalsSet: number;
  goalsAchieved: number;
}

type RosterState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; students: RosterStudent[] };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ClassRosterList({ classId, className }: { classId: string; className: string }) {
  const [loaded, setLoaded] = useState<{ classId: string; state: RosterState }>({
    classId,
    state: { status: "loading" },
  });

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ data: { students: RosterStudent[] } }>(`/api/coordinator/drilldown/classes/${classId}`)
      .then((res) => {
        if (!cancelled) setLoaded({ classId, state: { status: "ready", students: res.data.students } });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ classId, state: { status: "error" } });
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  // A result for a different class means the new one is still loading.
  const state: RosterState = loaded.classId === classId ? loaded.state : { status: "loading" };

  return (
    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
      <h3 className="font-semibold text-[var(--ink-strong)]">{className}: students</h3>
      {state.status === "loading" && <p className="mt-2 text-sm text-[var(--ink-muted)]">Loading students…</p>}
      {state.status === "error" && (
        <p className="mt-2 text-sm text-danger" role="alert">
          We could not load this class. Try again.
        </p>
      )}
      {state.status === "ready" && state.students.length === 0 && (
        <p className="mt-2 text-sm text-[var(--ink-muted)]">No students are in this class yet.</p>
      )}
      {state.status === "ready" && state.students.length > 0 && (
        <ul className="mt-3 space-y-2">
          {state.students.map((student) => (
            <li key={student.id} className="rounded-lg bg-[var(--surface-raised)] p-3">
              <p className="font-semibold text-[var(--ink-strong)]">{student.displayName}</p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Joined {formatDate(student.enrolledAt)} · Orientation{" "}
                {student.orientationComplete ? "done" : "not done"} · {student.goalsAchieved} of{" "}
                {student.goalsSet} goals reached
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
