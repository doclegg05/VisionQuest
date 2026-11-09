"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { ClassRosterList } from "./ClassRosterList";

interface DrilldownInstructor {
  id: string;
  displayName: string;
  classes: Array<{ id: string; name: string; activeStudents: number }>;
}

type OverviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; instructors: DrilldownInstructor[] };

export function RegionDrilldown({ regionId }: { regionId: string }) {
  const [loaded, setLoaded] = useState<{ regionId: string; state: OverviewState }>({
    regionId,
    state: { status: "loading" },
  });
  const [selected, setSelected] = useState<{ regionId: string; id: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ data: { instructors: DrilldownInstructor[] } }>(`/api/coordinator/drilldown/regions/${regionId}`)
      .then((res) => {
        if (!cancelled) setLoaded({ regionId, state: { status: "ready", instructors: res.data.instructors } });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ regionId, state: { status: "error" } });
      });
    return () => {
      cancelled = true;
    };
  }, [regionId]);

  const state: OverviewState = loaded.regionId === regionId ? loaded.state : { status: "loading" };
  const openClass = selected && selected.regionId === regionId ? selected : null;

  return (
    <section className="surface-section p-5">
      <header className="mb-4">
        <h2 className="font-display text-xl text-[var(--ink-strong)]">Instructors and Classes</h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Pick a class to see its students. You can read this list. You cannot change it.
        </p>
      </header>

      {state.status === "loading" && <p className="text-sm text-[var(--ink-muted)]">Loading…</p>}
      {state.status === "error" && (
        <p className="text-sm text-danger" role="alert">
          We could not load this region. Try again.
        </p>
      )}
      {state.status === "ready" && state.instructors.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          No instructors teach a class in this region yet.
        </p>
      )}
      {state.status === "ready" && state.instructors.length > 0 && (
        <ul className="space-y-4">
          {state.instructors.map((instructor) => (
            <li key={instructor.id}>
              <p className="font-semibold text-[var(--ink-strong)]">{instructor.displayName}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {instructor.classes.map((spokesClass) => (
                  <li key={spokesClass.id}>
                    <button
                      type="button"
                      aria-pressed={openClass?.id === spokesClass.id}
                      onClick={() => setSelected({ regionId, id: spokesClass.id, name: spokesClass.name })}
                      className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-left text-sm text-[var(--ink-strong)] aria-pressed:border-[var(--accent-strong)]"
                    >
                      {spokesClass.name} · {spokesClass.activeStudents}{" "}
                      {spokesClass.activeStudents === 1 ? "student" : "students"}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {openClass && <ClassRosterList classId={openClass.id} className={openClass.name} />}
    </section>
  );
}
