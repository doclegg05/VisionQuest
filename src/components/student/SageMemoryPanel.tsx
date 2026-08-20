"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SageMemoryList, type SageMemoryEntry } from "./SageMemoryList";

const PAGE_LIMIT = 20;

interface MemoriesResponse {
  success: boolean;
  data: {
    memories: SageMemoryEntry[];
    pagination: { page: number; limit: number; total: number };
  };
}

/**
 * Fetches the student's own Sage memories (GET /api/student/memories) and
 * hands them to SageMemoryList to render. "Show more" appends the next page
 * rather than using page-number controls — simpler to read and tap for a
 * low-literacy, mobile-first audience.
 */
export function SageMemoryPanel() {
  const [memories, setMemories] = useState<SageMemoryEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (targetPage: number, append: boolean) => {
    try {
      const res = await api.get<MemoriesResponse>(
        `/api/student/memories?page=${targetPage}&limit=${PAGE_LIMIT}`,
      );
      setMemories((current) => (append ? [...(current ?? []), ...res.data.memories] : res.data.memories));
      setTotal(res.data.pagination.total);
      setPage(res.data.pagination.page);
      setError(null);
    } catch {
      setError("We could not load what Sage remembers right now. Please try again.");
      if (!append) setMemories([]);
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(1, false);
  }, [loadPage]);

  const showMore = () => {
    setLoadingMore(true);
    void loadPage(page + 1, true);
  };

  const hasMore = memories !== null && memories.length < total;

  return (
    <div>
      {error && (
        <p className="theme-card mb-4 rounded-xl p-4 text-sm text-[var(--error)]">{error}</p>
      )}

      {memories === null ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading...</p>
      ) : (
        <SageMemoryList memories={memories} />
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={showMore}
            disabled={loadingMore}
            className="min-h-11 rounded-full border border-[var(--border)] px-6 text-sm font-semibold text-[var(--ink-strong)] disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}
