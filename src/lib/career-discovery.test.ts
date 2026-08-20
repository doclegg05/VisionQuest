/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockFindUnique = mock.fn() as any;
const mockUpsert = mock.fn(async () => ({})) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      careerDiscovery: {
        get findUnique() {
          return mockFindUnique;
        },
        get upsert() {
          return mockUpsert;
        },
      },
    },
  },
});

let careerDiscovery: typeof import("./career-discovery");
before(async () => {
  careerDiscovery = await import("./career-discovery");
});

/** The exact payload shape the discovery extractor produces (post-response.ts). */
function extractionData() {
  return {
    interests: JSON.stringify(["fixing cars"]),
    strengths: JSON.stringify(["patience"]),
    subjects: JSON.stringify([]),
    problems: JSON.stringify([]),
    values: JSON.stringify([]),
    circumstances: JSON.stringify([]),
    clusterScores: JSON.stringify({ "advanced-manufacturing": 0.7 }),
    sageSummary: "Likes hands-on work.",
    riasecScores: JSON.stringify({
      realistic: 0.9,
      investigative: 0.2,
      artistic: 0,
      social: 0.1,
      enterprising: 0,
      conventional: 0.3,
    }),
    hollandCode: "RCI",
    nationalClusters: JSON.stringify([]),
    transferableSkills: JSON.stringify([]),
    workValues: JSON.stringify([]),
    assessmentSummary: "Strong realistic signal.",
    conversationId: "conv-1",
  };
}

describe("upsertDiscoveryFromExtraction", () => {
  beforeEach(() => {
    mockFindUnique.mock.resetCalls();
    mockUpsert.mock.resetCalls();
    mockFindUnique.mock.mockImplementation(async () => null);
  });

  it("creates a new row with the full extraction payload (born sage_inferred by default)", async () => {
    await careerDiscovery.upsertDiscoveryFromExtraction("stu-1", extractionData());

    assert.equal(mockUpsert.mock.callCount(), 1);
    const call = mockUpsert.mock.calls[0].arguments[0];
    assert.deepEqual(call.where, { studentId: "stu-1" });
    assert.equal(call.create.studentId, "stu-1");
    assert.equal(call.create.hollandCode, "RCI");
    assert.ok(call.create.riasecScores.includes("0.9"));
    // The extractor never writes provenance — the schema default owns it.
    assert.equal("profileSource" in call.create, false);
    assert.equal("assessedAt" in call.create, false);
    assert.equal("assessmentPayload" in call.create, false);
  });

  it("updates a sage_inferred row with fresh inferred RIASEC scores (extractor still owns them)", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({ profileSource: "sage_inferred" }));

    await careerDiscovery.upsertDiscoveryFromExtraction("stu-1", extractionData());

    const call = mockUpsert.mock.calls[0].arguments[0];
    assert.equal(call.update.hollandCode, "RCI");
    assert.ok(call.update.riasecScores.includes("0.9"));
  });

  it("GUARD: an assessed (student_reported_cos) profile is never stomped back to inference", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      profileSource: "student_reported_cos",
    }));

    await careerDiscovery.upsertDiscoveryFromExtraction("stu-1", extractionData());

    const call = mockUpsert.mock.calls[0].arguments[0];
    // The assessed RIASEC profile and its derived code must survive the
    // extractor's background upsert untouched.
    assert.equal("riasecScores" in call.update, false, "inferred riasecScores must not overwrite assessed scores");
    assert.equal("hollandCode" in call.update, false, "inferred hollandCode must not overwrite assessed code");
    // Everything the extractor legitimately owns still flows.
    assert.equal(call.update.sageSummary, "Likes hands-on work.");
    assert.ok(call.update.clusterScores.includes("advanced-manufacturing"));
  });

  it("GUARD: cos_api profiles get the same protection", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({ profileSource: "cos_api" }));

    await careerDiscovery.upsertDiscoveryFromExtraction("stu-1", extractionData());

    const call = mockUpsert.mock.calls[0].arguments[0];
    assert.equal("riasecScores" in call.update, false);
    assert.equal("hollandCode" in call.update, false);
  });

  it("never lets the extractor write provenance fields in the update branch", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({ profileSource: "sage_inferred" }));

    await careerDiscovery.upsertDiscoveryFromExtraction("stu-1", extractionData());

    const call = mockUpsert.mock.calls[0].arguments[0];
    assert.equal("profileSource" in call.update, false);
    assert.equal("assessedAt" in call.update, false);
    assert.equal("assessmentPayload" in call.update, false);
  });

  it("stage completion sets status/topClusters/completedAt and STILL guards assessed scores", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      profileSource: "student_reported_cos",
    }));
    const completedAt = new Date("2026-08-20T10:00:00Z");

    await careerDiscovery.upsertDiscoveryFromExtraction("stu-1", extractionData(), {
      topClusters: ["advanced-manufacturing"],
      completedAt,
    });

    const call = mockUpsert.mock.calls[0].arguments[0];
    assert.equal(call.update.status, "complete");
    assert.deepEqual(call.update.topClusters, ["advanced-manufacturing"]);
    assert.equal(call.update.completedAt, completedAt);
    assert.equal("riasecScores" in call.update, false);
    assert.equal("hollandCode" in call.update, false);
  });
});

describe("recordAssessedCareerProfile", () => {
  beforeEach(() => {
    mockFindUnique.mock.resetCalls();
    mockUpsert.mock.resetCalls();
  });

  const assessedAt = new Date("2026-08-20T10:00:00Z");

  it("stamps provenance, payload, and the assessed RIASEC profile (missing dims fill to 0)", async () => {
    await careerDiscovery.recordAssessedCareerProfile({
      studentId: "stu-1",
      source: "student_reported_cos",
      assessedAt,
      payload: { instrument: "careeronestop-skills-matcher" },
      riasec: { realistic: 0.8, social: 0.6, conventional: 0.4 },
    });

    assert.equal(mockUpsert.mock.callCount(), 1);
    const call = mockUpsert.mock.calls[0].arguments[0];
    assert.deepEqual(call.where, { studentId: "stu-1" });

    for (const branch of [call.create, call.update]) {
      assert.equal(branch.profileSource, "student_reported_cos");
      assert.equal(branch.assessedAt, assessedAt);
      assert.deepEqual(branch.assessmentPayload, {
        instrument: "careeronestop-skills-matcher",
      });
      const scores = JSON.parse(branch.riasecScores);
      assert.equal(scores.realistic, 0.8);
      assert.equal(scores.artistic, 0);
      assert.equal(scores.investigative, 0);
      // Derived from the assessed scores, not left over from inference.
      assert.equal(branch.hollandCode, "RSC");
    }
    assert.equal(call.create.studentId, "stu-1");
  });

  it("leaves clusters untouched — the occupation→cluster seam is deliberately not crossed", async () => {
    await careerDiscovery.recordAssessedCareerProfile({
      studentId: "stu-1",
      source: "student_reported_cos",
      assessedAt,
      payload: { topOccupations: [{ title: "Welder" }] },
      riasec: { realistic: 1 },
    });

    const call = mockUpsert.mock.calls[0].arguments[0];
    for (const branch of [call.create, call.update]) {
      assert.equal("topClusters" in branch, false);
      assert.equal("clusterScores" in branch, false);
      assert.equal("nationalClusters" in branch, false);
    }
  });

  it("without riasec scores it stamps provenance only and keeps the stored profile", async () => {
    await careerDiscovery.recordAssessedCareerProfile({
      studentId: "stu-1",
      source: "student_reported_cos",
      assessedAt,
      payload: { notes: "took it at the library" },
    });

    const call = mockUpsert.mock.calls[0].arguments[0];
    for (const branch of [call.create, call.update]) {
      assert.equal("riasecScores" in branch, false);
      assert.equal("hollandCode" in branch, false);
      assert.equal(branch.profileSource, "student_reported_cos");
    }
  });
});

describe("getCareerDiscovery provenance passthrough", () => {
  beforeEach(() => {
    mockFindUnique.mock.resetCalls();
  });

  it("returns profileSource and assessedAt so surfaces can label the data honestly", async () => {
    const assessedAt = new Date("2026-08-20T10:00:00Z");
    mockFindUnique.mock.mockImplementation(async () => ({
      id: "cd-1",
      status: "complete",
      hollandCode: "RSC",
      riasecScores: null,
      nationalClusters: null,
      transferableSkills: null,
      workValues: null,
      sageSummary: null,
      completedAt: null,
      profileSource: "student_reported_cos",
      assessedAt,
    }));

    const result = await careerDiscovery.getCareerDiscovery("stu-1");
    assert.equal(result?.profileSource, "student_reported_cos");
    assert.equal(result?.assessedAt, assessedAt);
  });
});
