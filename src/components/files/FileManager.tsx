"use client";

import { useState, useEffect, useRef } from "react";

interface FileRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  uploadedAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  certification: "Certification",
  portfolio: "Portfolio",
  orientation: "Orientation",
  resume: "Resume",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("image/")) return "🖼️";
  return "📎";
}

export default function FileManager() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("general");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchFiles();
  }, []);

  async function fetchFiles() {
    try {
      const res = await fetch("/api/files");
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to load files:", err);
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
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
      formData.append("category", category);

      const res = await fetch("/api/files", { method: "POST", body: formData });
      if (res.ok) {
        fetchFiles();
      } else {
        const err = await res.json();
        alert(err.error || "Upload failed");
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(id: string, filename: string) {
    if (!confirm(`Delete "${filename}"?`)) return;

    try {
      const res = await fetch("/api/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) fetchFiles();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading files...</p>;

  if (error) return (
    <div className="surface-section px-6 py-10 text-center">
      <p className="mb-4 text-sm text-red-600">{error}</p>
      <button onClick={fetchFiles} className="primary-button px-4 py-2 text-sm">
        Try Again
      </button>
    </div>
  );

  // Group files by category
  const grouped: Record<string, FileRecord[]> = {};
  for (const file of files) {
    const cat = file.category || "general";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(file);
  }

  return (
    <div className="space-y-6">
      {/* Upload section */}
      <div className="surface-section p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--ink-strong)]">Upload a File</h3>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-[var(--ink-muted)]">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="select-field w-full px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
            >
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleUpload}
              accept=".pdf,.jpg,.jpeg,.png,.gif"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              type="button"
              className="primary-button w-full px-4 py-2.5 text-sm disabled:opacity-50 sm:w-auto"
            >
              {uploading ? "Uploading..." : "Choose File"}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--ink-muted)]">PDF, JPG, PNG, or GIF. Max 10MB.</p>
      </div>

      {/* File list */}
      {files.length === 0 ? (
        <div className="surface-section py-10 text-center text-[var(--ink-muted)]">
          <p className="mb-3 text-4xl">📁</p>
          <p className="text-sm">No files uploaded yet.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([cat, catFiles]) => (
          <div key={cat}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              {CATEGORY_LABELS[cat] || cat} ({catFiles.length})
            </h3>
            <div className="space-y-2">
              {catFiles.map((file) => (
                <div
                  key={file.id}
                  className="surface-section flex flex-col gap-3 p-3.5 sm:flex-row sm:items-start sm:gap-4"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[rgba(16,37,62,0.06)] text-lg">
                      {fileIcon(file.mimeType)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-sm font-medium leading-5 text-[var(--ink-strong)]">{file.filename}</p>
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--ink-muted)]">
                      {formatFileSize(file.sizeBytes)} &middot;{" "}
                      {new Date(file.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <a
                      href={`/api/files/download?id=${file.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full border border-[rgba(18,38,63,0.1)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-secondary)] transition-colors hover:bg-[rgba(16,37,62,0.04)]"
                    >
                      View
                    </a>
                    <button
                      onClick={() => handleDelete(file.id, file.filename)}
                      className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50 hover:text-red-700"
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
    </div>
  );
}
