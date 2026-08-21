// =============================================================================
// Pathway provenance — capture side of the pathway→outcome attribution loop.
//
// When a student creates a job application, we copy their current top SPOKES
// career cluster onto the Application row (Application.pathwayClusterId +
// pathwaySnapshotAt). That copy is what later lets the program ask the one
// question it has never been able to answer: of the placements we can verify,
// which suggested pathways produced them?
//
// Two rules make the copy trustworthy, and both are structural rather than
// documented-and-hoped-for:
//
//   1. WRITE-ONCE. The capture happens only on the upsert's `create` branch in
//      POST /api/applications; the `update` branch never mentions these
//      fields, so a later status change cannot rewrite history.
//   2. NEVER BLOCKS. A missing discovery row, an empty cluster list, or a
//      failed read all resolve to "no provenance" rather than an error. A
//      student applying for a job must never fail because a reporting column
//      could not be filled in.
//
// Report side: src/lib/pathway-outcomes.ts.
// =============================================================================

import { logger } from "./logger";

/** Structural client type so the route, scripts, and tests share one helper. */
export interface PathwayDiscoveryReader {
  careerDiscovery: {
    findUnique(args: {
      where: { studentId: string };
      select: { topClusters: true };
    }): Promise<{ topClusters: string[] } | null>;
  };
}

export interface PathwayProvenance {
  pathwayClusterId: string | null;
  pathwaySnapshotAt: Date | null;
}

/** The "we know nothing" result. Written to the row as explicit nulls. */
export const NO_PATHWAY_PROVENANCE: PathwayProvenance = {
  pathwayClusterId: null,
  pathwaySnapshotAt: null,
};

/**
 * The student's top cluster, or null when discovery recorded none.
 *
 * Deliberately does NOT validate against the CAREER_CLUSTERS catalog: this is
 * a historical record, and a cluster retired from the catalog next year still
 * answers "what pathway were they on when they applied". The report labels
 * unknown ids by their raw id rather than hiding them.
 */
export function pickPathwayCluster(
  topClusters: readonly string[] | null | undefined,
): string | null {
  if (!topClusters) return null;
  for (const cluster of topClusters) {
    const trimmed = cluster?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Read the student's current pathway for stamping onto a NEW application.
 *
 * Call this only on the create path — see the write-once rule above. `now` is
 * injectable so the caller can share one timestamp across the whole write.
 */
export async function resolvePathwayProvenance(
  client: PathwayDiscoveryReader,
  studentId: string,
  now: Date = new Date(),
): Promise<PathwayProvenance> {
  let discovery: { topClusters: string[] } | null = null;
  try {
    discovery = await client.careerDiscovery.findUnique({
      where: { studentId },
      select: { topClusters: true },
    });
  } catch (error: unknown) {
    // Reporting provenance is never worth failing a student's application
    // over. Loud in the server log, invisible to the student.
    logger.warn("Pathway provenance read failed; application recorded without a pathway", {
      studentId,
      error: String(error),
    });
    return NO_PATHWAY_PROVENANCE;
  }

  const pathwayClusterId = pickPathwayCluster(discovery?.topClusters);
  if (!pathwayClusterId) return NO_PATHWAY_PROVENANCE;

  return { pathwayClusterId, pathwaySnapshotAt: now };
}
