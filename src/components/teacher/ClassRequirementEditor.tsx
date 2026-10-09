"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CERTIFICATIONS } from "@/lib/spokes/certifications";

interface Requirement {
  id: string;
  itemType: string;
  itemId: string;
  title: string;
  status: string;
  description: string | null;
  sortOrder: number;
}

interface ClassRequirementEditorProps {
  classId: string;
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  certification: "Certification",
  course: "Course/Platform",
  orientation: "Orientation",
  form: "Form",
};

const STATUS_OPTIONS = [
  { value: "required", label: "Required", color: "bg-[var(--badge-error-bg)] text-[var(--badge-error-text)] border-[var(--badge-error-bg)]" },
  { value: "optional", label: "Optional", color: "bg-[var(--badge-info-bg)] text-[var(--badge-info-text)] border-[var(--badge-info-bg)]" },
  { value: "not_applicable", label: "N/A", color: "bg-[var(--surface-soft)] text-[var(--ink-muted)] border-[var(--border)]" },
];

// Build catalog of items that can be added as requirements.
// Platforms (LMS systems) are intentionally excluded — they're how students
// access courses, not courses themselves. Several platforms also duplicated
// certifications (e.g. "Bring Your A Game" platform vs BYAG certification).
const CATALOG = CERTIFICATIONS.map((c) => ({
  itemType: "certification" as const,
  itemId: c.id,
  title: c.shortName,
  description: c.description,
}));

export default function ClassRequirementEditor({ classId }: ClassRequirementEditorProps) {
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);

  const fetchRequirements = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/teacher/classes/${classId}/requirements`);
      if (res.ok) {
        const data = await res.json();
        setRequirements(data.requirements ?? []);
        setError(null);
      } else {
        setError("Failed to load requirements.");
      }
    } catch {
      setError("Failed to load requirements.");
    } finally {
      setLoading(false);
    }
  }, [classId]);

  const fetchRequirementsRef = useRef(fetchRequirements);
  useEffect(() => {
    fetchRequirementsRef.current = fetchRequirements;
  });

  useEffect(() => {
    void fetchRequirementsRef.current();
  }, [fetchRequirements]);

  function updateStatus(idx: number, newStatus: string) {
    setRequirements((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, status: newStatus } : r)),
    );
    setDirty(true);
  }

  function removeRequirement(idx: number) {
    setRequirements((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  }

  function addFromCatalog(item: { itemType: string; itemId: string; title: string; description: string }) {
    const alreadyExists = requirements.some(
      (r) => r.itemType === item.itemType && r.itemId === item.itemId,
    );
    if (alreadyExists) return;

    setRequirements((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        itemType: item.itemType,
        itemId: item.itemId,
        title: item.title,
        status: "required",
        description: item.description,
        sortOrder: prev.length,
      },
    ]);
    setDirty(true);
    setShowCatalog(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/teacher/classes/${classId}/requirements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirements: requirements.map((r, idx) => ({
            itemType: r.itemType,
            itemId: r.itemId,
            title: r.title,
            status: r.status,
            description: r.description ?? "",
            sortOrder: idx,
          })),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setRequirements(data.requirements ?? []);
        setDirty(false);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to save requirements.");
      }
    } catch {
      setError("Failed to save requirements.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading requirements...</p>;

  const existingIds = new Set(requirements.map((r) => `${r.itemType}:${r.itemId}`));
  const availableCatalog = CATALOG.filter((c) => !existingIds.has(`${c.itemType}:${c.itemId}`));

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-[var(--badge-error-text)] bg-[var(--badge-error-bg)] rounded-lg px-3 py-2">{error}</p>
      )}

      {requirements.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)] py-4 text-center">
          No requirements configured. Add certifications and courses from the catalog below.
        </p>
      ) : (
        <div className="space-y-1.5">
          {requirements.map((r, idx) => (
            <div
              key={r.id}
              className="flex items-center gap-3 theme-card rounded-xl px-4 py-2.5"
            >
              <span className="text-xs text-[var(--ink-faint)] w-6 text-center shrink-0">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--ink-strong)] truncate">{r.title}</p>
                <p className="text-xs text-[var(--ink-faint)]">{ITEM_TYPE_LABELS[r.itemType] ?? r.itemType}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateStatus(idx, opt.value)}
                    className={`inline-flex items-center pointer-coarse:min-h-11 text-xs px-2 py-1 rounded border transition-colors ${
                      r.status === opt.value
                        ? opt.color + " font-semibold"
                        : "bg-[var(--surface-raised)] border-[var(--border)] text-[var(--ink-faint)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => removeRequirement(idx)}
                className="inline-flex size-8 shrink-0 items-center justify-center pointer-coarse:size-11 text-xs text-[var(--ink-faint)] hover:text-[var(--badge-error-text)]"
                aria-label={`Remove ${r.title}`}
                title="Remove"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {showCatalog ? (
          <div className="w-full theme-card rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-[var(--ink-muted)]">Add from catalog</p>
              <button onClick={() => setShowCatalog(false)} className="inline-flex items-center pointer-coarse:min-h-11 text-xs text-[var(--ink-faint)] hover:text-[var(--ink-muted)]">
                Close
              </button>
            </div>
            {availableCatalog.length === 0 ? (
              <p className="text-xs text-[var(--ink-faint)] py-2">All catalog items have been added.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {availableCatalog.map((item) => (
                  <button
                    key={`${item.itemType}:${item.itemId}`}
                    type="button"
                    onClick={() => addFromCatalog(item)}
                    className="flex w-full items-center pointer-coarse:min-h-11 text-left text-sm px-3 py-2 rounded-lg hover:bg-[var(--surface-soft)] transition-colors"
                  >
                    <span className="font-medium text-[var(--ink-strong)]">{item.title}</span>
                    <span className="ml-2 text-xs text-[var(--ink-faint)]">
                      {ITEM_TYPE_LABELS[item.itemType]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCatalog(true)}
            className="inline-flex items-center pointer-coarse:min-h-11 border-2 border-dashed border-[var(--border-strong)] rounded-xl px-4 py-2 text-sm text-[var(--ink-muted)] hover:border-[var(--accent-blue)] hover:text-[var(--badge-info-text)] transition-colors"
          >
            + Add Requirement
          </button>
        )}

        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="primary-button pointer-coarse:min-h-11 text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ml-auto"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        )}
      </div>
    </div>
  );
}
