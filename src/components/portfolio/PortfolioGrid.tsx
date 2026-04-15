"use client";

import { useState, useEffect, useRef } from "react";

interface PortfolioItem {
  id: string;
  title: string;
  description: string | null;
  type: string;
  fileId: string | null;
  url: string | null;
}

const TYPE_ICONS: Record<string, string> = {
  project: "🛠️",
  cert: "📜",
  resume: "📝",
  award: "🏅",
};

const TYPE_LABELS: Record<string, string> = {
  project: "Project",
  cert: "Certification",
  resume: "Resume",
  award: "Award",
};

export default function PortfolioGrid() {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ title: "", description: "", type: "project", url: "", fileId: "" });

  useEffect(() => {
    fetchItems();
  }, []);

  async function fetchItems() {
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to load portfolio:", err instanceof Error ? err.message : "Unknown error");
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("File is too large. Maximum size is 10MB.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "portfolio");
      const res = await fetch("/api/files", { method: "POST", body: formData });
      if (res.ok) {
        const { file: uploaded } = await res.json();
        setForm((prev) => ({ ...prev, fileId: uploaded.id }));
      }
    } catch (err) {
      console.error("Upload failed:", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    const method = editingId ? "PUT" : "POST";
    const body = editingId ? { id: editingId, ...form } : form;

    try {
      const res = await fetch("/api/portfolio", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        resetForm();
        fetchItems();
      }
    } catch (err) {
      console.error("Failed to save:", err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this portfolio item?")) return;
    try {
      await fetch("/api/portfolio", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      fetchItems();
    } catch (err) {
      console.error("Failed to delete:", err instanceof Error ? err.message : "Unknown error");
    }
  }

  function startEdit(item: PortfolioItem) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      description: item.description || "",
      type: item.type,
      url: item.url || "",
      fileId: item.fileId || "",
    });
    setShowForm(true);
  }

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ title: "", description: "", type: "project", url: "", fileId: "" });
  }

  if (loading) return <p className="text-sm text-[var(--ink-faint)]">Loading portfolio...</p>;

  if (error) return (
    <div className="text-center py-12">
      <p className="text-red-600 mb-4">{error}</p>
      <button onClick={fetchItems} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        Try Again
      </button>
    </div>
  );

  // Group by type
  const grouped: Record<string, PortfolioItem[]> = {};
  for (const item of items) {
    if (!grouped[item.type]) grouped[item.type] = [];
    grouped[item.type].push(item);
  }

  return (
    <div className="space-y-6">
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".pdf,.jpg,.jpeg,.png" className="hidden" />

      {items.length === 0 && !showForm ? (
        <div className="text-center text-[var(--ink-faint)] py-8">
          <p className="text-4xl mb-3">💼</p>
          <p className="text-sm">Your portfolio is empty. Add your first item!</p>
        </div>
      ) : (
        Object.entries(grouped).map(([type, typeItems]) => (
          <div key={type}>
            <h3 className="text-xs font-semibold text-[var(--ink-muted)] uppercase tracking-wide mb-2">
              {TYPE_ICONS[type] || "📁"} {TYPE_LABELS[type] || type} ({typeItems.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {typeItems.map((item) => (
                <div key={item.id} className="surface-section p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--ink-strong)]">{item.title}</p>
                      {item.description && (
                        <p className="text-xs text-[var(--ink-muted)] mt-1 line-clamp-2">{item.description}</p>
                      )}
                      <div className="flex gap-2 mt-2">
                        {item.fileId && (
                          <a href={`/api/files/download?id=${item.fileId}`} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-800">View file</a>
                        )}
                        {item.url && (
                          <a href={item.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-800">Open link ↗</a>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(item)} className="text-xs text-blue-600 hover:text-blue-800 px-1">Edit</button>
                      <button onClick={() => handleDelete(item.id)} className="text-xs text-red-500 hover:text-red-700 px-1">Del</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Add/Edit wizard */}
      {showForm ? (
        <div className="surface-section overflow-hidden p-5">
          <h3 className="font-display text-lg text-[var(--ink-strong)]">
            {editingId ? "Edit Portfolio Item" : "Add to Your Portfolio"}
          </h3>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {editingId ? "Update the details below." : "Choose what you'd like to add, then fill in the details."}
          </p>

          {/* Step 1: Type selector (visual cards) */}
          {!editingId && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { value: "cert", icon: "📜", label: "Certification", desc: "Industry credential or certificate" },
                { value: "project", icon: "🛠️", label: "Project", desc: "Work sample or class project" },
                { value: "award", icon: "🏅", label: "Award", desc: "Recognition or achievement" },
                { value: "resume", icon: "📝", label: "Document", desc: "Resume, letter, or reference" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm({ ...form, type: opt.value })}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all ${
                    form.type === opt.value
                      ? "border-[var(--accent-strong)] bg-[rgba(42,138,60,0.06)] shadow-sm"
                      : "border-[var(--border)] hover:border-[var(--accent-secondary)]"
                  }`}
                >
                  <span className="text-2xl">{opt.icon}</span>
                  <span className="text-sm font-semibold text-[var(--ink-strong)]">{opt.label}</span>
                  <span className="text-xs leading-4 text-[var(--ink-muted)]">{opt.desc}</span>
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Details */}
          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="portfolio-title" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                Title <span className="text-red-400">*</span>
              </label>
              <input
                id="portfolio-title"
                type="text"
                placeholder={form.type === "cert" ? "e.g., IC3 Digital Literacy Level 1" : "e.g., Customer Service Training Project"}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="field px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="portfolio-desc" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                Description <span className="text-[var(--ink-muted)]">(optional)</span>
              </label>
              <textarea
                id="portfolio-desc"
                placeholder="What did you learn or accomplish?"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="field px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="portfolio-url" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                Link <span className="text-[var(--ink-muted)]">(optional)</span>
              </label>
              <input
                id="portfolio-url"
                type="url"
                placeholder="https://..."
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                className="field px-4 py-3 text-sm"
              />
            </div>

            {/* File upload area */}
            <div>
              <p className="mb-1.5 text-sm font-medium text-[var(--ink-strong)]">
                Attach file <span className="text-[var(--ink-muted)]">(PDF, JPG, or PNG — max 10MB)</span>
              </p>
              {form.fileId ? (
                <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                  <span className="text-green-600 text-lg">✓</span>
                  <span className="flex-1 text-sm font-medium text-green-800">File attached</span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, fileId: "" })}
                    className="text-xs font-medium text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--ink-muted)] transition-colors hover:border-[var(--accent-secondary)] hover:text-[var(--accent-secondary)] disabled:opacity-50"
                >
                  {uploading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent-secondary)]" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      Click to upload a file
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={!form.title.trim()}
              className="primary-button px-6 py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {editingId ? "Save Changes" : "Add to Portfolio"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="text-sm font-medium text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            >
              Cancel
            </button>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border)] p-5 text-sm font-semibold text-[var(--ink-muted)] transition-colors hover:border-[var(--accent-secondary)] hover:text-[var(--accent-secondary)]"
        >
          <span className="text-lg">+</span> Add Portfolio Item
        </button>
      )}
    </div>
  );
}
