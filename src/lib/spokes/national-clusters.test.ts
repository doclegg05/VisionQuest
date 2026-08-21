import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAREER_CLUSTERS } from "./career-clusters";
import {
  LEGACY_NATIONAL_CLUSTER_MAP,
  NATIONAL_CAREER_CLUSTERS,
  NATIONAL_TO_SPOKES_MAP,
  formatNationalClustersForPrompt,
  normalizeNationalClusterName,
  normalizeNationalClusterScores,
  normalizeStoredNationalClustersJson,
  parseAndNormalizeStoredNationalClusters,
} from "./national-clusters";

// The modernized National Career Clusters Framework (Advance CTE, Oct 2024).
// Punctuation verified against careertech.org — the framework uses serial
// commas before the ampersand ("Arts, Entertainment, & Design").
const EXPECTED_14 = [
  "Advanced Manufacturing",
  "Agriculture",
  "Arts, Entertainment, & Design",
  "Construction",
  "Digital Technology",
  "Education",
  "Energy & Natural Resources",
  "Financial Services",
  "Healthcare & Human Services",
  "Hospitality, Events, & Tourism",
  "Management & Entrepreneurship",
  "Marketing & Sales",
  "Public Service & Safety",
  "Supply Chain & Transportation",
];

// The retired 16-cluster framework, exactly as the old taxonomy stored it.
const RETIRED_16 = [
  "Agriculture, Food & Natural Resources",
  "Architecture & Construction",
  "Arts, A/V Technology & Communications",
  "Business Management & Administration",
  "Education & Training",
  "Finance",
  "Government & Public Administration",
  "Health Science",
  "Hospitality & Tourism",
  "Human Services",
  "Information Technology",
  "Law, Public Safety, Corrections & Security",
  "Manufacturing",
  "Marketing",
  "Science, Technology, Engineering & Mathematics",
  "Transportation, Distribution & Logistics",
];

describe("NATIONAL_CAREER_CLUSTERS taxonomy", () => {
  it("holds exactly the 14 modernized clusters", () => {
    assert.deepEqual([...NATIONAL_CAREER_CLUSTERS].sort(), [...EXPECTED_14].sort());
    assert.equal(new Set(NATIONAL_CAREER_CLUSTERS).size, 14);
  });

  it("maps every cluster to at least one valid SPOKES pathway id", () => {
    const validSpokesIds = new Set(CAREER_CLUSTERS.map((c) => c.id));
    for (const cluster of NATIONAL_CAREER_CLUSTERS) {
      const spokesIds = NATIONAL_TO_SPOKES_MAP[cluster];
      assert.ok(spokesIds.length >= 1, `${cluster} has no SPOKES mapping`);
      for (const id of spokesIds) {
        assert.ok(validSpokesIds.has(id), `${cluster} maps to unknown SPOKES id ${id}`);
      }
    }
  });
});

describe("LEGACY_NATIONAL_CLUSTER_MAP crosswalk", () => {
  it("covers exactly the retired 16 clusters", () => {
    assert.deepEqual(
      Object.keys(LEGACY_NATIONAL_CLUSTER_MAP).sort(),
      [...RETIRED_16].sort(),
    );
  });

  it("maps every retired cluster onto a member of the 14", () => {
    const current = new Set<string>(NATIONAL_CAREER_CLUSTERS);
    for (const [legacy, replacement] of Object.entries(LEGACY_NATIONAL_CLUSTER_MAP)) {
      assert.ok(current.has(replacement), `${legacy} maps to non-member ${replacement}`);
    }
  });

  it("implements the agreed crosswalk, including the STEM → Digital Technology home", () => {
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Agriculture, Food & Natural Resources"], "Agriculture");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Architecture & Construction"], "Construction");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Arts, A/V Technology & Communications"], "Arts, Entertainment, & Design");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Business Management & Administration"], "Management & Entrepreneurship");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Education & Training"], "Education");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Finance"], "Financial Services");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Government & Public Administration"], "Public Service & Safety");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Health Science"], "Healthcare & Human Services");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Hospitality & Tourism"], "Hospitality, Events, & Tourism");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Human Services"], "Healthcare & Human Services");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Information Technology"], "Digital Technology");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Law, Public Safety, Corrections & Security"], "Public Service & Safety");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Manufacturing"], "Advanced Manufacturing");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Marketing"], "Marketing & Sales");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Science, Technology, Engineering & Mathematics"], "Digital Technology");
    assert.equal(LEGACY_NATIONAL_CLUSTER_MAP["Transportation, Distribution & Logistics"], "Supply Chain & Transportation");
  });

  it("unions merged clusters' SPOKES ids in the new map", () => {
    // Health Science (career-readiness) + Human Services (customer-service,
    // language-esl) both land on Healthcare & Human Services.
    assert.deepEqual(
      [...NATIONAL_TO_SPOKES_MAP["Healthcare & Human Services"]].sort(),
      ["career-readiness", "customer-service", "language-esl"],
    );
    // Government & Public Administration (office-admin, career-readiness) +
    // Law, Public Safety, Corrections & Security (career-readiness).
    assert.deepEqual(
      [...NATIONAL_TO_SPOKES_MAP["Public Service & Safety"]].sort(),
      ["career-readiness", "office-admin"],
    );
    // IT + STEM both mapped to tech-digital.
    assert.deepEqual(NATIONAL_TO_SPOKES_MAP["Digital Technology"], ["tech-digital"]);
  });
});

describe("normalizeNationalClusterName", () => {
  it("returns every current name unchanged", () => {
    for (const cluster of NATIONAL_CAREER_CLUSTERS) {
      assert.equal(normalizeNationalClusterName(cluster), cluster);
    }
  });

  it("maps every retired name to its new cluster", () => {
    for (const [legacy, replacement] of Object.entries(LEGACY_NATIONAL_CLUSTER_MAP)) {
      assert.equal(normalizeNationalClusterName(legacy), replacement);
    }
  });

  it("tolerates serial-comma, ampersand, and whitespace variants", () => {
    // Current names without the official serial comma.
    assert.equal(normalizeNationalClusterName("Arts, Entertainment & Design"), "Arts, Entertainment, & Design");
    assert.equal(normalizeNationalClusterName("Hospitality, Events & Tourism"), "Hospitality, Events, & Tourism");
    // "and" instead of "&".
    assert.equal(normalizeNationalClusterName("Healthcare and Human Services"), "Healthcare & Human Services");
    assert.equal(normalizeNationalClusterName("Marketing and Sales"), "Marketing & Sales");
    // Case and stray whitespace.
    assert.equal(normalizeNationalClusterName("  supply chain &  transportation "), "Supply Chain & Transportation");
    // Legacy names with variant punctuation still crosswalk.
    assert.equal(normalizeNationalClusterName("Agriculture, Food and Natural Resources"), "Agriculture");
    assert.equal(
      normalizeNationalClusterName("Science, Technology, Engineering, & Mathematics"),
      "Digital Technology",
    );
    assert.equal(normalizeNationalClusterName("health science"), "Healthcare & Human Services");
  });

  it("returns null for unknown names", () => {
    assert.equal(normalizeNationalClusterName("Office Administration"), null);
    assert.equal(normalizeNationalClusterName("Basket Weaving"), null);
    assert.equal(normalizeNationalClusterName(""), null);
    assert.equal(normalizeNationalClusterName("   "), null);
  });
});

describe("normalizeNationalClusterScores", () => {
  it("renames legacy entries and merges duplicates by MAX score with a SPOKES union", () => {
    const result = normalizeNationalClusterScores([
      { cluster_name: "Human Services", score: 0.8, spokes_mapping: ["customer-service"] },
      { cluster_name: "Health Science", score: 0.9, spokes_mapping: ["career-readiness"] },
      { cluster_name: "Information Technology", score: 0.6, spokes_mapping: ["tech-digital"] },
    ]);

    assert.deepEqual(result, [
      {
        cluster_name: "Healthcare & Human Services",
        score: 0.9,
        spokes_mapping: ["customer-service", "career-readiness"],
      },
      { cluster_name: "Digital Technology", score: 0.6, spokes_mapping: ["tech-digital"] },
    ]);
  });

  it("keeps first-appearance order and current names intact", () => {
    const result = normalizeNationalClusterScores([
      { cluster_name: "Digital Technology", score: 0.7, spokes_mapping: ["tech-digital"] },
      { cluster_name: "Finance", score: 0.5, spokes_mapping: ["finance-bookkeeping"] },
    ]);
    assert.deepEqual(
      result.map((entry) => entry.cluster_name),
      ["Digital Technology", "Financial Services"],
    );
  });

  it("passes unknown names through unchanged instead of destroying stored data", () => {
    const result = normalizeNationalClusterScores([
      { cluster_name: "Office Administration", score: 0.91, spokes_mapping: [] },
      { cluster_name: "Marketing", score: 0.4, spokes_mapping: [] },
    ]);
    assert.deepEqual(result, [
      { cluster_name: "Office Administration", score: 0.91, spokes_mapping: [] },
      { cluster_name: "Marketing & Sales", score: 0.4, spokes_mapping: [] },
    ]);
  });

  it("merges already-current duplicates introduced by legacy merges", () => {
    // A stored row can contain BOTH a legacy name and its new home.
    const result = normalizeNationalClusterScores([
      { cluster_name: "Healthcare & Human Services", score: 0.4, spokes_mapping: ["career-readiness"] },
      { cluster_name: "Human Services", score: 0.7, spokes_mapping: ["language-esl"] },
    ]);
    assert.deepEqual(result, [
      {
        cluster_name: "Healthcare & Human Services",
        score: 0.7,
        spokes_mapping: ["career-readiness", "language-esl"],
      },
    ]);
  });
});

describe("stored-JSON helpers", () => {
  it("parseAndNormalizeStoredNationalClusters parses, guards shape, and normalizes", () => {
    const raw = JSON.stringify([
      { cluster_name: "Health Science", score: 0.9, spokes_mapping: ["career-readiness"] },
      { cluster_name: 42, score: 0.9 }, // malformed entry dropped
      "not-an-object", // malformed entry dropped
    ]);
    assert.deepEqual(parseAndNormalizeStoredNationalClusters(raw), [
      { cluster_name: "Healthcare & Human Services", score: 0.9, spokes_mapping: ["career-readiness"] },
    ]);
    assert.deepEqual(parseAndNormalizeStoredNationalClusters(null), []);
    assert.deepEqual(parseAndNormalizeStoredNationalClusters("{not json"), []);
    assert.deepEqual(parseAndNormalizeStoredNationalClusters(JSON.stringify({ a: 1 })), []);
  });

  it("normalizeStoredNationalClustersJson round-trips a normalized JSON string", () => {
    const raw = JSON.stringify([
      { cluster_name: "Finance", score: 0.73, spokes_mapping: ["finance-bookkeeping"] },
    ]);
    assert.equal(
      normalizeStoredNationalClustersJson(raw),
      JSON.stringify([
        { cluster_name: "Financial Services", score: 0.73, spokes_mapping: ["finance-bookkeeping"] },
      ]),
    );
    assert.equal(normalizeStoredNationalClustersJson(null), null);
    // Unparseable input is returned unchanged — never invent content.
    assert.equal(normalizeStoredNationalClustersJson("{not json"), "{not json");
  });
});

describe("formatNationalClustersForPrompt", () => {
  it("lists all 14 clusters and says 14, not 16", () => {
    const prompt = formatNationalClustersForPrompt();
    assert.match(prompt, /14/);
    assert.doesNotMatch(prompt, /16/);
    for (const cluster of EXPECTED_14) {
      assert.ok(prompt.includes(cluster), `prompt is missing ${cluster}`);
    }
  });

  it("names no retired cluster", () => {
    const prompt = formatNationalClustersForPrompt();
    // Retired names that are substrings of a current name are skipped here;
    // the exact-list assertion above already pins the full membership.
    const substringOfCurrent = new Set(["Marketing", "Manufacturing", "Human Services", "Agriculture"]);
    for (const retired of RETIRED_16) {
      if (substringOfCurrent.has(retired)) continue;
      assert.ok(!prompt.includes(retired), `prompt still names retired cluster ${retired}`);
    }
  });
});

describe("backfill script parity (scripts/backfill-national-clusters.mjs)", () => {
  it("uses the same taxonomy, crosswalk, and merge semantics as the lib", async () => {
    const script = (await import(
      new URL("../../../scripts/backfill-national-clusters.mjs", import.meta.url).href
    )) as {
      CANONICAL_CLUSTERS: string[];
      LEGACY_MAP: Record<string, string>;
      migrateClusterEntries: (
        entries: { cluster_name: string; score: number; spokes_mapping?: string[] }[],
      ) => { cluster_name: string; score: number; spokes_mapping?: string[] }[];
    };

    assert.deepEqual([...script.CANONICAL_CLUSTERS].sort(), [...NATIONAL_CAREER_CLUSTERS].sort());
    assert.deepEqual(script.LEGACY_MAP, LEGACY_NATIONAL_CLUSTER_MAP);

    const sample = [
      { cluster_name: "Human Services", score: 0.8, spokes_mapping: ["customer-service"] },
      { cluster_name: "Health Science", score: 0.9, spokes_mapping: ["career-readiness"] },
      { cluster_name: "Office Administration", score: 0.91, spokes_mapping: [] },
      { cluster_name: "Science, Technology, Engineering & Mathematics", score: 0.5, spokes_mapping: ["tech-digital"] },
    ];
    assert.deepEqual(
      script.migrateClusterEntries(sample),
      normalizeNationalClusterScores(sample),
    );
  });
});
