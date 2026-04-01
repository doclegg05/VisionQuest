"use client";

import { useState, useEffect, useCallback } from "react";
import { Briefcase, MagnifyingGlass, BookmarkSimple } from "@phosphor-icons/react";
import { JobRecommendations } from "@/components/jobs/JobRecommendations";
import { JobFilters } from "@/components/jobs/JobFilters";
import { JobList } from "@/components/jobs/JobList";

interface JobData {
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

interface JobsResponse {
  jobs: JobData[];
  hasDiscovery: boolean;
  totalActive: number;
  totalSaved: number;
}

export default function JobsPage() {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [cluster, setCluster] = useState("");
  const [sort, setSort] = useState("recommended");

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (cluster) params.set("cluster", cluster);
      if (sort) params.set("sort", sort);

      const res = await fetch(`/api/jobs?${params}`);
      if (!cancelled && res.ok) {
        const json = await res.json();
        setData(json);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [cluster, sort, refreshKey]);

  const handleSave = useCallback(async (jobId: string) => {
    const res = await fetch("/api/jobs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobListingId: jobId }),
    });
    if (res.ok) {
      setRefreshKey((k) => k + 1);
    }
  }, []);

  const matchedCount = data?.jobs.filter((j) => j.matchScore >= 50).length ?? 0;

  return (
    <div className="page-shell space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--primary)]">Career</p>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-1">Job Board</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Local job listings matched to your career profile.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="surface-section rounded-xl p-4 text-center">
          <Briefcase size={24} className="mx-auto text-[var(--primary)] mb-1" />
          <p className="text-2xl font-bold text-[var(--text-primary)]">{data?.totalActive ?? 0}</p>
          <p className="text-xs text-[var(--text-secondary)]">Available</p>
        </div>
        <div className="surface-section rounded-xl p-4 text-center">
          <MagnifyingGlass size={24} className="mx-auto text-[var(--accent)] mb-1" />
          <p className="text-2xl font-bold text-[var(--text-primary)]">{matchedCount}</p>
          <p className="text-xs text-[var(--text-secondary)]">Matched</p>
        </div>
        <div className="surface-section rounded-xl p-4 text-center">
          <BookmarkSimple size={24} className="mx-auto text-[var(--warning)] mb-1" />
          <p className="text-2xl font-bold text-[var(--text-primary)]">{data?.totalSaved ?? 0}</p>
          <p className="text-xs text-[var(--text-secondary)]">Saved</p>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="text-center py-12 text-[var(--text-secondary)]">Loading jobs...</div>
      )}

      {!loading && data && (
        <>
          {/* Assessment nudge */}
          {!data.hasDiscovery && (
            <div className="surface-section rounded-xl p-4 border-l-4 border-[var(--warning)]">
              <p className="text-sm text-[var(--text-primary)] font-medium">
                Complete your career assessment to get personalized job recommendations.
              </p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Chat with Sage about your interests and skills to unlock matched jobs.
              </p>
            </div>
          )}

          {/* Recommendations section */}
          {data.hasDiscovery && (
            <JobRecommendations jobs={data.jobs} onSave={handleSave} />
          )}

          {/* Filters */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">All Jobs</h2>
            <JobFilters
              cluster={cluster}
              sort={sort}
              onClusterChange={setCluster}
              onSortChange={setSort}
            />
          </div>

          {/* All jobs list */}
          <JobList jobs={data.jobs} onSave={handleSave} />
        </>
      )}
    </div>
  );
}
