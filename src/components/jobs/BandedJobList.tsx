"use client";

import { JobList, type ListJob } from "./JobList";
import type { JobTrackingUpdate } from "./JobCard";
import { groupJobsByBand } from "@/lib/job-board/job-band-groups";
import type { JobBand } from "@/lib/job-board/job-bands-response";

export type BandedJob = ListJob & { band?: JobBand | null };

interface BandedJobListProps {
  jobs: BandedJob[];
  onSave: (jobId: string, updates?: JobTrackingUpdate) => void | Promise<void>;
}

/**
 * Renders the full job list grouped into Core/Stretch/Wildcard/Other sections
 * (via the pure groupJobsByBand helper), each with a plain-language heading,
 * count, and explainer, reusing JobList per section. When no job carries a
 * band (no-personalization student), it renders exactly the flat JobList it
 * always has — no headings, no layout change.
 */
export function BandedJobList({ jobs, onSave }: BandedJobListProps) {
  const sections = groupJobsByBand(jobs);

  if (sections.length === 1 && sections[0].key === "ungrouped") {
    return <JobList jobs={jobs} onSave={onSave} />;
  }

  return (
    <div className="space-y-8">
      {sections
        .filter((section) => section.count > 0)
        .map((section) => (
          <section key={section.key} aria-labelledby={`job-band-${section.key}`}>
            <div className="mb-3">
              <h4
                id={`job-band-${section.key}`}
                className="text-base font-semibold text-[var(--text-primary)]"
              >
                {section.label}{" "}
                <span className="font-normal text-[var(--text-secondary)]">({section.count})</span>
              </h4>
              {section.explainer && (
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  {section.explainer}
                </p>
              )}
            </div>
            <JobList jobs={[...section.jobs]} onSave={onSave} />
          </section>
        ))}
    </div>
  );
}
