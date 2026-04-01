"use client";

import { useState, useCallback } from "react";
import { Briefcase } from "@phosphor-icons/react";
import { JobCard } from "./JobCard";
import Link from "next/link";

interface WidgetJob {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  matchScore: number;
  matchLabel: "Strong match" | "Good match" | null;
  clusters: string[];
  savedStatus: string | null;
  url: string;
}

interface JobBoardWidgetProps {
  jobs: WidgetJob[];
  hasDiscovery: boolean;
}

export function JobBoardWidget({ jobs, hasDiscovery }: JobBoardWidgetProps) {
  const [savedIds, setSavedIds] = useState<Set<string>>(
    new Set(jobs.filter((j) => j.savedStatus).map((j) => j.id)),
  );

  const handleSave = useCallback(async (jobId: string) => {
    const res = await fetch("/api/jobs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobListingId: jobId }),
    });
    if (res.ok) {
      setSavedIds((prev) => new Set([...prev, jobId]));
    }
  }, []);

  if (jobs.length === 0) return null;

  // Show top 4 recommended jobs
  const topJobs = jobs.slice(0, 4);

  return (
    <div className="surface-section rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Briefcase size={20} className="text-[var(--primary)]" />
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Job Matches</h2>
        </div>
        <Link
          href="/jobs"
          className="text-sm text-[var(--primary)] hover:underline"
        >
          View all →
        </Link>
      </div>

      {!hasDiscovery && (
        <p className="text-sm text-[var(--text-secondary)] mb-3">
          Complete your career assessment to get personalized job recommendations.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {topJobs.map((job) => (
          <JobCard
            key={job.id}
            {...job}
            savedStatus={savedIds.has(job.id) ? "saved" : job.savedStatus}
            compact
            onSave={handleSave}
          />
        ))}
      </div>
    </div>
  );
}
