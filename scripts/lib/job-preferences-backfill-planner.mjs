/**
 * Pure planner for scripts/job-preferences-backfill.mjs (W4, 2026-11-09).
 * No database, no I/O: the script reads rows, this decides what to write.
 *
 * Input rows are StudentSavedJob rows with no vacancyKey yet, each with its
 * linked JobListing (or null when the link was cleared). The key and the
 * snapshot functions are passed in, so this module and the app share one
 * definition (src/lib/job-board/vacancy-identity.ts).
 *
 * Rules:
 *   - A row with no listing, or a listing with no usable key, is left alone.
 *   - One student, one key: when the student already has a keyed row for
 *     that vacancy, every unkeyed match is a collision and stays unkeyed.
 *   - Otherwise the most recently updated unkeyed row gets the key and the
 *     others are collisions. Collisions keep working through jobListingId.
 */

/**
 * @param {Array<{ id: string, studentId: string, updatedAt: Date, jobListing: null | { title: string, company: string, location: string, url: string, source: string, sourceId: string, expiresAt: Date | null } }>} rows
 * @param {ReadonlySet<string>} existingKeys `${studentId}\u0000${vacancyKey}` for rows already keyed
 * @param {{ keyFor: (ref: { source: string, sourceId: string }) => string | null, snapshotFor: (listing: object, now: Date) => object, now: Date }} deps
 */
export function planJobPreferencesBackfill(rows, existingKeys, deps) {
  const groups = new Map();
  let noListing = 0;
  let noKey = 0;
  for (const row of rows) {
    if (!row.jobListing) {
      noListing += 1;
      continue;
    }
    const vacancyKey = deps.keyFor(row.jobListing);
    if (!vacancyKey) {
      noKey += 1;
      continue;
    }
    const groupKey = `${row.studentId}\u0000${vacancyKey}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), { row, vacancyKey }]);
  }

  const planned = [];
  let collisions = 0;
  for (const [groupKey, members] of groups) {
    const newestFirst = [...members].sort((a, b) => b.row.updatedAt.getTime() - a.row.updatedAt.getTime());
    const winners = existingKeys.has(groupKey) ? [] : newestFirst.slice(0, 1);
    collisions += members.length - winners.length;
    for (const { row, vacancyKey } of winners) {
      planned.push({
        id: row.id,
        data: { vacancyKey, listingKind: "class", ...deps.snapshotFor(row.jobListing, deps.now) },
      });
    }
  }
  return { planned, collisions, noListing, noKey };
}
