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
      console.error("Failed to load portfolio:", err);
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
      console.error("Upload failed:", err);
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
      console.error("Failed to save:", err);
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
      console.error("Failed to delete:", err);
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

  if (loading) return <p className="text-sm text-gray-400">Loading portfolio...</p>;

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
        <div className="text-center text-gray-400 py-8">
          <p className="text-4xl mb-3">💼</p>
          <p className="text-sm">Your portfolio is empty. Add your first item!</p>
        </div>
      ) : (
        Object.entries(grouped).map(([type, typeItems]) => (
          <div key={type}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {TYPE_ICONS[type] || "📁"} {TYPE_LABELS[type] || type} ({typeItems.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {typeItems.map((item) => (
                <div key={item.id} className="surface-section p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{item.title}</p>
                      {item.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.description}</p>
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

      {/* Add/Edit form */}
      {showForm ? (
        <div className="surface-section space-y-3 p-4">
          <h3 className="text-sm font-semibold text-gray-700">
            {editingId ? "Edit Item" : "Add Portfolio Item"}
          </h3>
          <input type="text" placeholder="Title" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="text" placeholder="Description (optional)" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-3">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="project">Project</option>
              <option value="cert">Certification</option>
              <option value="award">Award</option>
            </select>
            <input type="url" placeholder="Link URL (optional)" value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-200">
              {uploading ? "Uploading..." : form.fileId ? "File attached ✓" : "Attach file"}
            </button>
            {form.fileId && (
              <button onClick={() => setForm({ ...form, fileId: "" })} className="text-xs text-red-500">Remove file</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave}
              className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
              {editingId ? "Save" : "Add Item"}
            </button>
            <button onClick={resetForm} className="text-sm text-gray-500 px-4 py-2 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-gray-300 rounded-xl p-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
          + Add Portfolio Item
        </button>
      )}
    </div>
  );
}
