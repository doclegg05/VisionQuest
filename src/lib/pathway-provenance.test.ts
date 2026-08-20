import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  NO_PATHWAY_PROVENANCE,
  pickPathwayCluster,
  resolvePathwayProvenance,
  type PathwayDiscoveryReader,
} from "./pathway-provenance";

type DiscoveryRow = { topClusters: string[] } | null;

function fakeReader(impl: () => Promise<DiscoveryRow>) {
  const calls: { where: { studentId: string } }[] = [];
  const reader: PathwayDiscoveryReader = {
    careerDiscovery: {
      findUnique: async (args) => {
        calls.push({ where: args.where });
        return impl();
      },
    },
  };
  return { reader, calls };
}

describe("pickPathwayCluster", () => {
  it("takes the student's top cluster", () => {
    assert.equal(pickPathwayCluster(["office-admin", "tech-digital"]), "office-admin");
  });

  it("returns null when discovery recorded no clusters", () => {
    assert.equal(pickPathwayCluster([]), null);
    assert.equal(pickPathwayCluster(null), null);
    assert.equal(pickPathwayCluster(undefined), null);
  });

  it("trims whitespace and skips blank entries", () => {
    assert.equal(pickPathwayCluster(["  ", "finance-bookkeeping"]), "finance-bookkeeping");
    assert.equal(pickPathwayCluster([" tech-digital "]), "tech-digital");
  });

  it("keeps a cluster id the catalog no longer carries", () => {
    // Provenance is a historical record. A retired cluster still answers
    // "what pathway were they on when they applied", so it is never dropped.
    assert.equal(pickPathwayCluster(["retired-cluster"]), "retired-cluster");
  });
});

describe("resolvePathwayProvenance", () => {
  const now = new Date("2026-08-20T10:00:00.000Z");

  it("captures the top cluster and the snapshot time", async () => {
    const { reader, calls } = fakeReader(async () => ({
      topClusters: ["customer-service", "office-admin"],
    }));

    const provenance = await resolvePathwayProvenance(reader, "student-1", now);

    assert.equal(provenance.pathwayClusterId, "customer-service");
    assert.deepEqual(provenance.pathwaySnapshotAt, now);
    assert.deepEqual(calls[0]?.where, { studentId: "student-1" });
  });

  it("records nothing when the student has no discovery row", async () => {
    const { reader } = fakeReader(async () => null);

    assert.deepEqual(await resolvePathwayProvenance(reader, "student-1", now), NO_PATHWAY_PROVENANCE);
  });

  it("records nothing when discovery exists but has no clusters", async () => {
    const { reader } = fakeReader(async () => ({ topClusters: [] }));

    assert.deepEqual(await resolvePathwayProvenance(reader, "student-1", now), NO_PATHWAY_PROVENANCE);
  });

  it("never blocks the application when the discovery read fails", async () => {
    const { reader } = fakeReader(async () => {
      throw new Error("connection reset");
    });

    assert.deepEqual(await resolvePathwayProvenance(reader, "student-1", now), NO_PATHWAY_PROVENANCE);
  });

  it("stamps the snapshot time itself when the caller passes no clock", async () => {
    const before = Date.now();
    const { reader } = fakeReader(async () => ({ topClusters: ["tech-digital"] }));

    const provenance = await resolvePathwayProvenance(reader, "student-1");

    assert.ok(provenance.pathwaySnapshotAt instanceof Date);
    assert.ok((provenance.pathwaySnapshotAt as Date).getTime() >= before);
  });
});
