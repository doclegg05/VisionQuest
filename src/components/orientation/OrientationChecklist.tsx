"use client";

import { useState, useEffect, useCallback } from "react";
import OrientationFormDetail from "./OrientationFormDetail";
import BirthdatePromptModal from "./BirthdatePromptModal";
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
  verificationStatus: string | null;
}

interface SectionGroup {
  section: string;
  items: OrientationItem[];
}

interface OrientationChecklistProps {
  targetStudentId?: string;
  emptyStateHint?: string;
}

async function fetchOrientationItems(targetStudentId?: string): Promise<OrientationItem[]> {
  const params = targetStudentId ? `?studentId=${encodeURIComponent(targetStudentId)}` : "";
  const res = await fetch(`/api/orientation${params}`);
  if (!res.ok) throw new Error("Failed to load orientation items");
  const data = await res.json();
  return data.items || [];
}

async function fetchOrientationFormStatuses(targetStudentId?: string): Promise<Record<string, string>> {
  const params = targetStudentId ? `?studentId=${encodeURIComponent(targetStudentId)}` : "";
  const res = await fetch(`/api/forms/status${params}`);
  const data = res.ok ? await res.json() : { submissions: [] };
  const statusMap: Record<string, string> = {};
  for (const sub of data.submissions) {
    statusMap[sub.formId] = sub.status;
  }
  return statusMap;
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
  const [showBirthdatePrompt, setShowBirthdatePrompt] = useState(false);

  // Only the student themselves should ever see the birthdate prompt — when
  // staff complete orientation on behalf of a student, they already capture
  // birthdate through the teacher workspace (SpokesStudentWorkspace).
  const isSelfView = !targetStudentId;

  // Fetch the student's birthdate status to know whether to prompt on
  // completion. Only runs on self-view so we never touch another student's
  // record from the checklist.
  const maybePromptForBirthdate = useCallback(async () => {
    if (!isSelfView) return;
    try {
      const res = await fetch("/api/settings/profile");
      if (!res.ok) return;
      const data = (await res.json()) as { birthDate: string | null };
      if (!data.birthDate) setShowBirthdatePrompt(true);
    } catch {
      // Network hiccup — non-critical, student can add via Settings later.
    }
  }, [isSelfView]);

  const fetchFormStatuses = useCallback(() => {
    fetchOrientationFormStatuses(targetStudentId)
      .then((statusMap) => setFormStatuses(statusMap))
      .catch(() => {});
  }, [targetStudentId]);

  const fetchItems = useCallback(async () => {
    try {
      const items = await fetchOrientationItems(targetStudentId);
      setItems(items);
      setError(null);
    } catch (err) {
      console.error("Failed to load orientation items:", err instanceof Error ? err.message : "Unknown error");
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [targetStudentId]);

  useEffect(() => {
    let cancelled = false;

    fetchOrientationItems(targetStudentId)
      .then((items) => {
        if (cancelled) return;
        setItems(items);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load orientation items:", err instanceof Error ? err.message : "Unknown error");
        setError("Failed to load. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    fetchOrientationFormStatuses(targetStudentId)
      .then((statusMap) => {
        if (!cancelled) setFormStatuses(statusMap);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [targetStudentId]);

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

      const body = (await res.json().catch(() => ({}))) as {
        data?: { pendingVerification?: boolean; verificationStatus?: string };
      };
      if (body?.data?.pendingVerification) {
        // Honor-system step (P1-1): the claim was filed, not completed —
        // show the waiting state and never fire the completion call.
        setItems((prev) => prev.map((item) =>
          item.id === itemId
            ? { ...item, completed: false, completedAt: null, verificationStatus: "pending" }
            : item
        ));
        return;
      }
      if (!completed) {
        // Un-marking also withdraws any pending/declined verification state.
        setItems((prev) => prev.map((item) =>
          item.id === itemId ? { ...item, verificationStatus: null } : item
        ));
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
              // Student just finished their own orientation. Ask for a
              // birthdate if we don't have one on file — it's required
              // downstream for DoHS age reporting. Staff-view completions
              // are gated out inside maybePromptForBirthdate.
              void maybePromptForBirthdate();
            })
            .catch((err) => {
              console.error("Failed to record orientation completion", err instanceof Error ? err.message : "Unknown error");
              setError("All items checked, but we couldn't save your progress. Please refresh and try again.");
            });
        }
        return prev;
      });
    } catch (err) {
      console.error("Failed to toggle item:", err instanceof Error ? err.message : "Unknown error");
      setItems((prev) => prev.map((item) =>
        item.id === itemId
          ? { ...item, completed: !completed, completedAt: null }
          : item
      ));
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-faint)]">Loading checklist...</p>;
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
      <div className="text-center text-[var(--ink-faint)] py-8">
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
                    : "bg-[var(--surface-interactive)] text-[var(--ink-muted)]"
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
        <div className="flex justify-between text-xs text-[var(--ink-muted)]">
          <span>{done} of {total} completed</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2.5 bg-[var(--surface-strong)] rounded-full overflow-hidden">
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
            <div className="mb-3 h-1.5 rounded-full bg-[var(--surface-strong)] overflow-hidden">
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
                          : "bg-[var(--surface-raised)] border-[var(--border)] hover:bg-[var(--surface-soft)] bg-opacity-[86%]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() => toggleItem(item.id, !item.completed)}
                        className="h-5 w-5 rounded border-[var(--border-strong)] text-green-600 focus:ring-green-500 shrink-0 cursor-pointer"
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
                        {!item.completed && item.verificationStatus === "pending" && (
                          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                            ✓ Sent — waiting on your instructor
                          </p>
                        )}
                        {!item.completed && item.verificationStatus === "declined" && (
                          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                            Your instructor asked you to redo this step
                          </p>
                        )}
                      </div>

                      {hasDetails && (
                        <span
                          className={[
                            "text-[var(--ink-muted)] shrink-0 ml-1 text-xs transition-transform",
                            expandedItem === item.id ? "rotate-90" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
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

      <BirthdatePromptModal
        open={showBirthdatePrompt}
        onClose={() => setShowBirthdatePrompt(false)}
        onSaved={() => setShowBirthdatePrompt(false)}
      />
    </div>
  );
}
