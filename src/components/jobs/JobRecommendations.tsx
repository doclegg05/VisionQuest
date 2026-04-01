"use client";

import { JobCard } from "./JobCard";

interface RecommendedJob {
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

interface JobRecommendationsProps {
  jobs: RecommendedJob[];
  onSave: (jobId: string) => void;
}

export function JobRecommendations({ jobs, onSave }: JobRecommendationsProps) {
  // Only show jobs with score >= 50
  const recommended = jobs.filter((j) => j.matchScore >= 50);

  if (recommended.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
        Recommended for You
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {recommended.slice(0, 6).map((job) => (
          <div key={job.id} className="border-l-4 border-[var(--primary)] rounded-xl">
            <JobCard {...job} onSave={onSave} />
          </div>
        ))}
      </div>
    </section>
  );
}
