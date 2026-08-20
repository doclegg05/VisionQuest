// =============================================================================
// Pathway outcomes — report side of the pathway→outcome attribution loop.
//
// Answers, for the first time: of the placements the program can actually
// verify, which suggested career pathway did the student come from?
//
// The chain this walks, end to end:
//
//   CareerDiscovery.topClusters[0]
//     -> Application.pathwayClusterId      (captured at creation; see
//                                           src/lib/pathway-provenance.ts)
//     -> SpokesRecord.placementApplicationId  (the placement bridge's
//                                              provenance link; see
//                                              src/lib/placement-bridge.ts)
//     -> SpokesRecord.unsubsidizedEmploymentAt (the verified placement)
//
// Deliberate limits, so nobody reads more into the numbers than they hold:
//   * Coverage climbs from zero. Every application filed before the
//     provenance field shipped carries no cluster, so early runs will show a
//     large "no pathway recorded" share. That is missing history, not a
//     pathway that failed.
//   * `placementRatePctOfApplications` divides placements by APPLICATIONS
//     carrying that pathway — not by students on it, and not by applications
//     that were actually verified. It is a coarse signal, useful for
//     comparing clusters against each other.
//   * A placement recorded by staff without the application link is invisible
//     here by design: no link, no attribution claim.
// =============================================================================

import { CAREER_CLUSTERS } from "./spokes/career-clusters";

/** Structural client type — a PrismaClient satisfies it, and so does a fake. */
export interface PathwayOutcomeReader {
  spokesRecord: {
    findMany(args: {
      where: {
        placementApplicationId: { not: null };
        unsubsidizedEmploymentAt: { not: null };
      };
      select: {
        unsubsidizedEmploymentAt: true;
        placementApplication: { select: { id: true; pathwayClusterId: true } };
      };
    }): Promise<
      Array<{
        unsubsidizedEmploymentAt: Date | null;
        placementApplication: { id: string; pathwayClusterId: string | null } | null;
      }>
    >;
  };
  application: {
    findMany(args: {
      where: { pathwayClusterId: { not: null } };
      select: { pathwayClusterId: true };
    }): Promise<Array<{ pathwayClusterId: string | null }>>;
  };
}

export interface PathwayPlacementRow {
  applicationId: string;
  pathwayClusterId: string | null;
  employmentAt: Date | null;
}

export interface PathwayApplicationCount {
  clusterId: string;
  applications: number;
}

export interface PathwayPlacementInput {
  /** One row per verified placement that carries an application link. */
  placements: PathwayPlacementRow[];
  /** Applications carrying each pathway — the rate denominator. */
  applicationsByCluster: PathwayApplicationCount[];
}

export interface PathwayClusterOutcome {
  clusterId: string;
  /** Catalog label, falling back to the raw id for a retired cluster. */
  label: string;
  placements: number;
  /** Share of the ATTRIBUTED placements, not of all placements. */
  shareOfAttributedPlacementsPct: number;
  applicationsWithThisPathway: number;
  /**
   * placements / applicationsWithThisPathway, as a percent. Null when no
   * application carries this pathway, which is the honest answer — a rate
   * over a zero denominator is not zero, it is unknown.
   */
  placementRatePctOfApplications: number | null;
}

export interface PathwayPlacementReport {
  generatedAt: string;
  /** Verified placements reachable through the application link. */
  totalVerifiedPlacements: number;
  placementsWithPathway: number;
  placementsWithoutPathway: number;
  /** placementsWithPathway as a percent of totalVerifiedPlacements. */
  pathwayCoveragePct: number;
  byCluster: PathwayClusterOutcome[];
}

const CLUSTER_LABELS = new Map(CAREER_CLUSTERS.map((cluster) => [cluster.id, cluster.label]));

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function tally(values: Array<string | null>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/**
 * Pure compute over already-fetched rows — same shape as academic-kpi.ts, so
 * a route, a script, or a test can all feed it.
 */
export function computePathwayPlacementReport(
  input: PathwayPlacementInput,
  now: Date = new Date(),
): PathwayPlacementReport {
  const totalVerifiedPlacements = input.placements.length;
  const placementCounts = tally(input.placements.map((row) => row.pathwayClusterId));

  let placementsWithPathway = 0;
  for (const count of placementCounts.values()) placementsWithPathway += count;
  const placementsWithoutPathway = totalVerifiedPlacements - placementsWithPathway;

  const applicationCounts = new Map(
    input.applicationsByCluster.map((row) => [row.clusterId, row.applications]),
  );

  // Union of both sides: a pathway with applications and zero placements is
  // exactly the signal this report exists to surface, so it must not vanish.
  const clusterIds = new Set([...placementCounts.keys(), ...applicationCounts.keys()]);

  const byCluster: PathwayClusterOutcome[] = [...clusterIds]
    .map((clusterId) => {
      const placements = placementCounts.get(clusterId) ?? 0;
      const applicationsWithThisPathway = applicationCounts.get(clusterId) ?? 0;
      return {
        clusterId,
        label: CLUSTER_LABELS.get(clusterId) ?? clusterId,
        placements,
        shareOfAttributedPlacementsPct: pct(placements, placementsWithPathway),
        applicationsWithThisPathway,
        placementRatePctOfApplications:
          applicationsWithThisPathway === 0 ? null : pct(placements, applicationsWithThisPathway),
      };
    })
    .sort(
      (a, b) =>
        b.placements - a.placements ||
        b.applicationsWithThisPathway - a.applicationsWithThisPathway ||
        a.clusterId.localeCompare(b.clusterId),
    );

  return {
    generatedAt: now.toISOString(),
    totalVerifiedPlacements,
    placementsWithPathway,
    placementsWithoutPathway,
    pathwayCoveragePct: pct(placementsWithPathway, totalVerifiedPlacements),
    byCluster,
  };
}

/**
 * Two reads: verified placements through the bridge link, and the per-pathway
 * application denominator. The application tally is done in TS rather than
 * with `groupBy` because the column is one of ~7 low-cardinality values on a
 * table sized by student job applications, and a plain select keeps the
 * structural client type above honest and fake-able.
 */
export async function fetchPathwayPlacementInput(
  client: PathwayOutcomeReader,
): Promise<PathwayPlacementInput> {
  const [spokesRows, applicationRows] = await Promise.all([
    client.spokesRecord.findMany({
      where: {
        placementApplicationId: { not: null },
        unsubsidizedEmploymentAt: { not: null },
      },
      select: {
        unsubsidizedEmploymentAt: true,
        placementApplication: { select: { id: true, pathwayClusterId: true } },
      },
    }),
    client.application.findMany({
      where: { pathwayClusterId: { not: null } },
      select: { pathwayClusterId: true },
    }),
  ]);

  const placements: PathwayPlacementRow[] = spokesRows.flatMap((row) =>
    row.placementApplication
      ? [
          {
            applicationId: row.placementApplication.id,
            pathwayClusterId: row.placementApplication.pathwayClusterId,
            employmentAt: row.unsubsidizedEmploymentAt,
          },
        ]
      : [],
  );

  const applicationsByCluster = [...tally(applicationRows.map((row) => row.pathwayClusterId))]
    .map(([clusterId, applications]) => ({ clusterId, applications }))
    .sort((a, b) => b.applications - a.applications || a.clusterId.localeCompare(b.clusterId));

  return { placements, applicationsByCluster };
}

/** Fetch + compute in one call — what the report script runs. */
export async function buildPathwayPlacementReport(
  client: PathwayOutcomeReader,
  now: Date = new Date(),
): Promise<PathwayPlacementReport> {
  return computePathwayPlacementReport(await fetchPathwayPlacementInput(client), now);
}
