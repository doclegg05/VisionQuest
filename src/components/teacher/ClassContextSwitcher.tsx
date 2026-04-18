"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { api } from "@/lib/api";
import { normalizeProgramType, PROGRAM_LABELS, type ProgramType } from "@/lib/program-type";

const LOCAL_STORAGE_KEY = "teacher:activeClassId";
const ALL_VALUE = "all";

export interface ClassContextOption {
  id: string;
  name: string;
  code: string;
  programType: ProgramType;
  status: string;
}

// ─── Pure helpers (exported for unit testing) ─────────────────────────────────

/**
 * Decide whether to render the switcher. We only show it when the teacher
 * has 2+ active classes — single-class teachers don't need a filter.
 */
export function shouldRenderSwitcher(activeClassCount: number): boolean {
  return activeClassCount >= 2;
}

/**
 * Resolve which class is currently active given both sources of truth.
 * URL wins over localStorage; unknown ids fall back to "all".
 */
export function resolveInitialClassId(
  urlParam: string | null,
  storedValue: string | null,
  knownClassIds: readonly string[],
): string {
  if (urlParam && knownClassIds.includes(urlParam)) return urlParam;
  if (!urlParam && storedValue && knownClassIds.includes(storedValue)) {
    return storedValue;
  }
  return ALL_VALUE;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ClassesEndpointResponse {
  classes: Array<{
    id: string;
    name: string;
    code: string;
    status: string;
    programType: string;
  }>;
}

function activeClassOptions(raw: ClassesEndpointResponse["classes"]): ClassContextOption[] {
  return raw
    .filter((entry) => entry.status !== "archived")
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      code: entry.code,
      status: entry.status,
      programType: normalizeProgramType(entry.programType),
    }));
}

export default function ClassContextSwitcher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlClassId = searchParams.get("classId");

  const [classes, setClasses] = useState<ClassContextOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ClassesEndpointResponse>("/api/teacher/classes")
      .then((data) => {
        if (!cancelled) setClasses(activeClassOptions(data.classes ?? []));
      })
      .catch(() => {
        if (!cancelled) setClasses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const knownIds = useMemo(() => classes?.map((entry) => entry.id) ?? [], [classes]);
  const selectedValue = useMemo(() => {
    if (!classes) return ALL_VALUE;
    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem(LOCAL_STORAGE_KEY) : null;
    return resolveInitialClassId(urlClassId, stored, knownIds);
  }, [classes, urlClassId, knownIds]);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const next = event.target.value;
      const params = new URLSearchParams(searchParams.toString());
      if (next === ALL_VALUE) {
        params.delete("classId");
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(LOCAL_STORAGE_KEY);
        }
      } else {
        params.set("classId", next);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(LOCAL_STORAGE_KEY, next);
        }
      }
      const query = params.toString();
      router.replace(query ? `?${query}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  if (!classes || !shouldRenderSwitcher(classes.length)) {
    return null;
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
        Class
      </span>
      <select
        value={selectedValue}
        onChange={handleChange}
        aria-label="Filter by class"
        className="field rounded-lg px-3 py-2 text-sm"
      >
        <option value={ALL_VALUE}>All classes</option>
        {classes.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {PROGRAM_LABELS[entry.programType]} — {entry.name} ({entry.code})
          </option>
        ))}
      </select>
    </label>
  );
}
