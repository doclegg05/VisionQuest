"use client";

import { useState, useEffect } from "react";
import { useConfirm } from "@/components/ui/useConfirm";

interface LmsLink {
  id: string;
  title: string;
  description: string | null;
  url: string;
  category: string;
  icon: string | null;
}

const CATEGORIES = [
  "Career Training",
  "Digital Skills",
  "Education",
  "Financial Literacy",
  "Health & Wellness",
  "Job Search",
  "Life Skills",
  "Certifications",
];

export default function LmsManager() {
  const { confirm, confirmDialog } = useConfirm();
  const [links, setLinks] = useState<LmsLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    url: "",
    category: CATEGORIES[0],
    icon: "",
  });

  useEffect(() => {
    fetchLinks();
  }, []);

  async function fetchLinks() {
    try {
      setLoading(true);
      const res = await fetch("/api/teacher/lms");
      if (res.ok) {
        const data = await res.json();
        setLinks(data.links || []);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to load links:", err instanceof Error ? err.message : "Unknown error");
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!form.title.trim() || !form.url.trim()) return;

    const method = editingId ? "PUT" : "POST";
    const body = editingId
      ? { id: editingId, ...form }
      : form;

    try {
      const res = await fetch("/api/teacher/lms", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        resetForm();
        fetchLinks();
      }
    } catch (err) {
      console.error("Failed to save link:", err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function handleDelete(id: string) {
    if (
      !(await confirm({
        title: "Delete this course link?",
        message: "Students will no longer see it.",
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }

    try {
      const res = await fetch("/api/teacher/lms", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) fetchLinks();
    } catch (err) {
      console.error("Failed to delete link:", err instanceof Error ? err.message : "Unknown error");
    }
  }

  function startEdit(link: LmsLink) {
    setEditingId(link.id);
    setForm({
      title: link.title,
      description: link.description || "",
      url: link.url,
      category: link.category,
      icon: link.icon || "",
    });
    setShowForm(true);
  }

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ title: "", description: "", url: "", category: CATEGORIES[0], icon: "" });
  }

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading...</p>;

  if (error) return (
    <div className="surface-section px-6 py-10 text-center">
      <p className="mb-4 text-sm text-[var(--badge-error-text)]">{error}</p>
      <button onClick={fetchLinks} className="primary-button px-4 py-2 text-sm pointer-coarse:min-h-11">
        Try Again
      </button>
    </div>
  );

  // Group links by category for display
  const grouped: Record<string, LmsLink[]> = {};
  for (const link of links) {
    if (!grouped[link.category]) grouped[link.category] = [];
    grouped[link.category].push(link);
  }

  return (
    <div className="space-y-4">
      {confirmDialog}
      {/* Link list grouped by category */}
      {links.length === 0 ? (
        <div className="surface-section py-8 text-center text-sm text-[var(--ink-muted)]">
          No course links yet. Add one to get started.
        </div>
      ) : (
        Object.entries(grouped).map(([category, catLinks]) => (
          <div key={category}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              {category} ({catLinks.length})
            </h3>
            <div className="mb-4 space-y-2">
              {catLinks.map((link) => (
                <div
                  key={link.id}
                  className="surface-section flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--ink-strong)]">
                      {link.icon && <span className="mr-1">{link.icon}</span>}
                      {link.title}
                    </p>
                    {link.description && (
                      <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">{link.description}</p>
                    )}
                    <p className="mt-1 break-all text-xs leading-5 text-[var(--accent-secondary)]">{link.url}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                    <button
                      onClick={() => startEdit(link)}
                      className="inline-flex items-center pointer-coarse:min-h-11 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-secondary)] transition-colors hover:bg-[var(--surface-muted)]"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(link.id)}
                      className="inline-flex items-center pointer-coarse:min-h-11 rounded-full border border-[var(--badge-error-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--badge-error-text)] transition-colors hover:bg-[var(--badge-error-bg)]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Add/Edit form */}
      {showForm ? (
        <div className="surface-section space-y-3 p-4">
          <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
            {editingId ? "Edit Link" : "New Course Link"}
          </h3>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-[var(--ink-strong)]">Title</span>
            <input
              type="text"
              placeholder="e.g., Google IT Certificate"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="field px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-secondary)]"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-[var(--ink-strong)]">Description (optional)</span>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="field px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-secondary)]"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-[var(--ink-strong)]">URL</span>
            <input
              type="url"
              placeholder="e.g., https://coursera.org/..."
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="field px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-secondary)]"
            />
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="block flex-1 space-y-1.5">
              <span className="block text-sm font-medium text-[var(--ink-strong)]">Category</span>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="select-field w-full px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-secondary)]"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5 sm:w-24">
              <span className="block text-sm font-medium text-[var(--ink-strong)]">Icon emoji</span>
              <input
                type="text"
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                className="field w-full px-3 py-2.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-secondary)]"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSave}
              className="primary-button px-4 py-2 text-sm pointer-coarse:min-h-11"
            >
              {editingId ? "Save Changes" : "Add Link"}
            </button>
            <button
              onClick={resetForm}
              className="inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)] pointer-coarse:min-h-11"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full rounded-xl border-2 border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)] transition-colors hover:border-[var(--accent-secondary)] hover:text-[var(--accent-secondary)]"
        >
          + Add Course Link
        </button>
      )}
    </div>
  );
}
