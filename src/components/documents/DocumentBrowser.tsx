"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DocumentCard, { type DocumentInfo } from "./DocumentCard";

// ─── Category labels for UI tabs ────────────────────────────────────────────

const DOC_CATEGORIES: Record<string, { label: string; icon: string }> = {
  ORIENTATION:        { label: "Orientation",       icon: "📋" },
  STUDENT_REFERRAL:   { label: "Referral Forms",    icon: "📝" },
  STUDENT_RESOURCE:   { label: "Student Resources", icon: "📚" },
  TEACHER_GUIDE:      { label: "Teacher Guides",    icon: "👩\u200D🏫" },
  TEACHER_LMS_SUPPORT:{ label: "LMS Support",       icon: "🖥️" },
  LMS_PLATFORM_GUIDE: { label: "Platform Guides",   icon: "📖" },
  CERTIFICATION_INFO: { label: "Certification Info", icon: "🏆" },
  CERTIFICATION_PREREQ:{ label: "Prerequisites",    icon: "📋" },
  DOHS_FORM:          { label: "DoHS Forms",        icon: "🏛️" },
  PROGRAM_POLICY:     { label: "Policies",          icon: "📜" },
  READY_TO_WORK:      { label: "Ready to Work",     icon: "💼" },
  SAGE_CONTEXT:       { label: "Sage Context",      icon: "🤖" },
  PRESENTATION:       { label: "Presentations",     icon: "📊" },
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface DocumentBrowserProps {
  /** Pre-filter to specific category(s). Omit for all categories. */
  category?: string | string[];
  /** Pre-filter to a specific platform. */
  platformId?: string;
  /** Pre-filter to a specific certification. */
  certificationId?: string;
  /** Show the category filter tabs? Default true. */
  showCategoryFilter?: boolean;
  /** Show the search bar? Default true. */
  showSearch?: boolean;
  /** Compact card rendering for embedding. */
  compact?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DocumentBrowser({
  category,
  platformId,
  certificationId,
  showCategoryFilter = true,
  showSearch = true,
  compact = false,
}: DocumentBrowserProps) {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [fetchKey, setFetchKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce search input; clear timer on unmount
  const handleSearch = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(value), 300);
  }, []);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // Fetch documents from API
  useEffect(() => {
    let cancelled = false;

    async function fetchDocs() {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      // If single category prop, send as server filter
      if (typeof category === "string") params.set("category", category);
      if (platformId) params.set("platformId", platformId);
      if (certificationId) params.set("certificationId", certificationId);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      try {
        const res = await fetch(`/api/documents?${params}`);
        if (!res.ok) throw new Error("Failed to load documents");
        const data = await res.json();
        if (!cancelled) setDocuments(data.documents);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchDocs();
    return () => { cancelled = true; };
  }, [category, platformId, certificationId, searchQuery, fetchKey]);

  // Collapse exact duplicates (same title, size, and category) to a single row.
  // Admins have uploaded the same file more than once in several categories;
  // this hides the duplicates without deleting the underlying rows.
  const uniqueDocuments = useMemo(() => {
    const seen = new Set<string>();
    const result: DocumentInfo[] = [];
    for (const d of documents) {
      const key = `${d.category}|${d.title}|${d.sizeBytes ?? "?"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(d);
    }
    return result;
  }, [documents]);

  // Client-side filtering for array category props and category tab selection
  const filtered = useMemo(() => {
    let result = uniqueDocuments;
    if (Array.isArray(category)) {
      result = result.filter((d) => category.includes(d.category));
    }
    if (selectedCategory !== "all") {
      result = result.filter((d) => d.category === selectedCategory);
    }
    return result;
  }, [uniqueDocuments, selectedCategory, category]);

  // Group by category for section rendering
  const grouped = useMemo(() => {
    const map = new Map<string, DocumentInfo[]>();
    for (const doc of filtered) {
      const list = map.get(doc.category) || [];
      list.push(doc);
      map.set(doc.category, list);
    }
    return map;
  }, [filtered]);

  // Available categories — use only categories that actually have documents after filtering
  const availableCategories = useMemo(() => {
    const source = Array.isArray(category)
      ? uniqueDocuments.filter((d) => category.includes(d.category))
      : uniqueDocuments;
    const cats = new Set(source.map((d) => d.category));
    return [...cats].sort();
  }, [uniqueDocuments, category]);

  return (
    <div className="space-y-6">
      {/* Screen reader announcement for search results */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {!loading && !error && filtered.length === 0 && "No documents match your search."}
        {!loading && !error && filtered.length > 0 && `${filtered.length} document${filtered.length === 1 ? "" : "s"} found.`}
        {loading && "Loading documents."}
      </div>

      {/* Search bar */}
      {showSearch && (
        <>
          <label htmlFor="doc-search" className="sr-only">Search documents</label>
          <input
            id="doc-search"
            type="text"
            placeholder="Search documents by title or description..."
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            aria-label="Search documents by title or description"
            className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-5 py-3 text-sm text-[var(--ink-strong)] placeholder:text-[var(--muted)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent-secondary)]/40"
          />
        </>
      )}

      {/* Category filter tabs */}
      {showCategoryFilter && availableCategories.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          <button
            type="button"
            onClick={() => setSelectedCategory("all")}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              selectedCategory === "all"
                ? "bg-[var(--accent-strong)] text-white"
                : "border border-[var(--border)] text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
            }`}
          >
            All ({Array.isArray(category) ? uniqueDocuments.filter((d) => category.includes(d.category)).length : uniqueDocuments.length})
          </button>
          {availableCategories.map((cat) => {
            const meta = DOC_CATEGORIES[cat];
            if (!meta) return null;
            const count = uniqueDocuments.filter((d) => d.category === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  selectedCategory === cat
                    ? "bg-[var(--accent-strong)] text-white"
                    : "border border-[var(--border)] text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                {meta.icon} {meta.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent-secondary)]" />
          <p className="mt-3 text-sm text-[var(--ink-muted)]">Loading documents...</p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => setFetchKey((k) => k + 1)}
            className="mt-2 text-xs font-medium text-red-600 underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-[var(--ink-muted)]">
          No documents match your search.
        </p>
      )}

      {/* Document sections */}
      {!loading && !error && (
        <>
          {[...grouped.entries()].map(([cat, docs]) => {
            const meta = DOC_CATEGORIES[cat] || { label: cat, icon: "📄" };
            return (
              <CategorySection
                key={cat}
                icon={meta.icon}
                label={meta.label}
                count={docs.length}
                defaultOpen={grouped.size <= 3}
              >
                <div className={compact ? "space-y-2" : "space-y-3"}>
                  {docs.map((doc) => (
                    <DocumentCard key={doc.id} document={doc} compact={compact} />
                  ))}
                </div>
              </CategorySection>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── Collapsible category section ───────────────────────────────────────────

function CategorySection({
  icon,
  label,
  count,
  defaultOpen = true,
  children,
}: {
  icon: string;
  label: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left"
      >
        <span aria-hidden="true" className="text-2xl">{icon}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg text-[var(--ink-strong)]">{label}</h2>
            <span className="rounded-full bg-[var(--accent-strong)] px-2.5 py-0.5 text-xs font-semibold text-white">
              {count}
            </span>
          </div>
        </div>
        <span
          className="text-[var(--ink-muted)] transition-transform duration-200"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        >
          ▾
        </span>
      </button>

      {open && <div className="mt-4">{children}</div>}
    </section>
  );
}
