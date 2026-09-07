"use client";

import { useEffect, useRef, useState } from "react";
import { JobCard } from "./JobCard";
import type { JobTrackingUpdate } from "./JobCard";
import type { JobMatchReason, JobWorkMode, SavedJobStatus } from "@/lib/job-board/types";

/**
 * UX finding #5 (2026-09-07 fluidity memo): up to 100 full JobCards used to
 * render as one uninterrupted scroll. First paint caps at this many cards;
 * "Show more jobs" reveals the rest of this list in one tap.
 */
export const JOB_LIST_PAGE_SIZE = 20;

/**
 * Which job index will receive focus once "Show more" reveals the rest —
 * the first card that was hidden a moment ago. `null` when every job
 * already fits on the first page (no reveal ever happens). Exported and
 * pure so the CRITICAL focus-target fix has a real unit test independent
 * of rendering — this repo's `.test.tsx` files only exercise
 * `renderToString`, which cannot render the post-click revealed state.
 */
export function firstRevealedIndex(totalJobs: number): number | null {
  return totalJobs > JOB_LIST_PAGE_SIZE ? JOB_LIST_PAGE_SIZE : null;
}

export interface ListJob {
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: JobWorkMode;
  salary: string | null;
  matchScore: number;
  matchLabel: "Strong match" | "Good match" | null;
  clusters: string[];
  skillOverlap?: string[];
  matchReasons?: JobMatchReason[];
  savedStatus: SavedJobStatus | null;
  savedNotes?: string | null;
  savedAppliedAt?: string | null;
  url: string;
  postedAt?: string | null;
  createdAt?: string | null;
  source?: string | null;
}

interface JobListProps {
  jobs: ListJob[];
  onSave: (jobId: string, updates?: JobTrackingUpdate) => void | Promise<void>;
}

export function JobList({ jobs, onSave }: JobListProps) {
  // Adjust-during-render (same pattern as JobCard's draft-state reset):
  // a new `jobs` array means new data — from a filter change, a refetch
  // after a save, etc. — so pagination re-collapses to the first page
  // without an effect. Re-renders that pass the SAME array (e.g. an
  // unrelated parent state update) leave revealedAll untouched.
  const [prevJobs, setPrevJobs] = useState(jobs);
  const [revealedAll, setRevealedAll] = useState(false);
  if (prevJobs !== jobs) {
    setPrevJobs(jobs);
    setRevealedAll(false);
  }

  // UX review CRITICAL (2026-09-07): "Show more jobs" used to unmount the
  // instant it was pressed (remaining drops to 0), dropping keyboard focus
  // to <body> with nothing to tell a screen-reader user what happened.
  // firstRevealedRef targets the first card that was hidden a moment ago —
  // JOB_LIST_PAGE_SIZE was already visible, so that card is index
  // JOB_LIST_PAGE_SIZE — and gets focus once the reveal actually happens.
  const firstRevealedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (revealedAll) {
      firstRevealedRef.current?.focus();
    }
  }, [revealedAll]);

  if (jobs.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--text-secondary)]">
        <p className="text-lg">No jobs available right now.</p>
        <p className="text-sm mt-1">Check back soon — new listings are added weekly.</p>
      </div>
    );
  }

  const visibleJobs = revealedAll ? jobs : jobs.slice(0, JOB_LIST_PAGE_SIZE);
  const remaining = jobs.length - visibleJobs.length;

  const focusTargetIndex = firstRevealedIndex(jobs.length);

  return (
    <div className="space-y-3">
      {visibleJobs.map((job, index) => {
        const isFirstRevealed = index === focusTargetIndex;
        return (
          <div
            key={job.id}
            ref={isFirstRevealed ? firstRevealedRef : undefined}
            tabIndex={isFirstRevealed ? -1 : undefined}
            data-first-revealed={isFirstRevealed ? "true" : undefined}
          >
            <JobCard {...job} onSave={onSave} />
          </div>
        );
      })}
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setRevealedAll(true)}
          className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--primary)]"
        >
          Show {remaining} more jobs
        </button>
      )}
      <div aria-live="polite" className="sr-only">
        {revealedAll ? `Showing all ${jobs.length} jobs` : ""}
      </div>
    </div>
  );
}
