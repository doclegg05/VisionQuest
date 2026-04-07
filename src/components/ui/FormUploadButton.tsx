"use client";

import { useRef, useState } from "react";

interface FormUploadButtonProps {
  formId: string;
  currentStatus?: "pending" | "approved" | "rejected" | null;
  onUploadComplete?: () => void;
  targetStudentId?: string;
}

export default function FormUploadButton({
  formId,
  currentStatus,
  onUploadComplete,
  targetStudentId,
}: FormUploadButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_SIZE = 10 * 1024 * 1024;
    const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
    if (file.size > MAX_SIZE) {
      setError("File too large (max 10 MB).");
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Only PDF, JPG, and PNG files are accepted.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("formId", formId);
      if (targetStudentId) {
        formData.append("studentId", targetStudentId);
      }

      const res = await fetch("/api/forms/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Upload failed.");
      } else {
        onUploadComplete?.();
      }
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Status badge rendering
  if (currentStatus === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        ✓ Approved
      </span>
    );
  }

  if (currentStatus === "pending") {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
          ⏳ Pending Review
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Upload document"
          className="text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
        >
          Re-upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    );
  }

  if (currentStatus === "rejected") {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-600">
          ✗ Rejected
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Upload document"
          className="text-xs font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
        >
          {uploading ? "Uploading..." : "Re-upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    );
  }

  // No submission yet — show upload button
  return (
    <div>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        aria-label="Upload document"
        className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(15,154,146,0.2)] bg-[rgba(15,154,146,0.06)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-secondary)] transition-colors hover:bg-[rgba(15,154,146,0.12)] disabled:opacity-50"
      >
        <span aria-hidden="true">📎</span>
        <span>{uploading ? "Uploading..." : "Upload Form"}</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={handleFileChange}
        className="hidden"
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
