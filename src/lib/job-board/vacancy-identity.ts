/**
 * Vacancy identity for durable saved and hidden jobs (W4).
 *
 * A vacancy is one upstream requisition. Every adapter builds `sourceId` from
 * the upstream requisition id, namespaced by source, so `source` + `sourceId`
 * names one posting whether it sits on a class board (JobListing) or in the
 * program-wide browse pool (JobBrowseListing), and whichever class scraped it.
 *
 * This is deliberately NOT `jobDuplicateKey` from ./duplicates: that display
 * key merges look-alike openings (same title, company, place and work mode),
 * so hiding by it would hide distinct requisitions. Pure module: no I/O.
 * Design: docs/superpowers/specs/2026-11-09-durable-job-preferences-design.md
 */

export const VACANCY_KEY_VERSION = "v1";

export interface VacancyRef {
  source: string;
  sourceId: string;
}

/** The public facts of a posting that a save or hide keeps. */
export interface VacancyListing extends VacancyRef {
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt?: Date | null;
  expiresAt?: Date | null;
}

export interface VacancySnapshot {
  snapshotTitle: string;
  snapshotCompany: string;
  snapshotLocation: string;
  snapshotUrl: string;
  snapshotSource: string;
  snapshotSourceId: string;
  snapshotPostedAt: Date | null;
  snapshotExpiresAt: Date | null;
  snapshotAt: Date;
}

/**
 * `v1:<source>:<sourceId>`. The source is trimmed and lowercased; the source
 * id is only trimmed, since upstream ids can be case sensitive. Null when
 * either part is blank, so a caller can refuse rather than key on nothing.
 */
export function vacancyKeyFor(ref: VacancyRef): string | null {
  const source = ref.source.trim().toLowerCase();
  const sourceId = ref.sourceId.trim();
  if (!source || !sourceId) return null;
  return `${VACANCY_KEY_VERSION}:${source}:${sourceId}`;
}

/** Copies only the posting's public facts. Nothing about the student. */
export function vacancySnapshotFor(listing: VacancyListing, now: Date): VacancySnapshot {
  return {
    snapshotTitle: listing.title,
    snapshotCompany: listing.company,
    snapshotLocation: listing.location,
    snapshotUrl: listing.url,
    snapshotSource: listing.source,
    snapshotSourceId: listing.sourceId,
    snapshotPostedAt: listing.postedAt ?? null,
    snapshotExpiresAt: listing.expiresAt ?? null,
    snapshotAt: now,
  };
}

/**
 * Leaves out rows whose vacancy the student hid. Run it BEFORE display
 * grouping, so a hidden opening never stands in for a look-alike that is
 * still visible. Returns a new array.
 */
export function excludeHiddenVacancies<T extends VacancyRef>(
  rows: readonly T[],
  hiddenKeys: ReadonlySet<string>,
): T[] {
  if (hiddenKeys.size === 0) return [...rows];
  return rows.filter((row) => {
    const key = vacancyKeyFor(row);
    return key === null || !hiddenKeys.has(key);
  });
}
