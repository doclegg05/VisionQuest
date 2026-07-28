import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/lib/db";
import {
  getLearningPathway,
  type LearningPathway,
  type PathwayStep,
} from "@/lib/learning-pathway";
import { CAREER_CLUSTERS } from "@/lib/spokes/career-clusters";
import { CERTIFICATIONS } from "@/lib/spokes/certifications";
import { PLATFORMS } from "@/lib/spokes/platforms";
import { deriveEdgesFromStatic } from "@/lib/progression-edges";

// ---------------------------------------------------------------------------
// Ground truth: a faithful replica of the pre-ProgressionEdge algorithm,
// reading prerequisites straight from the static CERTIFICATIONS arrays.
// The DB-backed implementation must be step-for-step identical to this
// for current data (issue #140 acceptance criterion "parity").
// ---------------------------------------------------------------------------

const HOURS_PER_WEEK = 5;

interface CertRecordFixture {
  certType: string;
  status: string;
}

function buildExpected(
  clusterId: string,
  certRecords: CertRecordFixture[],
): LearningPathway | null {
  const cluster = CAREER_CLUSTERS.find((c) => c.id === clusterId);
  if (!cluster) return null;
  if (!cluster.pathwayOrder || cluster.pathwayOrder.length === 0) return null;

  const certStatusMap = new Map<string, "complete" | "in_progress">();
  for (const record of certRecords) {
    certStatusMap.set(
      record.certType,
      record.status === "completed" ? "complete" : "in_progress",
    );
  }

  const steps: PathwayStep[] = [];
  const completedIds = new Set<string>();

  for (const stepId of cluster.pathwayOrder) {
    const certMeta = CERTIFICATIONS.find((c) => c.id === stepId);
    const platformMeta = PLATFORMS.find((p) => p.id === stepId);

    let name = stepId;
    let description = "";
    let estimatedHours = 10;
    let prerequisites: string[] = [];
    let type: "certification" | "platform" = "certification";

    if (certMeta) {
      name = certMeta.shortName;
      description = certMeta.description;
      estimatedHours = certMeta.estimatedHours;
      prerequisites = certMeta.prerequisites;
      type = "certification";
    } else if (platformMeta) {
      name = platformMeta.name;
      description = platformMeta.description;
      estimatedHours = 5;
      prerequisites = [];
      type = "platform";
    }

    const dbStatus = certStatusMap.get(stepId);
    const prereqsMet = prerequisites.every((prereqId) =>
      completedIds.has(prereqId),
    );

    let status: PathwayStep["status"];
    if (dbStatus === "complete") {
      status = "complete";
      completedIds.add(stepId);
    } else if (!prereqsMet) {
      status = "locked";
    } else if (dbStatus === "in_progress") {
      status = "in_progress";
    } else {
      status = "not_started";
    }

    steps.push({
      id: stepId,
      type,
      name,
      description,
      estimatedHours,
      status,
      prerequisites,
      isCurrent: false,
    });
  }

  const currentIdx = steps.findIndex(
    (s) => s.status !== "complete" && s.status !== "locked",
  );
  const finalSteps = steps.map((step, idx) => ({
    ...step,
    isCurrent: idx === currentIdx,
  }));

  const completedCount = finalSteps.filter((s) => s.status === "complete").length;
  const remainingHours = finalSteps
    .filter((s) => s.status !== "complete")
    .reduce((sum, s) => sum + s.estimatedHours, 0);

  return {
    clusterId: cluster.id,
    clusterName: cluster.label,
    steps: finalSteps,
    completedCount,
    totalCount: steps.length,
    estimatedWeeksRemaining: Math.ceil(remainingHours / HOURS_PER_WEEK),
  };
}

// ---------------------------------------------------------------------------
// Patch harness (goal-plan.test.ts pattern): monkey-patch the three Prisma
// reads getLearningPathway makes, restore in finally.
// ---------------------------------------------------------------------------

type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;

async function withPatchedPrisma(
  clusterId: string,
  certRecords: CertRecordFixture[],
  edgeRows: Array<{ fromId: string; toId: string }> | "empty",
  run: () => Promise<void>,
) {
  const originalDiscovery = prisma.careerDiscovery.findUnique;
  const originalCerts = prisma.certification.findMany;
  const originalEdges = prisma.progressionEdge.findMany;
  try {
    (prisma.careerDiscovery.findUnique as unknown as AnyAsyncFn) = async () => ({
      status: "complete",
      topClusters: [clusterId],
    });
    (prisma.certification.findMany as unknown as AnyAsyncFn) = async () =>
      certRecords;
    (prisma.progressionEdge.findMany as unknown as AnyAsyncFn) = async () =>
      edgeRows === "empty" ? [] : edgeRows;
    await run();
  } finally {
    prisma.careerDiscovery.findUnique = originalDiscovery;
    prisma.certification.findMany = originalCerts;
    prisma.progressionEdge.findMany = originalEdges;
  }
}

const derivedEdgeRows = () =>
  deriveEdgesFromStatic().map(({ fromId, toId }) => ({ fromId, toId }));

// ---------------------------------------------------------------------------
// Parity: for every career cluster, the DB-backed pathway must equal the
// static-derived pathway step for step.
// ---------------------------------------------------------------------------

test("parity: DB-derived pathway equals static-derived pathway for every cluster", async () => {
  for (const cluster of CAREER_CLUSTERS) {
    await withPatchedPrisma(cluster.id, [], derivedEdgeRows(), async () => {
      const actual = await getLearningPathway("student-1");
      const expected = buildExpected(cluster.id, []);
      assert.deepEqual(actual, expected, `cluster ${cluster.id} diverged`);
    });
  }
});

test("parity holds with completed and in-progress cert records (office cluster)", async () => {
  const certRecords = [
    { certType: "ic3", status: "completed" },
    { certType: "mos-word", status: "in_progress" },
  ];
  await withPatchedPrisma("office-admin", certRecords, derivedEdgeRows(), async () => {
    const actual = await getLearningPathway("student-1");
    const expected = buildExpected("office-admin", certRecords);
    assert.deepEqual(actual, expected);

    // Interesting statuses asserted explicitly, not just via deepEqual:
    assert.ok(actual);
    const byId = new Map(actual.steps.map((s) => [s.id, s]));
    assert.equal(byId.get("ic3")?.status, "complete");
    assert.equal(byId.get("mos-word")?.status, "in_progress");
    assert.equal(byId.get("mos-word")?.isCurrent, true);
    assert.equal(byId.get("mos-excel")?.status, "not_started");
    // mos-access needs mos-excel complete — must stay locked.
    assert.equal(byId.get("mos-access")?.status, "locked");
  });
});

// ---------------------------------------------------------------------------
// Fail-safe: an empty ProgressionEdge table (fresh environment, seed not yet
// run) must produce behavior identical to today's static arrays — gated
// steps must never silently unlock.
// ---------------------------------------------------------------------------

test("empty ProgressionEdge table falls back to static behavior (fail-safe)", async () => {
  for (const cluster of CAREER_CLUSTERS) {
    await withPatchedPrisma(cluster.id, [], "empty", async () => {
      const actual = await getLearningPathway("student-1");
      const expected = buildExpected(cluster.id, []);
      assert.deepEqual(actual, expected, `cluster ${cluster.id} diverged on empty table`);
    });
  }
});

test("locked steps stay locked when the edge table is empty", async () => {
  await withPatchedPrisma("office-admin", [], "empty", async () => {
    const actual = await getLearningPathway("student-1");
    assert.ok(actual);
    const access = actual.steps.find((s) => s.id === "mos-access");
    assert.equal(access?.status, "locked");
    assert.deepEqual(access?.prerequisites, ["ic3", "mos-excel"]);
  });
});
