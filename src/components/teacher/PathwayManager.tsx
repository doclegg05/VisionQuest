"use client";

import { useState, useEffect, useCallback } from "react";
import { CERTIFICATIONS } from "@/lib/spokes/certifications";
import { PLATFORMS } from "@/lib/spokes/platforms";

interface PathwayView {
  id: string;
  label: string;
  description: string | null;
  certifications: string[];
  platforms: string[];
  estimatedWeeks: number;
  active: boolean;
  goalCount: number;
}

const CERT_OPTIONS = CERTIFICATIONS.map((c) => ({ id: c.id, label: c.shortName }));
const PLATFORM_OPTIONS = PLATFORMS.map((p) => ({ id: p.id, label: p.name }));

const EMPTY_FORM = {
  label: "",
  description: "",
  certifications: [] as string[],
  platforms: [] as string[],
  estimatedWeeks: 0,
};

export default function PathwayManager() {
  const [pathways, setPathways] = useState<PathwayView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchPathways = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/teacher/pathways");
      if (res.ok) {
        const data = await res.json();
        setPathways(data.pathways ?? []);
        setError(null);
      } else {
        setError("Failed to load pathways.");
      }
    } catch {
      setError("Failed to load pathways.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPathways();
  }, [fetchPathways]);

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function startEdit(p: PathwayView) {
    setEditingId(p.id);
    setForm({
      label: p.label,
      description: p.description ?? "",
      certifications: [...p.certifications],
      platforms: [...p.platforms],
      estimatedWeeks: p.estimatedWeeks,
    });
    setFormError(null);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.label.trim()) {
      setFormError("Pathway name is required.");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const url = editingId
        ? `/api/teacher/pathways/${editingId}`
        : "/api/teacher/pathways";
      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (res.ok) {
        resetForm();
        fetchPathways();
      } else {
        const data = await res.json().catch(() => null);
        setFormError(data?.error ?? "Failed to save pathway.");
      }
    } catch {
      setFormError("Failed to save pathway.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p: PathwayView) {
    const msg = p.goalCount > 0
      ? `This pathway is linked to ${p.goalCount} goal(s). It will be deactivated instead of deleted. Continue?`
      : "Delete this pathway? This cannot be undone.";
    if (!confirm(msg)) return;

    try {
      const res = await fetch(`/api/teacher/pathways/${p.id}`, { method: "DELETE" });
      if (res.ok) fetchPathways();
    } catch {
      // Silently fail — user can retry
    }
  }

  async function handleToggleActive(p: PathwayView) {
    try {
      const res = await fetch(`/api/teacher/pathways/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !p.active }),
      });
      if (res.ok) fetchPathways();
    } catch {
      // Silently fail
    }
  }

  function toggleItem(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((v) => v !== id) : [...list, id];
  }

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading...</p>;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error}</p>
        <button onClick={fetchPathways} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pathways.length === 0 ? (
        <div className="text-center text-[var(--ink-muted)] py-8 text-sm">
          No pathways yet. Create one to map goal categories to approved courses and certifications.
        </div>
      ) : (
        <div className="space-y-2">
          {pathways.map((p) => (
            <div
              key={p.id}
              className={`bg-white rounded-xl border p-4 flex items-start justify-between gap-3 ${
                p.active ? "border-gray-200" : "border-gray-200 opacity-60"
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {p.label}
                  {!p.active && (
                    <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Inactive</span>
                  )}
                </p>
                {p.description && (
                  <p className="text-xs text-gray-500 mt-1">{p.description}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  {p.certifications.length > 0 && (
                    <span className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">
                      {p.certifications.length} cert{p.certifications.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {p.platforms.length > 0 && (
                    <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                      {p.platforms.length} platform{p.platforms.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {p.estimatedWeeks > 0 && (
                    <span className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded">
                      ~{p.estimatedWeeks} week{p.estimatedWeeks !== 1 ? "s" : ""}
                    </span>
                  )}
                  {p.goalCount > 0 && (
                    <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                      {p.goalCount} goal{p.goalCount !== 1 ? "s" : ""} linked
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => handleToggleActive(p)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">
                  {p.active ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => startEdit(p)} className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1">
                  Edit
                </button>
                <button onClick={() => handleDelete(p)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">
            {editingId ? "Edit Pathway" : "New Pathway"}
          </h3>

          {formError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>
          )}

          <input
            type="text"
            placeholder="Pathway name (e.g., 'Office Administration')"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <textarea
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />

          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Certifications</p>
            <div className="flex flex-wrap gap-1.5">
              {CERT_OPTIONS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setForm({ ...form, certifications: toggleItem(form.certifications, c.id) })}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    form.certifications.includes(c.id)
                      ? "bg-purple-100 border-purple-300 text-purple-800"
                      : "bg-gray-50 border-gray-200 text-gray-600 hover:border-purple-300"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Learning Platforms</p>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_OPTIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setForm({ ...form, platforms: toggleItem(form.platforms, p.id) })}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    form.platforms.includes(p.id)
                      ? "bg-blue-100 border-blue-300 text-blue-800"
                      : "bg-gray-50 border-gray-200 text-gray-600 hover:border-blue-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">
              Estimated duration (weeks)
            </label>
            <input
              type="number"
              min={0}
              max={104}
              value={form.estimatedWeeks}
              onChange={(e) => setForm({ ...form, estimatedWeeks: Math.max(0, parseInt(e.target.value) || 0) })}
              className="ml-2 w-20 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : editingId ? "Save Changes" : "Create Pathway"}
            </button>
            <button onClick={resetForm} className="text-sm text-gray-500 px-4 py-2 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-gray-300 rounded-xl p-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          + Add Pathway
        </button>
      )}
    </div>
  );
}
