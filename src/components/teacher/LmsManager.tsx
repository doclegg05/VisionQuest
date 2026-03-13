"use client";

import { useState, useEffect } from "react";

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
      console.error("Failed to load links:", err);
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
      console.error("Failed to save link:", err);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this course link?")) return;

    try {
      const res = await fetch("/api/teacher/lms", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) fetchLinks();
    } catch (err) {
      console.error("Failed to delete link:", err);
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

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  if (error) return (
    <div className="text-center py-12">
      <p className="text-red-600 mb-4">{error}</p>
      <button onClick={fetchLinks} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
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
      {/* Link list grouped by category */}
      {links.length === 0 ? (
        <div className="text-center text-gray-400 py-8 text-sm">
          No course links yet. Add one to get started.
        </div>
      ) : (
        Object.entries(grouped).map(([category, catLinks]) => (
          <div key={category}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {category} ({catLinks.length})
            </h3>
            <div className="space-y-2 mb-4">
              {catLinks.map((link) => (
                <div
                  key={link.id}
                  className="bg-white rounded-xl border border-gray-200 p-4 flex items-start justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {link.icon && <span className="mr-1">{link.icon}</span>}
                      {link.title}
                    </p>
                    {link.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{link.description}</p>
                    )}
                    <p className="text-xs text-blue-500 mt-1 truncate">{link.url}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => startEdit(link)}
                      className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(link.id)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
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
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">
            {editingId ? "Edit Link" : "New Course Link"}
          </h3>
          <input
            type="text"
            placeholder="Title (e.g., 'Google IT Certificate')"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="url"
            placeholder="URL (e.g., https://coursera.org/...)"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-3">
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Icon emoji"
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              className="w-20 text-sm border border-gray-200 rounded-lg px-3 py-2 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              {editingId ? "Save Changes" : "Add Link"}
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
          + Add Course Link
        </button>
      )}
    </div>
  );
}
