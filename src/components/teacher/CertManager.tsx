"use client";

import { useState, useEffect } from "react";
import { useConfirm } from "@/components/ui/useConfirm";

interface CertTemplate {
  id: string;
  label: string;
  description: string | null;
  url: string | null;
  required: boolean;
  needsFile: boolean;
  needsVerify: boolean;
  sortOrder: number;
}

export default function CertManager() {
  const { confirm, confirmDialog } = useConfirm();
  const [templates, setTemplates] = useState<CertTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    label: "",
    description: "",
    url: "",
    required: true,
    needsFile: false,
    needsVerify: true,
  });

  useEffect(() => {
    fetchTemplates();
  }, []);

  async function fetchTemplates() {
    try {
      setLoading(true);
      const res = await fetch("/api/teacher/certifications");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to load templates:", err instanceof Error ? err.message : "Unknown error");
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!form.label.trim()) return;

    const method = editingId ? "PUT" : "POST";
    const body = editingId ? { id: editingId, ...form } : form;

    try {
      const res = await fetch("/api/teacher/certifications", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        resetForm();
        fetchTemplates();
      }
    } catch (err) {
      console.error("Failed to save template:", err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function handleDelete(id: string) {
    if (
      !(await confirm({
        title: "Delete this requirement?",
        message: "Student progress for it is also removed.",
        confirmLabel: "Delete",
      }))
    ) return;

    try {
      const res = await fetch("/api/teacher/certifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) fetchTemplates();
    } catch (err) {
      console.error("Failed to delete template:", err instanceof Error ? err.message : "Unknown error");
    }
  }

  function startEdit(t: CertTemplate) {
    setEditingId(t.id);
    setForm({
      label: t.label,
      description: t.description || "",
      url: t.url || "",
      required: t.required,
      needsFile: t.needsFile,
      needsVerify: t.needsVerify,
    });
    setShowForm(true);
  }

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ label: "", description: "", url: "", required: true, needsFile: false, needsVerify: true });
  }

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading...</p>;

  if (error) return (
    <div className="text-center py-12">
      <p className="text-[var(--badge-error-text)] mb-4">{error}</p>
      <button onClick={fetchTemplates} className="primary-button px-4 py-2">
        Try Again
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {templates.length === 0 ? (
        <div className="text-center text-[var(--ink-muted)] py-8 text-sm">
          No certification requirements yet. Add one to define the Ready to Work certification.
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div
              key={t.id}
              className="theme-card rounded-xl p-4 flex items-start justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--ink-strong)]">
                  {t.label}
                  {t.required && (
                    <span className="ml-1.5 text-xs bg-[var(--badge-error-bg)] text-[var(--badge-error-text)] px-1.5 py-0.5 rounded">Required</span>
                  )}
                </p>
                {t.description && (
                  <p className="text-xs text-[var(--ink-muted)] mt-1">{t.description}</p>
                )}
                {t.url && (
                  <a href={t.url} target="_blank" rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center pointer-coarse:min-h-11 text-xs text-[var(--badge-info-text)] hover:text-[var(--ink-strong)]">Lesson link ↗</a>
                )}
                <div className="flex gap-2 mt-1.5">
                  {t.needsFile && (
                    <span className="text-xs bg-[var(--badge-info-bg)] text-[var(--badge-info-text)] px-1.5 py-0.5 rounded">File required</span>
                  )}
                  {t.needsVerify && (
                    <span className="text-xs bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)] px-1.5 py-0.5 rounded">Needs verification</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(t)} className="inline-flex items-center pointer-coarse:min-h-11 rounded-lg text-xs text-[var(--badge-info-text)] hover:bg-[var(--badge-info-bg)] px-2 py-1">
                  Edit
                </button>
                <button onClick={() => handleDelete(t.id)} className="inline-flex items-center pointer-coarse:min-h-11 rounded-lg text-xs text-[var(--badge-error-text)] hover:bg-[var(--badge-error-bg)] px-2 py-1">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="theme-card rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
            {editingId ? "Edit Requirement" : "New Certification Requirement"}
          </h3>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-[var(--ink-strong)]">Requirement name</span>
            <input
              type="text"
              placeholder="e.g., Complete Interview Skills module"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-[var(--ink-strong)]">Description (optional)</span>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-[var(--ink-strong)]">Lesson URL (optional)</span>
            <input
              type="url"
              placeholder="e.g., GitHub Pages link"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
            />
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} className="rounded border-[var(--border-strong)] accent-[var(--accent-blue)]" />
              Required
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <input type="checkbox" checked={form.needsFile} onChange={(e) => setForm({ ...form, needsFile: e.target.checked })} className="rounded border-[var(--border-strong)] accent-[var(--accent-blue)]" />
              File upload needed
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <input type="checkbox" checked={form.needsVerify} onChange={(e) => setForm({ ...form, needsVerify: e.target.checked })} className="rounded border-[var(--border-strong)] accent-[var(--accent-blue)]" />
              Teacher verification
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="primary-button text-sm px-4 py-2">
              {editingId ? "Save Changes" : "Add Requirement"}
            </button>
            <button onClick={resetForm} className="text-sm text-[var(--ink-muted)] px-4 py-2 hover:text-[var(--ink-strong)]">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-[var(--border-strong)] rounded-xl p-3 text-sm text-[var(--ink-muted)] hover:border-[var(--accent-blue)] hover:text-[var(--badge-info-text)] transition-colors"
        >
          + Add Certification Requirement
        </button>
      )}
      {confirmDialog}
    </div>
  );
}
