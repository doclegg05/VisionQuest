"use client";

import { useState, useEffect, useCallback } from "react";
import OrientationFormDetail, { findRelatedForms } from "./OrientationFormDetail";
import { useProgression } from "@/components/progression/ProgressionProvider";

interface OrientationItem {
  id: string;
  label: string;
  description: string | null;
  required: boolean;
  completed: boolean;
  completedAt: string | null;
}

export default function OrientationChecklist() {
  const { checkProgression } = useProgression();
  const [items, setItems] = useState<OrientationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formStatuses, setFormStatuses] = useState<Record<string, string>>({});

  const fetchFormStatuses = useCallback(() => {
    fetch("/api/forms/status")
      .then(res => res.ok ? res.json() : { submissions: [] })
      .then(data => {
        const statusMap: Record<string, string> = {};
        for (const sub of data.submissions) {
          statusMap[sub.formId] = sub.status;
        }
        setFormStatuses(statusMap);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchItems();
    fetchFormStatuses();
  }, [fetchFormStatuses]);

  async function fetchItems() {
    try {
      const res = await fetch("/api/orientation");
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
    setToggling(itemId);
    try {
      const res = await fetch("/api/orientation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, completed }),
      });
      if (res.ok) {
        setItems((prev) => {
          const updated = prev.map((item) =>
            item.id === itemId
              ? { ...item, completed, completedAt: completed ? new Date().toISOString() : null }
              : item
          );

          // Check if orientation is now complete (using updated array, not stale state)
          const allDone = completed && updated.every(i => i.completed);
          if (allDone) {
            fetch("/api/orientation/complete", { method: "POST" })
              .then(() => setTimeout(() => checkProgression(), 500))
              .catch(() => {});
          }

          return updated;
        });
      }
    } catch (err) {
      console.error("Failed to toggle item:", err);
    } finally {
      setToggling(null);
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
        <p className="text-xs mt-1">Your teacher will add items when ready.</p>
      </div>
    );
  }

  const done = items.filter((i) => i.completed).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
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

      {/* Checklist */}
      <div className="space-y-2">
        {items.map((item) => {
          const relatedForms = findRelatedForms(item.label);
          const hasForms = relatedForms.length > 0;
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
                disabled={toggling === item.id}
                onChange={() => toggleItem(item.id, !item.completed)}
                className="h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-green-500 shrink-0 cursor-pointer"
              />
              <div
                className="flex-1 min-w-0"
                onClick={(e) => {
                  e.preventDefault();
                  if (hasForms) {
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

              {hasForms && (
                <div className="flex gap-2 items-center flex-wrap justify-end shrink-0 pl-2">
                  {relatedForms.map(form => {
                    const viewUrl = `/api/forms/download?file=${encodeURIComponent(form.fileName)}&name=${encodeURIComponent(form.fileName)}`;
                    return (
                      <a
                        key={form.id}
                        href={viewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()} // Prevent row click
                        className="inline-flex items-center gap-1.5 rounded-[0.5rem] bg-[var(--primary)] text-white px-3 py-1.5 text-xs font-semibold shadow-sm hover:bg-[var(--dark)] transition-colors"
                        title={`Open ${form.title}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Open PDF
                      </a>
                    );
                  })}
                </div>
              )}

              {hasForms && (
                <span className={`text-[var(--ink-muted)] shrink-0 ml-1 text-xs transition-transform ${expandedItem === item.id ? "rotate-90" : ""}`}>
                  ▶
                </span>
              )}
              {item.completed && !hasForms && (
                <span className="text-green-500 shrink-0 text-sm ml-1">✓</span>
              )}
            </label>
            {expandedItem === item.id && hasForms && (
              <OrientationFormDetail
                itemLabel={item.label}
                formStatuses={formStatuses}
                onUploadComplete={fetchFormStatuses}
              />
            )}
          </div>
          );
        })}
      </div>

      {done === total && total > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <p className="text-lg mb-1">🎉</p>
          <p className="text-sm font-medium text-green-800">Orientation complete!</p>
          <p className="text-xs text-green-600 mt-0.5">You&apos;re all set to get started with SPOKES.</p>
        </div>
      )}
    </div>
  );
}
