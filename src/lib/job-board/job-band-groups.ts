import type { JobBand } from "./job-bands-response";

/**
 * Presentation-layer grouping for the job board. Takes GET /api/jobs' jobs[]
 * (each carrying the additive `band` from job-bands-response) and partitions
 * them into ordered, labeled sections for display. Pure and total: no I/O,
 * every input job lands in exactly one section, order is preserved within a
 * section, and nothing is dropped.
 *
 * Student-facing labels are plain language (6th-grade reading level per
 * .impeccable.md); the internal `key` keeps the Core/Stretch/Wildcard vocabulary.
 */

/** Section identity. "other" collects band:null jobs (browse-pool / unscored)
 *  when at least one job IS banded. "ungrouped" is the whole list when NO job
 *  has a band (no-personalization student) — rendered as a plain, unheadered list. */
export type JobBandSectionKey = JobBand | "other";

export interface JobBandSection<T> {
  readonly key: JobBandSectionKey | "ungrouped";
  /** null only for the ungrouped section (render the list with no band heading). */
  readonly label: string | null;
  readonly explainer: string | null;
  readonly jobs: readonly T[];
  readonly count: number;
}

interface BandedJob {
  readonly band?: JobBand | null;
}

const SECTION_ORDER: readonly JobBandSectionKey[] = ["core", "stretch", "wildcard", "other"];

const SECTION_META: Record<JobBandSectionKey, { label: string; explainer: string }> = {
  core: {
    label: "Best fits",
    explainer: "Strong matches for your interests and skills.",
  },
  stretch: {
    label: "Worth a look",
    explainer: "Related roles that build on your strengths.",
  },
  wildcard: {
    label: "Explore",
    explainer: "A few picks beyond your usual path to widen your search.",
  },
  other: {
    label: "More openings",
    explainer: "Other jobs from the wider pool.",
  },
};

function isBanded(band: JobBand | null | undefined): band is JobBand {
  return band === "core" || band === "stretch" || band === "wildcard";
}

/**
 * Partition jobs into fixed-order band sections. When no job is banded (the
 * no-personalization case) returns a SINGLE ungrouped section preserving the
 * original order, so the caller renders exactly the flat list it does today.
 * Otherwise returns the [Core, Stretch, Wildcard, Other] sections in that order
 * (including empty ones — the caller decides whether to skip empties).
 */
export function groupJobsByBand<T extends BandedJob>(jobs: readonly T[]): JobBandSection<T>[] {
  if (!jobs.some((job) => isBanded(job.band))) {
    return [
      { key: "ungrouped", label: null, explainer: null, jobs: [...jobs], count: jobs.length },
    ];
  }

  return SECTION_ORDER.map((key) => {
    const sectionJobs = jobs.filter((job) =>
      key === "other" ? !isBanded(job.band) : job.band === key,
    );
    return {
      key,
      label: SECTION_META[key].label,
      explainer: SECTION_META[key].explainer,
      jobs: sectionJobs,
      count: sectionJobs.length,
    };
  });
}
