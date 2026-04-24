"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, Download, Eye, X, FileText, FilePdf, FileImage, File } from "@phosphor-icons/react";
import { api } from "@/lib/api";

/**
 * Shared document library browser. Mounted by role-specific page wrappers
 * (/library for students, /teacher/library, /admin/library). The API enforces
 * audience scoping — students never see TEACHER-only rows — so the client
 * can render whatever the server returns without per-role branching.
 *
 * Best-practice checklist applied here:
 * - Debounced search (500ms) → avoids thrashing the server on every keystroke.
 * - Offset/limit pagination with "Load more" → never pulls all 1400+ rows at once.
 * - Preview via iframe for PDFs and <img> for images; everything else falls
 *   back to download. Preview uses the same signed-URL endpoint as download.
 * - Download uses Content-Disposition: attachment so the browser offers a
 *   save dialog instead of navigating away.
 * - Keyboard-first: ESC closes preview, focus returns to the trigger, grid
 *   cards are tabbable buttons with aria-labels.
 * - File size formatted humanely; MIME type mapped to recognizable label.
 * - Empty/loading/error states each have their own branch.
 */

interface Document {
  id: string;
  title: string;
  description: string | null;
  mimeType: string;
  sizeBytes: number | null;
  category: string;
  audience: "STUDENT" | "TEACHER" | "BOTH";
  platformId: string | null;
  certificationId: string | null;
}

interface ApiResponse {
  documents: Document[];
  total: number;
  limit: number;
  offset: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  ORIENTATION: "Orientation",
  STUDENT_REFERRAL: "Student Referral",
  STUDENT_RESOURCE: "Student Resource",
  TEACHER_GUIDE: "Teacher Guide",
  TEACHER_LMS_SUPPORT: "LMS Support",
  LMS_PLATFORM_GUIDE: "LMS Platform Guide",
  CERTIFICATION_INFO: "Certification Info",
  CERTIFICATION_PREREQ: "Certification Prereq",
  DOHS_FORM: "DOHS Form",
  PROGRAM_POLICY: "Program Policy",
  READY_TO_WORK: "Ready-to-Work",
  SAGE_CONTEXT: "Sage Context",
  PRESENTATION: "Presentation",
};

const PAGE_SIZE = 50;

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeToLabel(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return mimeType.replace("image/", "").toUpperCase();
  if (mimeType.includes("wordprocessingml")) return "Word";
  if (mimeType.includes("presentationml")) return "PowerPoint";
  if (mimeType.includes("spreadsheetml")) return "Excel";
  if (mimeType === "text/plain") return "Text";
  return mimeType.split("/").pop()?.toUpperCase() ?? "File";
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType === "application/pdf") return <FilePdf weight="duotone" className={className} />;
  if (mimeType.startsWith("image/")) return <FileImage weight="duotone" className={className} />;
  if (mimeType.includes("wordprocessingml") || mimeType === "text/plain") {
    return <FileText weight="duotone" className={className} />;
  }
  return <File weight="duotone" className={className} />;
}

export default function LibraryBrowser() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Debounce search input → actual query variable after user stops typing.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), 500);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const buildUrl = useCallback(
    (opts: { offset: number }) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(opts.offset));
      if (category) params.set("category", category);
      if (debouncedSearch) params.set("search", debouncedSearch);
      return `/api/documents?${params.toString()}`;
    },
    [category, debouncedSearch],
  );

  // Initial / search / category change → reset paging, fetch page 1.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOffset(0);

    api
      .get<ApiResponse>(buildUrl({ offset: 0 }))
      .then((res) => {
        if (cancelled) return;
        setDocuments(res.documents);
        setTotal(res.total);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load documents. Try again in a moment.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [buildUrl]);

  const loadMore = useCallback(async () => {
    const nextOffset = offset + PAGE_SIZE;
    if (nextOffset >= total) return;
    setLoadingMore(true);
    try {
      const res = await api.get<ApiResponse>(buildUrl({ offset: nextOffset }));
      setDocuments((prev) => [...prev, ...res.documents]);
      setOffset(nextOffset);
    } catch {
      setError("Failed to load more documents.");
    } finally {
      setLoadingMore(false);
    }
  }, [buildUrl, offset, total]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const doc of documents) set.add(doc.category);
    // Always include the currently-selected category even if the page is empty.
    if (category) set.add(category);
    return Array.from(set).sort();
  }, [documents, category]);

  const openPreview = (doc: Document, triggerEl: HTMLButtonElement | null) => {
    previewTriggerRef.current = triggerEl;
    setPreviewDoc(doc);
  };

  const closePreview = useCallback(() => {
    setPreviewDoc(null);
    // Return focus to whatever opened the preview so keyboard users don't lose place.
    previewTriggerRef.current?.focus();
  }, []);

  // ESC to close preview
  useEffect(() => {
    if (!previewDoc) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewDoc, closePreview]);

  const canLoadMore = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-4">
      {/* Search + category filters */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <MagnifyingGlass
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-muted)]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search documents by title or description…"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] py-2.5 pl-10 pr-4 text-sm outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent-secondary)]/40"
            aria-label="Search documents"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategory(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === null
                ? "bg-[var(--accent-strong)] text-white"
                : "border border-[var(--border)] text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
            }`}
            aria-pressed={category === null}
          >
            All
          </button>
          {availableCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                category === cat
                  ? "bg-[var(--accent-strong)] text-white"
                  : "border border-[var(--border)] text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
              }`}
              aria-pressed={category === cat}
            >
              {CATEGORY_LABELS[cat] ?? cat}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div
        className="flex items-center justify-between text-xs text-[var(--ink-muted)]"
        aria-live="polite"
      >
        {loading
          ? "Loading…"
          : error
            ? null
            : total === 0
              ? "No documents match."
              : `Showing ${Math.min(documents.length, total)} of ${total}`}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--error)]"
        >
          {error}
        </div>
      )}

      {loading ? (
        <SkeletonGrid />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {documents.map((doc) => (
              <li key={doc.id}>
                <DocumentCard doc={doc} onPreview={openPreview} />
              </li>
            ))}
          </ul>

          {canLoadMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-5 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-muted)] disabled:cursor-wait disabled:opacity-60"
              >
                {loadingMore ? "Loading…" : `Load ${Math.min(PAGE_SIZE, total - offset - PAGE_SIZE)} more`}
              </button>
            </div>
          )}
        </>
      )}

      {previewDoc && <PreviewModal doc={previewDoc} onClose={closePreview} />}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="h-36 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]"
        />
      ))}
    </ul>
  );
}

interface DocumentCardProps {
  doc: Document;
  onPreview: (doc: Document, triggerEl: HTMLButtonElement | null) => void;
}

function DocumentCard({ doc, onPreview }: DocumentCardProps) {
  const previewRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="group flex h-full flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 transition-shadow hover:shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-3">
        <FileIcon
          mimeType={doc.mimeType}
          className="mt-0.5 size-8 shrink-0 text-[var(--accent-strong)]"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-[var(--ink-strong)]" title={doc.title}>
            {doc.title}
          </h3>
          {doc.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--ink-muted)]">{doc.description}</p>
          )}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[0.65rem] text-[var(--ink-muted)]">
          <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 font-medium uppercase tracking-wide">
            {mimeToLabel(doc.mimeType)}
          </span>
          <span>{formatFileSize(doc.sizeBytes)}</span>
          <span className="hidden truncate sm:inline">
            · {CATEGORY_LABELS[doc.category] ?? doc.category}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            ref={previewRef}
            type="button"
            onClick={() => onPreview(doc, previewRef.current)}
            className="rounded-md p-1.5 text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--accent-strong)]"
            aria-label={`Preview ${doc.title}`}
          >
            <Eye weight="bold" className="size-4" />
          </button>
          <a
            href={`/api/documents/download?id=${doc.id}&mode=download`}
            className="rounded-md p-1.5 text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--accent-strong)]"
            aria-label={`Download ${doc.title}`}
          >
            <Download weight="bold" className="size-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const previewUrl = `/api/documents/download?id=${doc.id}&mode=view`;
  const canInline = doc.mimeType === "application/pdf" || doc.mimeType.startsWith("image/");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${doc.title}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-[var(--ink-strong)]">{doc.title}</h2>
            <p className="text-xs text-[var(--ink-muted)]">
              {mimeToLabel(doc.mimeType)} · {formatFileSize(doc.sizeBytes)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/documents/download?id=${doc.id}&mode=download`}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-muted)]"
            >
              <Download weight="bold" className="size-3.5" /> Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]"
              aria-label="Close preview"
            >
              <X weight="bold" className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-[var(--surface-muted)]">
          {canInline ? (
            doc.mimeType === "application/pdf" ? (
              <iframe
                src={previewUrl}
                title={doc.title}
                className="h-full w-full border-0"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={doc.title}
                className="mx-auto max-h-full max-w-full object-contain"
              />
            )
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div className="max-w-sm space-y-3">
                <p className="text-sm text-[var(--ink-muted)]">
                  Preview isn&apos;t available for this file type. Download to view it locally.
                </p>
                <a
                  href={`/api/documents/download?id=${doc.id}&mode=download`}
                  className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-strong)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  <Download weight="bold" className="size-4" /> Download {mimeToLabel(doc.mimeType)}
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
