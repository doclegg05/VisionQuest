"use client";

import { useState, useEffect, useRef } from "react";

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

export default function OrientationManager() {
  const [items, setItems] = useState<OrientationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", description: "", required: true });

  useEffect(() => {
    fetchItems();
  }, []);

  async function fetchItems() {
    try {
      setLoading(true);
      const res = await fetch("/api/teacher/orientation");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to load items:", err);
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!form.label.trim()) return;

    const method = editingId ? "PUT" : "POST";
    const body = editingId
      ? { id: editingId, ...form }
      : form;

    try {
      const res = await fetch("/api/teacher/orientation", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        resetForm();
        fetchItems();
      }
    } catch (err) {
      console.error("Failed to save item:", err);
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
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  }

  function startEdit(item: OrientationItem) {
    setEditingId(item.id);
    setForm({ label: item.label, description: item.description || "", required: item.required });
    setShowForm(true);
  }

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ label: "", description: "", required: true });
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

      {/* Item list */}
      {items.length === 0 ? (
        <div className="text-center text-gray-400 py-8 text-sm">
          No orientation items yet. Add one to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-xl border border-gray-200 p-4 flex items-start justify-between gap-3"
            >
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
              <div className="flex gap-1.5">
                <button
                  onClick={() => startEdit(item)}
                  className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit form */}
      {showForm ? (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">
            {editingId ? "Edit Item" : "New Orientation Item"}
          </h3>
          <input
            type="text"
            placeholder="Item label (e.g., 'Sign program agreement')"
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
              onClick={handleSave}
              className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              {editingId ? "Save Changes" : "Add Item"}
            </button>
            <button
              onClick={resetForm}
              className="text-sm text-gray-500 px-4 py-2 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-gray-300 rounded-xl p-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          + Add Orientation Item
        </button>
      )}
    </div>
  );
}
