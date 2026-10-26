import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider } from "@/lib/ai";
import { NATIONAL_CAREER_CLUSTERS } from "@/lib/spokes/national-clusters";
import {
  DISCOVERY_EXTRACTION_PROMPT,
  extractDiscoverySignals,
  topClusterIds,
} from "./discovery-extractor";

describe("topClusterIds", () => {
  it("returns top clusters by score above threshold", () => {
    const scores = {
      "office-admin": 0.8,
      "finance-bookkeeping": 0.6,
      "tech-digital": 0.2,
      "creative-design": 0.1,
      "customer-service": 0.9,
    };
    const top = topClusterIds(scores, 2, 0.3);
    assert.deepEqual(top, ["customer-service", "office-admin"]);
  });

  it("returns empty array when all scores are below threshold", () => {
    const scores = {
      "office-admin": 0.1,
      "tech-digital": 0.2,
    };
    assert.deepEqual(topClusterIds(scores, 2, 0.3), []);
  });

  it("returns fewer than count when not enough clusters qualify", () => {
    const scores = {
      "office-admin": 0.8,
      "tech-digital": 0.1,
    };
    assert.deepEqual(topClusterIds(scores, 2, 0.3), ["office-admin"]);
  });

  it("handles empty scores", () => {
    assert.deepEqual(topClusterIds({}, 2, 0.3), []);
  });
});

describe("DISCOVERY_EXTRACTION_PROMPT — national cluster contract", () => {
  // Retired 16-framework names that are NOT substrings of any current name,
  // so a plain includes() check is unambiguous. (Marketing, Manufacturing,
  // Human Services, and Agriculture survive inside new names and are covered
  // by the exact-membership assertions in national-clusters.test.ts.)
  const RETIRED_NAMES = [
    "Agriculture, Food & Natural Resources",
    "Architecture & Construction",
    "Arts, A/V Technology & Communications",
    "Business Management & Administration",
    "Education & Training",
    "Government & Public Administration",
    "Health Science",
    "Hospitality & Tourism",
    "Information Technology",
    "Law, Public Safety, Corrections & Security",
    "Science, Technology, Engineering & Mathematics",
    "Transportation, Distribution & Logistics",
  ];

  it("names all 14 modernized clusters", () => {
    assert.equal(NATIONAL_CAREER_CLUSTERS.length, 14);
    for (const cluster of NATIONAL_CAREER_CLUSTERS) {
      assert.ok(
        DISCOVERY_EXTRACTION_PROMPT.includes(cluster),
        `prompt is missing ${cluster}`,
      );
    }
  });

  it("names no retired cluster and no 16-cluster copy", () => {
    for (const retired of RETIRED_NAMES) {
      assert.ok(
        !DISCOVERY_EXTRACTION_PROMPT.includes(retired),
        `prompt still names retired cluster ${retired}`,
      );
    }
    assert.doesNotMatch(DISCOVERY_EXTRACTION_PROMPT, /16 national|these 16|16 clusters|16 standard/);
    assert.match(DISCOVERY_EXTRACTION_PROMPT, /14 national career clusters/);
  });
});

describe("extractDiscoverySignals — cluster-name normalization at the write boundary", () => {
  function stubProvider(nationalClusters: unknown): AIProvider {
    return {
      generateStructuredResponse: async () =>
        JSON.stringify({
          interests: [],
          strengths: [],
          subjects: [],
          problems: [],
          values: [],
          circumstances: [],
          cluster_scores: {},
          summary: "",
          riasec_scores: {},
          national_career_clusters: nationalClusters,
          transferable_skills: [],
          work_values: [],
          assessment_summary: "",
          stage_complete: false,
          xp_events: [],
        }),
    } as unknown as AIProvider;
  }

  const messages = [{ role: "user" as const, content: "I like helping people" }];

  it("canonicalizes legacy names and merges duplicates by max score with a SPOKES union", async () => {
    const result = await extractDiscoverySignals(
      stubProvider([
        { cluster_name: "Human Services", score: 0.5, spokes_mapping: ["customer-service"] },
        { cluster_name: "Health Science", score: 0.9, spokes_mapping: ["career-readiness"] },
        { cluster_name: "Information Technology", score: 0.6, spokes_mapping: ["tech-digital"] },
      ]),
      messages,
    );

    assert.deepEqual(result.national_career_clusters, [
      {
        cluster_name: "Healthcare & Human Services",
        score: 0.9,
        spokes_mapping: ["customer-service", "career-readiness"],
      },
      { cluster_name: "Digital Technology", score: 0.6, spokes_mapping: ["tech-digital"] },
    ]);
  });

  it("drops unknown cluster names and sub-threshold merges at the write boundary", async () => {
    const result = await extractDiscoverySignals(
      stubProvider([
        { cluster_name: "Totally Fake Cluster", score: 0.9, spokes_mapping: [] },
        { cluster_name: "Marketing", score: 0.2, spokes_mapping: [] },
        { cluster_name: "Marketing & Sales", score: 0.25, spokes_mapping: [] },
      ]),
      messages,
    );

    // Unknown name dropped; the two Marketing & Sales entries merge to 0.25,
    // which stays under the 0.3 floor, so nothing survives.
    assert.deepEqual(result.national_career_clusters, []);
  });
});

// A failed extraction must REJECT. The caller (post-response) runs this inside
// retryWithBackoff, which only retries and dead-letters to FailedExtraction
// when the function throws. Before this guard the extractor caught its own
// failures and resolved an all-empty result, so nothing was retried, nothing
// was dead-lettered, and the caller wrote the empties over the student's
// stored CareerDiscovery profile.
describe("extractDiscoverySignals — failures reach the caller", () => {
  const messages = [{ role: "user" as const, content: "I like fixing cars" }];

  function providerReturning(raw: string): AIProvider {
    return { generateStructuredResponse: async () => raw } as unknown as AIProvider;
  }

  it("rejects when the provider throws", async () => {
    const provider = {
      generateStructuredResponse: async () => {
        throw new Error("provider unavailable");
      },
    } as unknown as AIProvider;

    await assert.rejects(() => extractDiscoverySignals(provider, messages), /provider unavailable/);
  });

  it("rejects when the provider returns text that is not JSON", async () => {
    await assert.rejects(
      () => extractDiscoverySignals(providerReturning("Sure! Here are the signals: interests"), messages),
      SyntaxError,
    );
  });

  for (const raw of ["null", "[]", "\"no signals yet\"", "42"]) {
    it(`rejects JSON that is not an object (${raw})`, async () => {
      await assert.rejects(
        () => extractDiscoverySignals(providerReturning(raw), messages),
        /not a JSON object/,
      );
    });
  }

  it("still validates fields of a well-formed object instead of rejecting it", async () => {
    const result = await extractDiscoverySignals(
      providerReturning(JSON.stringify({ interests: "not-an-array", riasec_scores: { realistic: 7 } })),
      messages,
    );

    assert.deepEqual(result.interests, []);
    assert.equal(result.riasec_scores.realistic, 1);
    assert.equal(result.holland_code, "R");
  });
});

 it("keeps a model-first bounded transcript intact behind an analysis request", async () => {
  const transcript = [{ role: "model" as const, content: "Do you prefer practical work?" }, { role: "user" as const, content: "Yes, repairing things." }, { role: "model" as const, content: "We can explore that." }];
  let sent: typeof transcript = [];
  const provider = { generateStructuredResponse: async (_prompt: string, messages: typeof transcript) => { sent = messages; return "{}"; } } as unknown as AIProvider;
  await extractDiscoverySignals(provider, transcript);
  assert.equal(sent[0].role, "user");
  assert.equal(sent.at(-1)?.role, "user");
  assert.deepEqual(sent.slice(1, -1), transcript);
 });
