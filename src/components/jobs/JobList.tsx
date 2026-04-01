"use client";

import { JobCard } from "./JobCard";

interface ListJob {
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

interface JobListProps {
  jobs: ListJob[];
  onSave: (jobId: string) => void;
}

export function JobList({ jobs, onSave }: JobListProps) {
  if (jobs.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--text-secondary)]">
        <p className="text-lg">No jobs available right now.</p>
        <p className="text-sm mt-1">Check back soon — new listings are added weekly.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <JobCard key={job.id} {...job} onSave={onSave} />
      ))}
    </div>
  );
}
