"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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
  const fileRef = useRef<HTMLInputElement>(null);

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
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/teacher/welcome-letter", { method: "POST", body: fd });
      if (res.ok) setExists(true);
      else alert((await res.json()).error || "Upload failed");
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete() {
    if (!confirm("Delete the current welcome letter?")) return;
    try {
      const res = await fetch("/api/teacher/welcome-letter", { method: "DELETE" });
      if (res.ok) setExists(false);
    } catch {
      alert("Delete failed");
    }
  }

  if (loading) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">Welcome Letter</h3>
      <p className="text-xs text-gray-500">
        Upload a welcome letter PDF that students can view from the orientation checklist.
      </p>
      {exists ? (
        <div className="flex items-center gap-3">
          <a
            href="/api/forms/download?formId=welcome-letter&mode=view"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-blue-600 hover:text-blue-800"
          >
            View current letter
          </a>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Replace"}
          </button>
          <button
            onClick={handleDelete}
            className="text-xs font-semibold text-red-500 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50"
        >
          {uploading ? "Uploading..." : "Upload Welcome Letter (PDF)"}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf"
        onChange={handleUpload}
        className="hidden"
      />
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
    <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 space-y-3">
      <input
        ref={labelRef}
        type="text"
        placeholder="Item label"
        value={form.label}
        onChange={(e) => setForm({ ...form, label: e.target.value })}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <input
        type="text"
        placeholder="Description (optional)"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={form.required}
          onChange={(e) => setForm({ ...form, required: e.target.checked })}
          className="rounded border-gray-300 text-blue-600"
        />
        Required for orientation completion
      </label>
      <div className="flex gap-2">
        <button
          onClick={() => form.label.trim() && onSave(form)}
          disabled={!form.label.trim()}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="text-sm text-gray-500 px-4 py-2 hover:text-gray-700"
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

  useEffect(() => { fetchItems(); }, [fetchItems]);

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
    if (!confirm("Delete this orientation item? Student progress for it will also be removed.")) return;
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

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  if (error) return (
    <div className="text-center py-12">
      <p className="text-red-600 mb-4">{error}</p>
      <button onClick={fetchItems} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        Try Again
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <WelcomeLetterSlot />

      <p className="text-xs text-gray-500">Drag items to reorder. Click Edit to modify.</p>

      {/* Item list */}
      {items.length === 0 ? (
        <div className="text-center text-gray-400 py-8 text-sm">
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
                className={`bg-white rounded-xl border p-4 flex items-start justify-between gap-3 cursor-grab active:cursor-grabbing transition-all ${
                  dragOverId === item.id
                    ? "border-blue-400 bg-blue-50 scale-[1.01]"
                    : dragId === item.id
                      ? "opacity-50 border-gray-200"
                      : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="mt-1 text-gray-300 text-sm select-none" aria-hidden="true">&#x2630;</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {item.label}
                      {item.required && (
                        <span className="ml-1.5 text-xs bg-red-50 text-red-500 px-1.5 py-0.5 rounded">Required</span>
                      )}
                    </p>
                    {item.description && (
                      <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => setEditingId(item.id)}
                    className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
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
          className="w-full border-2 border-dashed border-gray-300 rounded-xl p-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          + Add Orientation Item
        </button>
      )}
    </div>
  );
}
