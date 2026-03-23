import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAREER_CLUSTERS,
  getClusterById,
  getClusterCertNames,
  getClusterPlatformNames,
  formatClustersForPrompt,
} from "./career-clusters";
import { CERTIFICATIONS } from "./certifications";
import { PLATFORMS } from "./platforms";

describe("CAREER_CLUSTERS", () => {
  const certIds = new Set(CERTIFICATIONS.map((c) => c.id));
  const platformIds = new Set(PLATFORMS.map((p) => p.id));

  it("has at least 5 clusters", () => {
    assert.ok(CAREER_CLUSTERS.length >= 5);
  });

  it("every cluster has unique id", () => {
    const ids = CAREER_CLUSTERS.map((c) => c.id);
    assert.equal(ids.length, new Set(ids).size);
  });

  it("every cluster certificationId references an existing certification", () => {
    for (const cluster of CAREER_CLUSTERS) {
      for (const id of cluster.certificationIds) {
        assert.ok(certIds.has(id), `Cluster "${cluster.id}" references unknown cert "${id}"`);
      }
    }
  });

  it("every cluster platformId references an existing platform", () => {
    for (const cluster of CAREER_CLUSTERS) {
      for (const id of cluster.platformIds) {
        assert.ok(platformIds.has(id), `Cluster "${cluster.id}" references unknown platform "${id}"`);
      }
    }
  });

  it("every cluster has signalKeywords", () => {
    for (const cluster of CAREER_CLUSTERS) {
      assert.ok(cluster.signalKeywords.length > 0, `Cluster "${cluster.id}" has no signalKeywords`);
    }
  });
});

describe("getClusterById", () => {
  it("returns a cluster by id", () => {
    const cluster = getClusterById("office-admin");
    assert.ok(cluster);
    assert.equal(cluster.id, "office-admin");
  });

  it("returns undefined for unknown id", () => {
    assert.equal(getClusterById("nonexistent"), undefined);
  });
});

describe("getClusterCertNames", () => {
  it("returns cert short names for a cluster", () => {
    const cluster = getClusterById("finance-bookkeeping")!;
    const names = getClusterCertNames(cluster);
    assert.ok(names.length > 0);
    assert.ok(names.includes("QuickBooks"));
  });
});

describe("getClusterPlatformNames", () => {
  it("returns platform names for a cluster", () => {
    const cluster = getClusterById("language-esl")!;
    const names = getClusterPlatformNames(cluster);
    assert.ok(names.length > 0);
    assert.ok(names.includes("Burlington English"));
  });
});

describe("formatClustersForPrompt", () => {
  it("produces a non-empty string with all cluster labels", () => {
    const prompt = formatClustersForPrompt();
    assert.ok(prompt.length > 100);
    for (const cluster of CAREER_CLUSTERS) {
      assert.ok(prompt.includes(cluster.label), `Missing label for ${cluster.id}`);
    }
  });
});
