"use client";

import { useState, useEffect, useRef } from "react";
import CertificateDownload from "@/components/ui/CertificateDownload";

interface CertRequirement {
  id: string | null;
  templateId: string;
  label: string;
  description: string | null;
  url: string | null;
  required: boolean;
  needsFile: boolean;
  needsVerify: boolean;
  completed: boolean;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  fileId: string | null;
  notes: string | null;
}

interface CertData {
  certification: { id: string; status: string; startedAt: string; completedAt: string | null } | null;
  requirements: CertRequirement[];
  total: number;
  done: number;
  studentName: string;
}

export default function CertTracker() {
  const [data, setData] = useState<CertData | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);

  useEffect(() => {
    fetchCert();
  }, []);

  async function fetchCert() {
    try {
      const res = await fetch("/api/certifications");
      if (res.ok) {
        const result = await res.json();
        setData(result);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to load certification:", err instanceof Error ? err.message : "Unknown error");
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleRequirement(requirementId: string, completed: boolean) {
    setToggling(requirementId);
    try {
      const res = await fetch("/api/certifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirementId, completed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Could not update this requirement.");
        return;
      }
      setError(null);
      fetchCert();
    } catch (err) {
      console.error("Failed to toggle requirement:", err instanceof Error ? err.message : "Unknown error");
      setError("Could not update this requirement.");
    } finally {
      setToggling(null);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadTarget) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("File is too large. Maximum size is 10MB.");
      return;
    }

    setUploading(uploadTarget);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "certification");

      const uploadRes = await fetch("/api/files", { method: "POST", body: formData });
      if (uploadRes.ok) {
        const { file: uploadedFile } = await uploadRes.json();
        // Attach file to requirement
        const attachRes = await fetch("/api/certifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requirementId: uploadTarget, fileId: uploadedFile.id }),
        });
        if (!attachRes.ok) {
          const data = await attachRes.json().catch(() => null);
          setError(data?.error || "Could not attach this file to the requirement.");
          return;
        }
        setError(null);
        fetchCert();
      } else {
        const data = await uploadRes.json().catch(() => null);
        setError(data?.error || "Could not upload this file.");
      }
    } catch (err) {
      console.error("Failed to upload file:", err instanceof Error ? err.message : "Unknown error");
      setError("Could not upload this file.");
    } finally {
      setUploading(null);
      setUploadTarget(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function triggerUpload(requirementId: string) {
    setUploadTarget(requirementId);
    fileInputRef.current?.click();
  }

  if (loading) return <p className="text-sm text-[var(--ink-faint)]">Loading certification...</p>;

  if (error) return (
    <div className="text-center py-12">
      <p className="text-red-600 mb-4">{error}</p>
      <button onClick={fetchCert} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        Try Again
      </button>
    </div>
  );

  if (!data || data.requirements.length === 0) {
    return (
      <div className="theme-card rounded-xl p-8 text-center text-[var(--ink-faint)]">
        <p className="text-4xl mb-3">🏆</p>
        <p className="text-sm">No certification requirements have been set up yet.</p>
        <p className="text-xs mt-1">Your teacher will configure the Ready to Work certification.</p>
      </div>
    );
  }

  const pct = data.total > 0 ? Math.round((data.done / data.total) * 100) : 0;
  const isComplete = data.certification?.status === "completed";

  return (
    <div className="space-y-4">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".pdf,.jpg,.jpeg,.png"
        className="hidden"
      />

      {/* Progress */}
      <div className="surface-section p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--ink-strong)]">SPOKES Ready to Work Certification</h3>
          {isComplete && (
            <span className="text-xs font-medium bg-green-100 text-green-700 px-2 py-1 rounded-full">
              Completed
            </span>
          )}
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-[var(--ink-muted)]">
            <span>{data.done} of {data.total} requirements</span>
            <span>{pct}%</span>
          </div>
          <div className="h-3 bg-[var(--surface-strong)] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isComplete
                  ? "bg-gradient-to-r from-green-400 to-green-500"
                  : "bg-gradient-to-r from-amber-400 to-amber-500"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Requirements */}
      <div className="space-y-2">
        {data.requirements.map((req) => (
          <div
            key={req.templateId}
            className={`bg-[var(--surface-raised)] rounded-xl border p-4 ${
              req.completed ? "border-green-200" : "border-[rgba(18,38,63,0.08)]"
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={req.completed}
                disabled={toggling === req.id || !req.id || (req.needsFile && !req.fileId && !req.completed)}
                onChange={() => req.id && toggleRequirement(req.id, !req.completed)}
                className="mt-0.5 h-4 w-4 rounded border-[var(--border-strong)] text-green-600 focus:ring-green-500"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${req.completed ? "text-green-800" : "text-[var(--ink-strong)]"}`}>
                  {req.label}
                  {req.required && <span className="ml-1 text-xs text-red-400 font-normal">*</span>}
                </p>
                {req.description && (
                  <p className="text-xs text-[var(--ink-muted)] mt-0.5">{req.description}</p>
                )}
                {req.url && (
                  <a
                    href={req.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mt-1"
                  >
                    Open lesson ↗
                  </a>
                )}

                {/* Status badges */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {req.needsVerify && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      req.verifiedBy
                        ? "bg-green-50 text-green-700"
                        : req.completed
                          ? "bg-yellow-50 text-yellow-600"
                          : "bg-[var(--surface-soft)] text-[var(--ink-faint)]"
                    }`}>
                      {req.verifiedBy ? "Verified" : req.completed ? "Pending verification" : "Needs verification"}
                    </span>
                  )}
                  {req.needsFile && (
                    <>
                      {req.fileId ? (
                        <a
                          href={`/api/files/download?id=${req.fileId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100"
                        >
                          View file
                        </a>
                      ) : (
                        <button
                          onClick={() => req.id && triggerUpload(req.id)}
                          disabled={uploading === req.id}
                          className="text-xs px-2 py-0.5 rounded-full bg-[var(--surface-soft)] text-[var(--ink-muted)] hover:bg-[var(--surface-interactive)]"
                        >
                          {uploading === req.id ? "Uploading..." : "Attach file"}
                        </button>
                      )}
                    </>
                  )}
                </div>
                {req.needsFile && !req.fileId && !req.completed && (
                  <p className="mt-2 text-xs text-[var(--ink-muted)]">
                    Attach the required file before marking this item complete.
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {isComplete && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center space-y-3">
          <p className="text-2xl mb-1">🎉🏆</p>
          <p className="text-sm font-medium text-green-800">
            Congratulations! You&apos;ve completed all certification requirements!
          </p>
          <CertificateDownload
            studentName={data.studentName}
            certificateType="Ready to Work"
            dateEarned={data.certification?.completedAt || new Date().toISOString()}
          />
        </div>
      )}
    </div>
  );
}
