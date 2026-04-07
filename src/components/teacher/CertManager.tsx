"use client";

import { useState, useEffect } from "react";

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
      console.error("Failed to load templates:", err);
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
      console.error("Failed to save template:", err);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this requirement? Student progress for it will also be removed.")) return;

    try {
      const res = await fetch("/api/teacher/certifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) fetchTemplates();
    } catch (err) {
      console.error("Failed to delete template:", err);
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
      <p className="text-red-600 mb-4">{error}</p>
      <button onClick={fetchTemplates} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
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
                    <span className="ml-1.5 text-xs bg-red-50 text-red-700 px-1.5 py-0.5 rounded">Required</span>
                  )}
                </p>
                {t.description && (
                  <p className="text-xs text-[var(--ink-muted)] mt-1">{t.description}</p>
                )}
                {t.url && (
                  <a href={t.url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-800 mt-1 inline-block">Lesson link ↗</a>
                )}
                <div className="flex gap-2 mt-1.5">
                  {t.needsFile && (
                    <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">File required</span>
                  )}
                  {t.needsVerify && (
                    <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">Needs verification</span>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => startEdit(t)} className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1">
                  Edit
                </button>
                <button onClick={() => handleDelete(t.id)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">
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
          <input
            type="text"
            placeholder="Requirement label (e.g., 'Complete Interview Skills module')"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="url"
            placeholder="Lesson URL (optional, e.g., GitHub Pages link)"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} className="rounded border-[var(--border-strong)] text-blue-600" />
              Required
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <input type="checkbox" checked={form.needsFile} onChange={(e) => setForm({ ...form, needsFile: e.target.checked })} className="rounded border-[var(--border-strong)] text-blue-600" />
              File upload needed
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <input type="checkbox" checked={form.needsVerify} onChange={(e) => setForm({ ...form, needsVerify: e.target.checked })} className="rounded border-[var(--border-strong)] text-blue-600" />
              Teacher verification
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
              {editingId ? "Save Changes" : "Add Requirement"}
            </button>
            <button onClick={resetForm} className="text-sm text-[var(--ink-muted)] px-4 py-2 hover:text-[var(--ink-strong)]">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-[var(--border-strong)] rounded-xl p-3 text-sm text-[var(--ink-muted)] hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          + Add Certification Requirement
        </button>
      )}
    </div>
  );
}
