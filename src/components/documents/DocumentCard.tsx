"use client";

import { useState, useCallback } from "react";

export interface DocumentInfo {
  id: string;
  title: string;
  description: string | null;
  mimeType: string;
  sizeBytes: number | null;
  category: string;
  audience: string;
  platformId: string | null;
  certificationId: string | null;
}

const FILE_ICONS: Record<string, string> = {
  "application/pdf": "📄",
  "image/png": "🖼️",
  "image/jpeg": "🖼️",
  "image/gif": "🖼️",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "📊",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "📝",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "📊",
  "audio/mpeg": "🎵",
  "video/x-msvideo": "🎬",
};

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentCard({
  document: doc,
  compact = false,
}: {
  document: DocumentInfo;
  compact?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const icon = FILE_ICONS[doc.mimeType] || "📎";

  const viewUrl = `/api/documents/download?id=${doc.id}&mode=view`;

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setDownloadError(false);
    try {
      const res = await fetch(`/api/documents/download?id=${doc.id}&mode=download`);
      if (!res.ok) {
        setDownloadError(true);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), {
        href: url,
        download: doc.title,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }, [doc.id, doc.title]);

  if (compact) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 transition-shadow hover:shadow-sm sm:flex-row sm:items-center">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[rgba(16,37,62,0.06)] text-lg">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-sm font-medium leading-5 text-[var(--ink-strong)]">{doc.title}</p>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1 sm:w-auto sm:flex-nowrap">
          <a
            href={viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-[2.5rem] flex-1 items-center justify-center rounded-lg p-2 text-[var(--ink-muted)] transition-colors hover:bg-[rgba(16,37,62,0.06)] hover:text-[var(--ink-strong)] sm:flex-none"
            aria-label={`View ${doc.title}`}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          </a>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex min-w-[2.5rem] flex-1 items-center justify-center rounded-lg p-2 text-[var(--ink-muted)] transition-colors hover:bg-[rgba(16,37,62,0.06)] hover:text-[var(--ink-strong)] disabled:opacity-40 sm:flex-none"
            aria-label={`Download ${doc.title}`}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v9m0 0-3-3m3 3 3-3M3 13h10" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 transition-shadow hover:shadow-md sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 text-2xl">{icon}</span>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-sm font-semibold leading-5 text-[var(--ink-strong)]">{doc.title}</h3>
            {doc.description && (
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-[var(--ink-muted)]">{doc.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {doc.sizeBytes ? (
                <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink-muted)]">
                  {formatSize(doc.sizeBytes)}
                </span>
              ) : null}
              {doc.mimeType !== "application/pdf" && (
                <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink-muted)]">
                  {doc.mimeType.split("/").pop()?.toUpperCase()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <a
            href={viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-xl px-3 py-2 text-center text-xs font-medium text-[var(--accent-secondary)] transition-colors hover:bg-[rgba(16,37,62,0.06)] sm:flex-none"
            aria-label={`View ${doc.title}`}
          >
            View
          </a>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex-1 rounded-xl px-3 py-2 text-center text-xs font-medium text-[var(--accent-secondary)] transition-colors hover:bg-[rgba(16,37,62,0.06)] disabled:opacity-40 sm:flex-none"
            aria-label={`Download ${doc.title}`}
          >
            {downloading ? "..." : downloadError ? "Failed" : "Download"}
          </button>
        </div>
      </div>
      {downloadError && (
        <p role="alert" className="mt-2 text-xs text-red-600">Download failed. Try again or use View.</p>
      )}
    </div>
  );
}
