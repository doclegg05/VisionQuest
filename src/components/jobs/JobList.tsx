"use client";

import { useState } from "react";
import { JobCard } from "./JobCard";
import type { JobTrackingUpdate } from "./JobCard";
import type { JobMatchReason, JobWorkMode, SavedJobStatus } from "@/lib/job-board/types";

/**
 * UX finding #5 (2026-09-07 fluidity memo): up to 100 full JobCards used to
 * render as one uninterrupted scroll. First paint caps at this many cards;
 * "Show more jobs" reveals the rest of this list in one tap.
 */
export const JOB_LIST_PAGE_SIZE = 20;

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

  return (
    <div className="space-y-3">
      {visibleJobs.map((job) => (
        <JobCard key={job.id} {...job} onSave={onSave} />
      ))}
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setRevealedAll(true)}
          className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--primary)]"
        >
          Show more jobs
        </button>
      )}
    </div>
  );
}
