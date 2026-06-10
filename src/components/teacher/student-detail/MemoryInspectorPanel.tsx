"use client";

import { useCallback, useEffect, useState } from "react";

interface SageMemoryItem {
  id: string;
  kind: string;
  content: string;
  category: string;
  confidence: number;
  createdAt: string;
}

interface MemoryInspectorPanelProps {
  studentId: string;
}

/**
 * What Sage remembers about this student (Phase 2 memory inspector).
 * Staff can remove incorrect memories — the FERPA right to amend records
 * extends to AI-extracted facts. Removal archives the row (auditable).
 */
export function MemoryInspectorPanel({ studentId }: MemoryInspectorPanelProps) {
  const [memories, setMemories] = useState<SageMemoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/teacher/students/${studentId}/memories`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      setMemories(json.data?.memories ?? []);
      setError(null);
    } catch {
      setError("Could not load Sage's memories for this student.");
      setMemories([]);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (memoryId: string) => {
    setRemoving(memoryId);
    try {
      const res = await fetch(`/api/teacher/students/${studentId}/memories`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryId }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setMemories((current) => (current ?? []).filter((memory) => memory.id !== memoryId));
    } catch {
      setError("Could not remove that memory. Try again.");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="theme-card rounded-xl p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-secondary)]">
        Sage&apos;s memory
      </p>
      <p className="mt-1 text-xs text-[var(--ink-faint)]">
        Facts Sage remembers from coaching conversations. Remove anything inaccurate —
        removal takes effect immediately and is logged.
      </p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {memories === null ? (
        <p className="mt-3 text-sm text-[var(--ink-faint)]">Loading…</p>
      ) : memories.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--ink-faint)]">
          Sage has not recorded any memories for this student yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {memories.map((memory) => (
            <li key={memory.id} className="theme-input flex items-start justify-between gap-3 rounded-lg p-3">
              <div>
                <p className="text-sm text-[var(--ink-strong)]">{memory.content}</p>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  {memory.category} · {memory.kind} · confidence {Math.round(memory.confidence * 100)}%
                </p>
              </div>
              <button
                onClick={() => remove(memory.id)}
                disabled={removing === memory.id}
                aria-label={`Remove memory: ${memory.content.slice(0, 60)}`}
                className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {removing === memory.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
