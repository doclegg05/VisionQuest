/**
 * Pure helpers that attach a student's saved-job state to board rows (W4).
 *
 * A save is matched to a row by vacancy key first, so a reimported listing
 * (new row id, same source and source id) and the same posting on another
 * class's board or in the browse pool all show the save. Rows saved before
 * the backfill keyed them still match by listing id.
 */
import type { BuildJobInteractionProfileInput } from "./recommendation";
import { vacancyKeyFor, type VacancyRef } from "./vacancy-identity";

interface ListingFacts {
  clusters: string[];
  company: string;
  source: string;
}

export interface SavedLookupRow {
  jobListingId: string | null;
  jobBrowseListingId: string | null;
  vacancyKey: string | null;
  status: string;
  notes: string | null;
  appliedAt: Date | null;
  snapshotCompany: string | null;
  snapshotSource: string | null;
  jobListing: ListingFacts | null;
  jobBrowseListing: ListingFacts | null;
}

export interface SavedLookup {
  readonly byKey: ReadonlyMap<string, SavedLookupRow>;
  readonly byListingId: ReadonlyMap<string, SavedLookupRow>;
}

export interface SavedMeta {
  savedStatus: string | null;
  savedNotes: string | null;
  savedAppliedAt: string | null;
}

export function buildSavedLookup(rows: readonly SavedLookupRow[]): SavedLookup {
  const byKey = new Map<string, SavedLookupRow>();
  const byListingId = new Map<string, SavedLookupRow>();
  for (const row of rows) {
    if (row.vacancyKey) byKey.set(row.vacancyKey, row);
    if (row.jobListingId) byListingId.set(row.jobListingId, row);
    if (row.jobBrowseListingId) byListingId.set(row.jobBrowseListingId, row);
  }
  return { byKey, byListingId };
}

export function savedMetaFor(lookup: SavedLookup, row: VacancyRef & { id: string }): SavedMeta {
  const key = vacancyKeyFor(row);
  const saved = (key ? lookup.byKey.get(key) : undefined) ?? lookup.byListingId.get(row.id);
  return {
    savedStatus: saved?.status ?? null,
    savedNotes: saved?.notes ?? null,
    savedAppliedAt: saved?.appliedAt?.toISOString() ?? null,
  };
}

/**
 * The ranker's interaction input. A save whose listing is gone still counts,
 * through its snapshot's company and source (it has no clusters left).
 */
export function toInteractionInputs(rows: readonly SavedLookupRow[]): BuildJobInteractionProfileInput[] {
  return rows.map((row) => {
    const listing = row.jobListing ?? row.jobBrowseListing;
    return {
      status: row.status,
      jobListing: {
        clusters: listing?.clusters ?? [],
        company: listing?.company ?? row.snapshotCompany ?? "",
        source: listing?.source ?? row.snapshotSource ?? "",
      },
    };
  });
}
