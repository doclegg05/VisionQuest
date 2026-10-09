"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useConfirm } from "@/components/ui/useConfirm";

interface OrientationItem {
  id: string;
  label: string;
  description: string | null;
  required: boolean;
  sortOrder: number;
}

// ─── Welcome Letter Upload Widget ────────────────────────────────────────────

function WelcomeLetterSlot() {
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    fetch("/api/teacher/welcome-letter")
      .then((r) => r.ok ? r.json() : { exists: false })
      .then((d) => setExists(d.exists))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setActionError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/teacher/welcome-letter", { method: "POST", body: fd });
      if (res.ok) setExists(true);
      else setActionError((await res.json()).error || "Upload failed");
    } catch {
      setActionError("Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete() {
    if (!(await confirm({
      title: "Delete the current welcome letter?",
      message: "Students can no longer open it from the orientation checklist.",
      confirmLabel: "Delete",
    }))) return;
    setActionError(null);
    try {
      const res = await fetch("/api/teacher/welcome-letter", { method: "DELETE" });
      if (res.ok) setExists(false);
    } catch {
      setActionError("Delete failed");
    }
  }

  if (loading) return null;

  return (
    <div className="theme-card rounded-xl p-4 space-y-2">
      <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Welcome Letter</h3>
      <p className="text-xs text-[var(--ink-muted)]">
        Upload a welcome letter PDF that students can view from the orientation checklist.
      </p>
      {exists ? (
        <div className="flex items-center gap-3">
          <a
            href="/api/forms/download?formId=welcome-letter&mode=view"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center pointer-coarse:min-h-11 text-xs font-semibold text-[var(--badge-info-text)] hover:underline"
          >
            View current letter
          </a>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center pointer-coarse:min-h-11 text-xs font-semibold text-[var(--badge-info-text)] hover:underline disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Replace"}
          </button>
          <button
            onClick={handleDelete}
            className="inline-flex items-center pointer-coarse:min-h-11 text-xs font-semibold text-[var(--badge-error-text)] hover:underline"
          >
            Delete
          </button>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center pointer-coarse:min-h-11 text-xs font-semibold text-[var(--badge-info-text)] hover:underline disabled:opacity-50"
        >
          {uploading ? "Uploading..." : "Upload Welcome Letter (PDF)"}
        </button>
      )}
      {actionError && (
        <p role="alert" className="text-xs text-[var(--badge-error-text)]">
          {actionError}
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf"
        onChange={handleUpload}
        aria-label="Welcome letter PDF"
        className="hidden"
      />
      {confirmDialog}
    </div>
  );
}

// ─── Inline Edit Form ────────────────────────────────────────────────────────

function InlineEditForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: { label: string; description: string; required: boolean };
  onSave: (data: { label: string; description: string; required: boolean }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  return (
    <div className="bg-[var(--badge-info-bg)]/50 rounded-xl border border-[var(--badge-info-bg)] p-4 space-y-3">
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium text-[var(--ink-strong)]">Item label</span>
        <input
          ref={labelRef}
          type="text"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium text-[var(--ink-strong)]">Description (optional)</span>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
        <input
          type="checkbox"
          checked={form.required}
          onChange={(e) => setForm({ ...form, required: e.target.checked })}
          className="rounded border-[var(--border-strong)] accent-[var(--accent-blue)]"
        />
        Required for orientation completion
      </label>
      <div className="flex gap-2">
        <button
          onClick={() => form.label.trim() && onSave(form)}
          disabled={!form.label.trim()}
          className="primary-button text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 pointer-coarse:min-h-11"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center pointer-coarse:min-h-11 text-sm text-[var(--ink-muted)] px-4 py-2 hover:text-[var(--ink-strong)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function OrientationManager() {
  const [items, setItems] = useState<OrientationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/teacher/orientation");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setError(null);
      }
    } catch {
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await fetchItems();
    })();
  }, [fetchItems]);

  async function handleSave(id: string | null, data: { label: string; description: string; required: boolean }) {
    const method = id ? "PUT" : "POST";
    const body = id ? { id, ...data } : data;

    try {
      const res = await fetch("/api/teacher/orientation", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditingId(null);
        setAddingNew(false);
        fetchItems();
      }
    } catch {
      // Error handling
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({
      title: "Delete this orientation item?",
      message: "Student progress for it is also removed.",
      confirmLabel: "Delete",
    }))) return;
    try {
      const res = await fetch("/api/teacher/orientation", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) fetchItems();
    } catch {
      // Error handling
    }
  }

  // ─── Drag and Drop ──────────────────────────────────────────────────────

  function handleDragStart(id: string) {
    setDragId(id);
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    if (id !== dragId) setDragOverId(id);
  }

  function handleDragLeave() {
    setDragOverId(null);
  }

  async function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    const oldIndex = items.findIndex((i) => i.id === dragId);
    const newIndex = items.findIndex((i) => i.id === targetId);
    if (oldIndex === -1 || newIndex === -1) return;

    // Reorder locally
    const reordered = [...items];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    setItems(reordered);
    setDragId(null);
    setDragOverId(null);

    // Save new sort orders to server
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].sortOrder !== i) {
        await fetch("/api/teacher/orientation", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: reordered[i].id, sortOrder: i }),
        });
      }
    }

    fetchItems();
  }

  function handleDragEnd() {
    setDragId(null);
    setDragOverId(null);
  }

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading...</p>;

  if (error) return (
    <div className="text-center py-12">
      <p className="text-[var(--badge-error-text)] mb-4">{error}</p>
      <button onClick={fetchItems} className="primary-button px-4 py-2 rounded-lg pointer-coarse:min-h-11">
        Try Again
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <WelcomeLetterSlot />

      <p className="text-xs text-[var(--ink-muted)]">Drag items to reorder. Click Edit to modify.</p>

      {/* Item list */}
      {items.length === 0 ? (
        <div className="text-center text-[var(--ink-muted)] py-8 text-sm">
          No orientation items yet. Add one to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            if (editingId === item.id) {
              return (
                <InlineEditForm
                  key={item.id}
                  initial={{ label: item.label, description: item.description || "", required: item.required }}
                  onSave={(data) => handleSave(item.id, data)}
                  onCancel={() => setEditingId(null)}
                />
              );
            }

            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => handleDragStart(item.id)}
                onDragOver={(e) => handleDragOver(e, item.id)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(item.id)}
                onDragEnd={handleDragEnd}
                className={[
                  "bg-[var(--surface-raised)] rounded-xl border p-4 flex items-start justify-between gap-3 cursor-grab active:cursor-grabbing transition-all",
                  dragOverId === item.id
                    ? "border-[var(--accent-blue)] bg-[var(--badge-info-bg)]/50 scale-[1.01]"
                    : dragId === item.id
                      ? "opacity-50 border-[var(--border)]"
                      : "border-[var(--border)] hover:border-[var(--border-strong)]",
                ].join(" ")}
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="mt-1 text-[var(--ink-faint)] text-sm select-none" aria-hidden="true">&#x2630;</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--ink-strong)]">
                      {item.label}
                      {item.required && (
                        <span className="ml-1.5 text-xs bg-[var(--badge-error-bg)] text-[var(--badge-error-text)] px-1.5 py-0.5 rounded">Required</span>
                      )}
                    </p>
                    {item.description && (
                      <p className="text-xs text-[var(--ink-muted)] mt-1">{item.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setEditingId(item.id)}
                    className="inline-flex items-center pointer-coarse:min-h-11 text-xs text-[var(--badge-info-text)] px-2 py-1 rounded hover:bg-[var(--badge-info-bg)] transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="inline-flex items-center pointer-coarse:min-h-11 text-xs text-[var(--badge-error-text)] px-2 py-1 rounded hover:bg-[var(--badge-error-bg)] transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add new form */}
      {addingNew ? (
        <InlineEditForm
          initial={{ label: "", description: "", required: true }}
          onSave={(data) => handleSave(null, data)}
          onCancel={() => setAddingNew(false)}
        />
      ) : (
        <button
          onClick={() => { setEditingId(null); setAddingNew(true); }}
          className="w-full border-2 border-dashed border-[var(--border-strong)] rounded-xl p-3 text-sm text-[var(--ink-muted)] hover:border-[var(--accent-blue)] hover:text-[var(--badge-info-text)] transition-colors"
        >
          + Add Orientation Item
        </button>
      )}
      {confirmDialog}
    </div>
  );
}
