import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildPathwayPlacementReport,
  computePathwayPlacementReport,
  fetchPathwayPlacementInput,
  type PathwayOutcomeReader,
  type PathwayPlacementInput,
} from "./pathway-outcomes";

const NOW = new Date("2026-08-20T10:00:00.000Z");

function input(overrides: Partial<PathwayPlacementInput> = {}): PathwayPlacementInput {
  return {
    placements: [],
    applicationsByCluster: [],
    ...overrides,
  };
}

describe("computePathwayPlacementReport", () => {
  it("splits verified placements into attributed and unattributed", () => {
    const report = computePathwayPlacementReport(
      input({
        placements: [
          { applicationId: "a1", pathwayClusterId: "office-admin", employmentAt: NOW },
          { applicationId: "a2", pathwayClusterId: "office-admin", employmentAt: NOW },
          { applicationId: "a3", pathwayClusterId: "tech-digital", employmentAt: NOW },
          { applicationId: "a4", pathwayClusterId: null, employmentAt: NOW },
        ],
      }),
      NOW,
    );

    assert.equal(report.totalVerifiedPlacements, 4);
    assert.equal(report.placementsWithPathway, 3);
    assert.equal(report.placementsWithoutPathway, 1);
    assert.equal(report.pathwayCoveragePct, 75);
    assert.equal(report.generatedAt, NOW.toISOString());
  });

  it("groups placements by cluster, biggest first", () => {
    const report = computePathwayPlacementReport(
      input({
        placements: [
          { applicationId: "a1", pathwayClusterId: "tech-digital", employmentAt: NOW },
          { applicationId: "a2", pathwayClusterId: "office-admin", employmentAt: NOW },
          { applicationId: "a3", pathwayClusterId: "office-admin", employmentAt: NOW },
        ],
      }),
      NOW,
    );

    assert.deepEqual(
      report.byCluster.map((row) => [row.clusterId, row.placements]),
      [
        ["office-admin", 2],
        ["tech-digital", 1],
      ],
    );
    assert.equal(report.byCluster[0].shareOfAttributedPlacementsPct, 67);
    assert.equal(report.byCluster[1].shareOfAttributedPlacementsPct, 33);
  });

  it("labels clusters from the SPOKES catalog", () => {
    const report = computePathwayPlacementReport(
      input({
        placements: [{ applicationId: "a1", pathwayClusterId: "office-admin", employmentAt: NOW }],
      }),
      NOW,
    );

    assert.equal(report.byCluster[0].label, "Office & Administrative Support");
  });

  it("falls back to the raw id for a cluster the catalog dropped", () => {
    const report = computePathwayPlacementReport(
      input({
        placements: [{ applicationId: "a1", pathwayClusterId: "retired-cluster", employmentAt: NOW }],
      }),
      NOW,
    );

    assert.equal(report.byCluster[0].clusterId, "retired-cluster");
    assert.equal(report.byCluster[0].label, "retired-cluster");
  });

  it("rates placements against the applications that carried the same pathway", () => {
    const report = computePathwayPlacementReport(
      input({
        placements: [
          { applicationId: "a1", pathwayClusterId: "office-admin", employmentAt: NOW },
          { applicationId: "a2", pathwayClusterId: "office-admin", employmentAt: NOW },
        ],
        applicationsByCluster: [
          { clusterId: "office-admin", applications: 8 },
          { clusterId: "tech-digital", applications: 4 },
        ],
      }),
      NOW,
    );

    const officeAdmin = report.byCluster.find((row) => row.clusterId === "office-admin");
    assert.equal(officeAdmin?.applicationsWithThisPathway, 8);
    assert.equal(officeAdmin?.placementRatePctOfApplications, 25);
  });

  it("keeps a suggested pathway that has produced no placements yet", () => {
    // The whole point of the loop: a cluster we keep suggesting and never
    // place from has to be visible, not absent.
    const report = computePathwayPlacementReport(
      input({
        placements: [],
        applicationsByCluster: [{ clusterId: "creative-design", applications: 12 }],
      }),
      NOW,
    );

    assert.equal(report.byCluster.length, 1);
    assert.equal(report.byCluster[0].clusterId, "creative-design");
    assert.equal(report.byCluster[0].placements, 0);
    assert.equal(report.byCluster[0].placementRatePctOfApplications, 0);
  });

  it("reports no rate at all when no application carried the cluster", () => {
    const report = computePathwayPlacementReport(
      input({
        placements: [{ applicationId: "a1", pathwayClusterId: "office-admin", employmentAt: NOW }],
      }),
      NOW,
    );

    assert.equal(report.byCluster[0].applicationsWithThisPathway, 0);
    assert.equal(report.byCluster[0].placementRatePctOfApplications, null);
  });

  it("is honest about an empty program: zero placements, zero coverage", () => {
    const report = computePathwayPlacementReport(input(), NOW);

    assert.equal(report.totalVerifiedPlacements, 0);
    assert.equal(report.pathwayCoveragePct, 0);
    assert.deepEqual(report.byCluster, []);
  });
});

describe("fetchPathwayPlacementInput", () => {
  function fakeClient(
    spokesRows: Array<{
      unsubsidizedEmploymentAt: Date | null;
      placementApplication: { id: string; pathwayClusterId: string | null } | null;
    }>,
    applicationRows: Array<{ pathwayClusterId: string | null }>,
  ) {
    const calls: { spokes: unknown[]; applications: unknown[] } = { spokes: [], applications: [] };
    const client: PathwayOutcomeReader = {
      spokesRecord: {
        findMany: async (args) => {
          calls.spokes.push(args);
          return spokesRows;
        },
      },
      application: {
        findMany: async (args) => {
          calls.applications.push(args);
          return applicationRows;
        },
      },
    };
    return { client, calls };
  }

  it("reads placements through the placement-bridge provenance link only", async () => {
    const { client, calls } = fakeClient([], []);

    await fetchPathwayPlacementInput(client);

    const where = (calls.spokes[0] as { where: Record<string, unknown> }).where;
    assert.deepEqual(where.placementApplicationId, { not: null });
    assert.deepEqual(where.unsubsidizedEmploymentAt, { not: null });
  });

  it("maps a linked placement onto its application's pathway", async () => {
    const employedAt = new Date("2026-07-01T00:00:00.000Z");
    const { client } = fakeClient(
      [
        {
          unsubsidizedEmploymentAt: employedAt,
          placementApplication: { id: "app-1", pathwayClusterId: "office-admin" },
        },
      ],
      [],
    );

    const result = await fetchPathwayPlacementInput(client);

    assert.deepEqual(result.placements, [
      { applicationId: "app-1", pathwayClusterId: "office-admin", employmentAt: employedAt },
    ]);
  });

  it("drops a placement row whose application link came back empty", async () => {
    const { client } = fakeClient(
      [{ unsubsidizedEmploymentAt: new Date(), placementApplication: null }],
      [],
    );

    const result = await fetchPathwayPlacementInput(client);

    assert.deepEqual(result.placements, []);
  });

  it("tallies applications per pathway cluster", async () => {
    const { client } = fakeClient(
      [],
      [
        { pathwayClusterId: "office-admin" },
        { pathwayClusterId: "office-admin" },
        { pathwayClusterId: "tech-digital" },
        { pathwayClusterId: null },
      ],
    );

    const result = await fetchPathwayPlacementInput(client);

    assert.deepEqual(result.applicationsByCluster, [
      { clusterId: "office-admin", applications: 2 },
      { clusterId: "tech-digital", applications: 1 },
    ]);
  });
});

describe("buildPathwayPlacementReport", () => {
  it("fetches and computes in one call for the report script", async () => {
    const client: PathwayOutcomeReader = {
      spokesRecord: {
        findMany: async () => [
          {
            unsubsidizedEmploymentAt: NOW,
            placementApplication: { id: "app-1", pathwayClusterId: "office-admin" },
          },
        ],
      },
      application: {
        findMany: async () => [{ pathwayClusterId: "office-admin" }],
      },
    };

    const report = await buildPathwayPlacementReport(client, NOW);

    assert.equal(report.totalVerifiedPlacements, 1);
    assert.equal(report.byCluster[0].clusterId, "office-admin");
    assert.equal(report.byCluster[0].placementRatePctOfApplications, 100);
  });
});
