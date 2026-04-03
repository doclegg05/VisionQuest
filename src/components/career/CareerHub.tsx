"use client";

import { useCallback, useEffect, useState } from "react";
import { Briefcase, BookmarkSimple, MagnifyingGlass } from "@phosphor-icons/react";
import EventsHub from "@/components/career/EventsHub";
import OpportunitiesHub from "@/components/career/OpportunitiesHub";
import { JobFilters } from "@/components/jobs/JobFilters";
import { JobList } from "@/components/jobs/JobList";
import { JobRecommendations } from "@/components/jobs/JobRecommendations";

interface OpportunityItem {
  id: string;
  title: string;
  company: string;
  type: string;
  location: string | null;
  url: string | null;
  description: string | null;
  status: string;
  deadline: string | null;
  application: {
    id: string;
    status: string;
    notes: string | null;
    resumeFileId: string | null;
    appliedAt: string | null;
    createdAt: string;
  } | null;
}

interface EventItem {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  virtualUrl: string | null;
  capacity: number | null;
  registrationRequired: boolean;
  status: string;
  registrationCount: number;
  registration: {
    id: string;
    status: string;
    registeredAt: string;
  } | null;
}

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

export default function CareerHub({
  opportunities,
  events,
}: {
  opportunities: OpportunityItem[];
  events: EventItem[];
}) {
  const [jobsData, setJobsData] = useState<JobsResponse | null>(null);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [cluster, setCluster] = useState("");
  const [sort, setSort] = useState("recommended");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setJobsLoading(true);
      const params = new URLSearchParams();
      if (cluster) params.set("cluster", cluster);
      if (sort) params.set("sort", sort);

      const res = await fetch(`/api/jobs?${params}`);
      if (!cancelled && res.ok) {
        const json = await res.json();
        setJobsData(json);
      }
      if (!cancelled) {
        setJobsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cluster, sort, refreshKey]);

  const handleSaveJob = useCallback(async (jobId: string) => {
    const res = await fetch("/api/jobs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobListingId: jobId }),
    });
    if (res.ok) {
      setRefreshKey((key) => key + 1);
    }
  }, []);

  const matchedCount =
    jobsData?.jobs.filter((job) => job.matchScore >= 50).length ?? 0;

  return (
    <div className="space-y-10">
      <section id="jobs">
        <div className="mb-4">
          <h2 className="font-display text-2xl text-[var(--ink-strong)]">Jobs</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Explore matched roles, save the ones that fit, and keep your active search in the same workflow as events and applications.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="surface-section rounded-xl p-4 text-center">
            <Briefcase size={24} className="mx-auto mb-1 text-[var(--primary)]" />
            <p className="text-2xl font-bold text-[var(--text-primary)]">
              {jobsData?.totalActive ?? 0}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">Available</p>
          </div>
          <div className="surface-section rounded-xl p-4 text-center">
            <MagnifyingGlass size={24} className="mx-auto mb-1 text-[var(--accent)]" />
            <p className="text-2xl font-bold text-[var(--text-primary)]">{matchedCount}</p>
            <p className="text-xs text-[var(--text-secondary)]">Matched</p>
          </div>
          <div className="surface-section rounded-xl p-4 text-center">
            <BookmarkSimple size={24} className="mx-auto mb-1 text-[var(--warning)]" />
            <p className="text-2xl font-bold text-[var(--text-primary)]">
              {jobsData?.totalSaved ?? 0}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">Saved</p>
          </div>
        </div>

        {jobsLoading && (
          <div className="py-12 text-center text-[var(--text-secondary)]">
            Loading jobs...
          </div>
        )}

        {!jobsLoading && jobsData && (
          <div className="mt-6 space-y-6">
            {!jobsData.hasDiscovery && (
              <div className="surface-section rounded-xl border-l-4 border-[var(--warning)] p-4">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Complete your career assessment to get personalized job recommendations.
                </p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Chat with Sage about your interests and skills to unlock matched jobs.
                </p>
              </div>
            )}

            {jobsData.hasDiscovery && (
              <JobRecommendations jobs={jobsData.jobs} onSave={handleSaveJob} />
            )}

            <div className="flex items-center justify-between gap-4">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                All Jobs
              </h3>
              <JobFilters
                cluster={cluster}
                sort={sort}
                onClusterChange={setCluster}
                onSortChange={setSort}
              />
            </div>

            <JobList jobs={jobsData.jobs} onSave={handleSaveJob} />
          </div>
        )}
      </section>

      <section id="opportunities">
        <div className="mb-4">
          <h2 className="font-display text-2xl text-[var(--ink-strong)]">Opportunities</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Save roles, attach your current resume, and keep your application pipeline current.
          </p>
        </div>
        <OpportunitiesHub opportunities={opportunities} />
      </section>

      <section id="events">
        <div className="mb-4">
          <h2 className="font-display text-2xl text-[var(--ink-strong)]">Events</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Register for workshops, fairs, and hiring events without leaving your career workflow.
          </p>
        </div>
        <EventsHub events={events} />
      </section>
    </div>
  );
}
