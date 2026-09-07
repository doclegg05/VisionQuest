/**
 * Pure planning logic for scripts/certifications-backfill-cert-type.mjs — no
 * database, no network. D7 (2026-09-07).
 *
 * Certification rows have always been created with a hardcoded certType of
 * "ready-to-work" (src/app/api/certifications/route.ts), regardless of
 * which SPOKES catalog credential (src/lib/spokes/certifications.ts —
 * ~20 ids: "ic3", "mos-word", "workkeys-ncrc", …) the row might actually
 * represent. The create path now accepts an optional catalog certId and
 * stores it going forward; this module plans a one-time backfill for rows
 * written before that.
 *
 * TODAY'S DATA-MODEL LIMIT, stated plainly so the counts this produces are
 * never mistaken for "nothing to do": `Certification` (prisma/schema.prisma)
 * carries no name or issuer column — certType is the only field a legacy
 * row has ever recorded, and every legacy row's certType is literally
 * "ready-to-work". There is therefore no signal ON THE ROW ITSELF that
 * could disambiguate it into one of the ~20 catalog ids today, and this
 * planner reports every real row it is pointed at as "left alone" (reason
 * "no_name") until a name/issuer source exists — matching this ticket's
 * "leaves the rest" contract for the data VisionQuest actually has right
 * now. The planner takes a generic `{ id, certType, name, issuer }` row
 * shape rather than a Prisma type specifically so it is ready the day a
 * name/issuer signal is added (a teacher-entered field, a
 * classify_attachment-derived title, …) without itself changing — proven
 * correct today with synthetic fixtures that DO carry a name.
 *
 * Matching is EXACT (case-insensitive, trimmed), never substring: a
 * substring match would happily map a candidate name like "Word" onto both
 * "Microsoft Office Specialist - Word" and "MOS 2016 Specialist — Word",
 * which is precisely the "leave it alone" case this function exists to
 * detect rather than silently resolve one way.
 */

/** @typedef {{id: string, certType: string, name: string | null, issuer: string | null}} LegacyCertRow */
/** @typedef {{id: string, name: string, shortName: string}} CatalogEntry */
/** @typedef {{id: string, from: string, to: string}} PlannedBackfill */
/** @typedef {{id: string, from: string, reason: "no_name" | "no_match" | "ambiguous"}} SkippedBackfill */

/** The certType every write site has hardcoded until D7 — the only value eligible for backfill. */
export const LEGACY_CERT_TYPE = "ready-to-work";

function normalize(value) {
  return value.trim().toLowerCase();
}

/**
 * Every catalog entry whose `name` or `shortName` matches the candidate
 * exactly (case-insensitive, trimmed).
 *
 * @param {string} candidateName
 * @param {readonly CatalogEntry[]} catalog
 * @returns {CatalogEntry[]}
 */
export function matchingCatalogEntries(candidateName, catalog) {
  const needle = normalize(candidateName);
  return catalog.filter(
    (entry) => normalize(entry.name) === needle || normalize(entry.shortName) === needle,
  );
}

/**
 * @param {readonly LegacyCertRow[]} rows
 * @param {readonly CatalogEntry[]} catalog
 * @returns {{ planned: PlannedBackfill[], skipped: SkippedBackfill[] }}
 */
export function planCertTypeBackfill(rows, catalog) {
  const planned = [];
  const skipped = [];

  for (const row of rows) {
    // Already catalog-typed (or some other value entirely) — not this
    // planner's business; only the legacy default is a backfill candidate.
    if (row.certType !== LEGACY_CERT_TYPE) continue;

    const candidateName = row.name?.trim();
    if (!candidateName) {
      skipped.push({ id: row.id, from: row.certType, reason: "no_name" });
      continue;
    }

    const matches = matchingCatalogEntries(candidateName, catalog);
    if (matches.length === 0) {
      skipped.push({ id: row.id, from: row.certType, reason: "no_match" });
      continue;
    }
    if (matches.length > 1) {
      skipped.push({ id: row.id, from: row.certType, reason: "ambiguous" });
      continue;
    }

    planned.push({ id: row.id, from: row.certType, to: matches[0].id });
  }

  return { planned, skipped };
}

/**
 * @param {{ planned: PlannedBackfill[], skipped: SkippedBackfill[] }} plan
 * @returns {{ planned: number, no_name: number, no_match: number, ambiguous: number }}
 */
export function tallyCertTypeBackfillPlan(plan) {
  const tally = { planned: plan.planned.length, no_name: 0, no_match: 0, ambiguous: 0 };
  for (const entry of plan.skipped) tally[entry.reason]++;
  return tally;
}
