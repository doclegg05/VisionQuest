"use client";

import { useState, useEffect, useCallback } from "react";
import { CERTIFICATIONS } from "@/lib/spokes/certifications";
import { PLATFORMS } from "@/lib/spokes/platforms";

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
  { value: "required", label: "Required", color: "bg-red-50 text-red-700 border-red-200" },
  { value: "optional", label: "Optional", color: "bg-blue-50 text-blue-700 border-blue-200" },
  { value: "not_applicable", label: "N/A", color: "bg-gray-50 text-gray-500 border-gray-200" },
];

// Build catalog of items that can be added as requirements
const CATALOG = [
  ...CERTIFICATIONS.map((c) => ({
    itemType: "certification" as const,
    itemId: c.id,
    title: c.shortName,
    description: c.description,
  })),
  ...PLATFORMS.map((p) => ({
    itemType: "course" as const,
    itemId: p.id,
    title: p.name,
    description: p.description,
  })),
];

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

  useEffect(() => {
    fetchRequirements();
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
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
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
              className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5"
            >
              <span className="text-xs text-gray-400 w-6 text-center shrink-0">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{r.title}</p>
                <p className="text-xs text-gray-400">{ITEM_TYPE_LABELS[r.itemType] ?? r.itemType}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateStatus(idx, opt.value)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      r.status === opt.value
                        ? opt.color + " font-semibold"
                        : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => removeRequirement(idx)}
                className="text-xs text-gray-400 hover:text-red-500 px-1 shrink-0"
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
          <div className="w-full bg-white rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-600">Add from catalog</p>
              <button onClick={() => setShowCatalog(false)} className="text-xs text-gray-400 hover:text-gray-600">
                Close
              </button>
            </div>
            {availableCatalog.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">All catalog items have been added.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {availableCatalog.map((item) => (
                  <button
                    key={`${item.itemType}:${item.itemId}`}
                    type="button"
                    onClick={() => addFromCatalog(item)}
                    className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <span className="font-medium text-gray-900">{item.title}</span>
                    <span className="ml-2 text-xs text-gray-400">
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
            className="border-2 border-dashed border-gray-300 rounded-xl px-4 py-2 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            + Add Requirement
          </button>
        )}

        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 ml-auto"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        )}
      </div>
    </div>
  );
}
