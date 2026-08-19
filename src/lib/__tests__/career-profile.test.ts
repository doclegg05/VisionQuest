import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

type AsyncMock = (...args: unknown[]) => Promise<unknown>;

const discoveryFindUnique = mock.fn<AsyncMock>();

mock.module("@/lib/db", {
  namedExports: {
    prisma: { careerDiscovery: { findUnique: discoveryFindUnique } },
  },
});

let careerProfile: typeof import("../career-profile");
before(async () => {
  careerProfile = await import("../career-profile");
});

// Synthetic fixture — no real student data.
function buildRow(
  overrides: Partial<import("../career-profile").CareerDiscoveryRow> = {},
): import("../career-profile").CareerDiscoveryRow {
  return {
    id: "cd-1",
    status: "complete",
    hollandCode: "SEC",
    riasecScores: JSON.stringify({
      realistic: 0.2,
      investigative: 0.4,
      artistic: 0,
      social: 0.9,
      enterprising: 0.7,
      conventional: 0.6,
    }),
    // Deliberately stored under RETIRED 16-framework names: shaping must
    // read them through the national-cluster normalizer (2026 modernization).
    nationalClusters: JSON.stringify([
      { cluster_name: "Human Services", score: 0.8, spokes_mapping: ["office-admin"] },
      { cluster_name: "Health Science", score: 0.9, spokes_mapping: ["no-such-cluster"] },
      { cluster_name: "Business Management & Administration", score: 0.5, spokes_mapping: ["no-such-cluster"] },
      { cluster_name: "Education & Training", score: 0.4, spokes_mapping: [] },
    ]),
    transferableSkills: JSON.stringify([
      { skill: "Scheduling", category: "organization", evidence: "Ran the family calendar" },
    ]),
    workValues: JSON.stringify([
      { value: "stability", importance: "high" },
      { value: "helping-others", importance: "not-a-level" },
    ]),
    sageSummary: "Synthetic summary for testing.",
    completedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

describe("shapeCareerProfile", () => {
  it("sorts all six dimensions high-to-low and picks the top three interests", () => {
    const view = careerProfile.shapeCareerProfile(buildRow());

    assert.equal(view.isComplete, true);
    assert.equal(view.dimensions.length, 6);
    assert.deepEqual(
      view.dimensions.map((d) => d.key),
      ["social", "enterprising", "conventional", "investigative", "realistic", "artistic"],
    );
    assert.deepEqual(
      view.topInterests.map((d) => [d.key, d.percent]),
      [["social", 90], ["enterprising", 70], ["conventional", 60]],
    );
    // Every dimension carries a plain-language explanation for the UI.
    for (const dimension of view.dimensions) {
      assert.ok(dimension.plainLanguage.length > 0);
      assert.ok(dimension.nickname.length > 0);
    }
  });

  it("normalizes legacy names, merges duplicates by max score, and ranks the result", () => {
    const view = careerProfile.shapeCareerProfile(buildRow());

    // Human Services (0.8) + Health Science (0.9) both land on
    // Healthcare & Human Services: one entry at the MAX score.
    assert.deepEqual(
      view.suggestedClusters.map((c) => [c.name, c.matchPercent]),
      [
        ["Healthcare & Human Services", 90],
        ["Management & Entrepreneurship", 50],
        ["Education", 40],
      ],
    );

    // The merged entry unions both stored SPOKES mappings and enriches from
    // the first one that resolves.
    const healthcare = view.suggestedClusters[0];
    assert.deepEqual(healthcare.spokesClusterIds, ["office-admin", "no-such-cluster"]);
    assert.equal(healthcare.spokesLabel, "Office & Administrative Support");
    assert.equal(healthcare.sampleJobs.length, 4);

    // Unknown SPOKES mapping degrades to no sample jobs, not a crash.
    const management = view.suggestedClusters[1];
    assert.equal(management.spokesLabel, null);
    assert.deepEqual(management.sampleJobs, []);
  });

  it("reports full completeness when all four sections have signal", () => {
    const view = careerProfile.shapeCareerProfile(buildRow());

    assert.deepEqual(view.completeness, {
      completedSections: 4,
      totalSections: 4,
      percent: 100,
      missingSections: [],
    });
  });

  it("treats malformed or empty JSON fields as missing sections without throwing", () => {
    const view = careerProfile.shapeCareerProfile(
      buildRow({
        status: "in_progress",
        riasecScores: "{not valid json",
        nationalClusters: null,
        transferableSkills: JSON.stringify([]),
        // Entry without a "value" string is dropped entirely.
        workValues: JSON.stringify([{ importance: "high" }]),
        completedAt: null,
      }),
    );

    assert.equal(view.isComplete, false);
    assert.equal(view.topInterests.length, 0);
    assert.ok(view.dimensions.every((d) => d.score === 0));
    assert.deepEqual(view.suggestedClusters, []);
    assert.deepEqual(view.completeness, {
      completedSections: 0,
      totalSections: 4,
      percent: 0,
      missingSections: ["Interests", "Career matches", "Skills", "Work values"],
    });
    assert.equal(view.discovery.riasecScores, null);
    assert.equal(view.discovery.workValues, null);
  });

  it("clamps out-of-range and non-numeric scores to the 0..1 band", () => {
    const view = careerProfile.shapeCareerProfile(
      buildRow({
        riasecScores: JSON.stringify({
          realistic: 7,
          investigative: -3,
          artistic: "high",
          social: Number.NaN,
          enterprising: 0.5,
          conventional: null,
        }),
        nationalClusters: JSON.stringify([
          { cluster_name: "Manufacturing", score: 12, spokes_mapping: [] },
        ]),
      }),
    );

    const byKey = new Map(view.dimensions.map((d) => [d.key, d]));
    assert.equal(byKey.get("realistic")?.percent, 100);
    assert.equal(byKey.get("investigative")?.percent, 0);
    assert.equal(byKey.get("artistic")?.percent, 0);
    assert.equal(byKey.get("social")?.percent, 0);
    assert.equal(byKey.get("enterprising")?.percent, 50);
    assert.equal(view.suggestedClusters[0].matchPercent, 100);
    // Retired "Manufacturing" renders under its modernized name.
    assert.equal(view.suggestedClusters[0].name, "Advanced Manufacturing");
  });

  it("coerces unknown work-value importance to medium instead of dropping the value", () => {
    const view = careerProfile.shapeCareerProfile(buildRow());

    const helping = view.discovery.workValues?.find((v) => v.value === "helping-others");
    assert.ok(helping);
    assert.equal(helping.importance, "medium");
  });
});

describe("getCareerProfile", () => {
  beforeEach(() => {
    discoveryFindUnique.mock.resetCalls();
  });

  it("returns null when the student has no discovery row", async () => {
    discoveryFindUnique.mock.mockImplementation(async () => null);
    assert.equal(await careerProfile.getCareerProfile("student-a"), null);
  });

  it("scopes the query to the student and limits selected fields", async () => {
    discoveryFindUnique.mock.mockImplementation(async () => buildRow());

    const view = await careerProfile.getCareerProfile("student-a");
    assert.ok(view);
    assert.equal(view.isComplete, true);

    const args = discoveryFindUnique.mock.calls[0].arguments[0] as {
      where: { studentId: string };
      select: Record<string, boolean>;
    };
    assert.equal(args.where.studentId, "student-a");
    // Raw conversation-signal columns are not pulled onto the results page.
    assert.equal(args.select.interests, undefined);
    assert.equal(args.select.circumstances, undefined);
    assert.equal(args.select.riasecScores, true);
  });
});
