"use client";

import { useState, useEffect, useCallback } from "react";
import OrientationFormDetail from "./OrientationFormDetail";
import { useProgression } from "@/components/progression/ProgressionProvider";
import { getOrientationStepDetail } from "@/lib/orientation-step-resources";

interface OrientationItem {
  id: string;
  label: string;
  description: string | null;
  section: string | null;
  required: boolean;
  completed: boolean;
  completedAt: string | null;
}

interface SectionGroup {
  section: string;
  items: OrientationItem[];
}

interface OrientationChecklistProps {
  targetStudentId?: string;
  emptyStateHint?: string;
}

function groupBySection(items: OrientationItem[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  let current: SectionGroup | null = null;

  for (const item of items) {
    const section = item.section || "General";
    if (!current || current.section !== section) {
      current = { section, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}

export default function OrientationChecklist({
  targetStudentId,
  emptyStateHint = "Your teacher will add items when ready.",
}: OrientationChecklistProps) {
  const { checkProgression } = useProgression();
  const [items, setItems] = useState<OrientationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formStatuses, setFormStatuses] = useState<Record<string, string>>({});

  const fetchFormStatuses = useCallback(() => {
    const params = targetStudentId ? `?studentId=${encodeURIComponent(targetStudentId)}` : "";
    fetch(`/api/forms/status${params}`)
      .then(res => res.ok ? res.json() : { submissions: [] })
      .then(data => {
        const statusMap: Record<string, string> = {};
        for (const sub of data.submissions) {
          statusMap[sub.formId] = sub.status;
        }
        setFormStatuses(statusMap);
      })
      .catch(() => {});
  }, [targetStudentId]);

  useEffect(() => {
    void fetchItems();
    fetchFormStatuses();
  }, [fetchFormStatuses, targetStudentId]);

  async function fetchItems() {
    try {
      const params = targetStudentId ? `?studentId=${encodeURIComponent(targetStudentId)}` : "";
      const res = await fetch(`/api/orientation${params}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to load orientation items:", err);
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleItem(itemId: string, completed: boolean) {
    setItems((prev) => prev.map((item) =>
      item.id === itemId
        ? { ...item, completed, completedAt: completed ? new Date().toISOString() : null }
        : item
    ));

    try {
      const res = await fetch("/api/orientation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, completed, studentId: targetStudentId }),
      });

      if (!res.ok) {
        setItems((prev) => prev.map((item) =>
          item.id === itemId
            ? { ...item, completed: !completed, completedAt: null }
            : item
        ));
        return;
      }

      setItems((prev) => {
        const allDone = completed && prev.every((i) => i.completed);
        if (allDone) {
          fetch("/api/orientation/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studentId: targetStudentId }),
          })
            .then(() => {
              if (!targetStudentId) {
                setTimeout(() => checkProgression(), 500);
              }
            })
            .catch((err) => {
              console.error("Failed to record orientation completion", err);
              setError("All items checked, but we couldn't save your progress. Please refresh and try again.");
            });
        }
        return prev;
      });
    } catch (err) {
      console.error("Failed to toggle item:", err);
      setItems((prev) => prev.map((item) =>
        item.id === itemId
          ? { ...item, completed: !completed, completedAt: null }
          : item
      ));
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading checklist...</p>;
  }

  if (error) return (
    <div className="text-center py-12">
      <p className="text-red-600 mb-4">{error}</p>
      <button onClick={fetchItems} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        Try Again
      </button>
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="text-center text-gray-400 py-8">
        <p className="text-4xl mb-3">📋</p>
        <p className="text-sm">No orientation items have been set up yet.</p>
        <p className="text-xs mt-1">{emptyStateHint}</p>
      </div>
    );
  }

  const done = items.filter((i) => i.completed).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const sections = groupBySection(items);

  return (
    <div className="space-y-6">
      {/* Section summary strip */}
      <div className="flex flex-wrap items-center gap-2">
        {sections.map((group) => {
          const sDone = group.items.filter((i) => i.completed).length;
          const sTotal = group.items.length;
          const isComplete = sDone === sTotal;
          return (
            <span
              key={group.section}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                isComplete
                  ? "bg-green-100 text-green-700"
                  : sDone > 0
                    ? "bg-amber-50 text-amber-800"
                    : "bg-gray-100 text-[var(--ink-muted)]"
              }`}
            >
              {isComplete ? "✓" : `${sDone}/${sTotal}`}
              <span className="max-w-24 truncate">{group.section}</span>
            </span>
          );
        })}
      </div>

      {/* Overall progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span>{done} of {total} completed</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-400 to-green-500 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Sections */}
      {sections.map((group) => {
        const sectionDone = group.items.filter((i) => i.completed).length;
        const sectionTotal = group.items.length;
        const sectionComplete = sectionDone === sectionTotal;
        const sectionPct = sectionTotal > 0 ? Math.round((sectionDone / sectionTotal) * 100) : 0;

        return (
          <div key={group.section}>
            {/* Section header */}
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold text-[var(--ink-strong)]">
                {group.section}
                {sectionComplete && (
                  <span className="ml-2 text-green-500">✓</span>
                )}
              </h3>
              <span className="text-xs text-[var(--ink-muted)]">
                {sectionDone}/{sectionTotal}
              </span>
            </div>

            {/* Section progress bar */}
            <div className="mb-3 h-1.5 rounded-full bg-gray-200 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  sectionComplete ? "bg-green-500" : "bg-amber-400"
                }`}
                style={{ width: `${sectionPct}%` }}
              />
            </div>

            {/* Section items */}
            <div className="space-y-2">
              {group.items.map((item) => {
                const detail = getOrientationStepDetail(item.label);
                const hasDetails = detail.forms.length > 0 || !!detail.note;

                return (
                  <div key={item.id}>
                    <label
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        item.completed
                          ? "bg-green-50 border-green-200"
                          : "bg-white border-gray-200 hover:bg-gray-50 bg-opacity-[86%]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() => toggleItem(item.id, !item.completed)}
                        className="h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-green-500 shrink-0 cursor-pointer"
                      />
                      <div
                        className="flex-1 min-w-0"
                        onClick={(e) => {
                          e.preventDefault();
                          if (hasDetails) {
                            setExpandedItem(expandedItem === item.id ? null : item.id);
                          }
                        }}
                      >
                        <p className={`text-[15px] font-medium ${item.completed ? "text-green-800 line-through opacity-80" : "text-[var(--ink-strong)]"}`}>
                          {item.label}
                          {item.required && (
                            <span className="ml-1 text-xs text-red-400 font-normal">*</span>
                          )}
                        </p>
                        {item.description && (
                          <p className="text-sm text-[var(--ink-muted)] mt-0.5">{item.description}</p>
                        )}
                      </div>

                      {hasDetails && (
                        <span className={`text-[var(--ink-muted)] shrink-0 ml-1 text-xs transition-transform ${expandedItem === item.id ? "rotate-90" : ""}`}>
                          ▶
                        </span>
                      )}
                      {item.completed && !hasDetails && (
                        <span className="text-green-500 shrink-0 text-sm ml-1">✓</span>
                      )}
                    </label>
                    {expandedItem === item.id && hasDetails && (
                      <OrientationFormDetail
                        itemLabel={item.label}
                        formStatuses={formStatuses}
                        onUploadComplete={fetchFormStatuses}
                        targetStudentId={targetStudentId}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {done === total && total > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <p className="text-lg mb-1">🎉</p>
          <p className="text-sm font-medium text-green-800">Orientation complete!</p>
          <p className="text-xs text-green-700 mt-0.5">You&apos;re all set to get started with SPOKES.</p>
        </div>
      )}
    </div>
  );
}
