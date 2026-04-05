import { describe, it } from "node:test";
import assert from "node:assert";
import { fuseResults } from "../fusion";
import type { ScoredChunk } from "../types";
import { SOURCE_PRIORS, IDENTIFIER_BONUS, RRF_K } from "../types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mockChunk(id: string, tier: string, docId: string): ScoredChunk {
  return {
    chunkId: id,
    sourceDocumentId: docId,
    sourceDocTitle: "Doc",
    sourceTier: tier,
    sourceWeight: 3.0,
    content: "text",
    breadcrumb: "b",
    sectionHeading: null,
    pageNumber: null,
    chunkIndex: 0,
    chunkType: null,
    parentId: null,
    score: 0,
  };
}

// ---------------------------------------------------------------------------
// fuseResults
// ---------------------------------------------------------------------------

describe("fuseResults", () => {
  it("combines scores from vector and lexical results", () => {
    const both = mockChunk("c1", "user_uploaded", "d1");
    const vectorOnly = mockChunk("c2", "user_uploaded", "d1");

    const results = fuseResults(
      [both, vectorOnly],
      [{ ...both }],
      new Set(),
    );

    const c1 = results.find((r) => r.chunkId === "c1")!;
    const c2 = results.find((r) => r.chunkId === "c2")!;

    // c1 appears in both lists so its RRF score is higher
    assert.ok(c1.score > c2.score, "chunk in both lists should score higher");
  });

  it("applies canonical source prior", () => {
    const canonical = mockChunk("c1", "canonical", "d1");
    const uploaded = mockChunk("c2", "user_uploaded", "d2");

    // Both at rank 0 in their respective single-element lists
    const results = fuseResults([canonical], [uploaded], new Set());

    const c1 = results.find((r) => r.chunkId === "c1")!;
    const c2 = results.find((r) => r.chunkId === "c2")!;

    // Same RRF rank contribution, but canonical gets +0.03
    const expectedDiff = SOURCE_PRIORS.canonical - SOURCE_PRIORS.user_uploaded;
    const actualDiff = c1.score - c2.score;
    assert.ok(
      Math.abs(actualDiff - expectedDiff) < 1e-10,
      `canonical prior should add ${expectedDiff}, got diff ${actualDiff}`,
    );
  });

  it("applies identifier bonus", () => {
    const matched = mockChunk("c1", "user_uploaded", "d1");
    const unmatched = mockChunk("c2", "user_uploaded", "d2");

    const results = fuseResults(
      [matched, unmatched],
      [],
      new Set(["d1"]),
    );

    const c1 = results.find((r) => r.chunkId === "c1")!;
    const c2 = results.find((r) => r.chunkId === "c2")!;

    const actualDiff = c1.score - c2.score;
    // c1 is rank 0 (1/60), c2 is rank 1 (1/61), plus identifier bonus 0.02
    const rrfDiff = 1 / (RRF_K + 0) - 1 / (RRF_K + 1);
    const expectedDiff = rrfDiff + IDENTIFIER_BONUS;
    assert.ok(
      Math.abs(actualDiff - expectedDiff) < 1e-10,
      `identifier bonus should add ${IDENTIFIER_BONUS}, got diff ${actualDiff} (expected ${expectedDiff})`,
    );
  });

  it("deduplicates by chunkId", () => {
    const chunk = mockChunk("c1", "curated", "d1");

    const results = fuseResults([chunk], [{ ...chunk }], new Set());

    const matching = results.filter((r) => r.chunkId === "c1");
    assert.strictEqual(matching.length, 1, "should appear exactly once");
  });

  it("returns empty array for empty inputs", () => {
    const results = fuseResults([], [], new Set());
    assert.deepStrictEqual(results, []);
  });

  it("sorts by score descending", () => {
    // Put canonical at a worse rank, user_uploaded at best rank
    // but canonical prior should still win if ranks are close enough
    const a = mockChunk("c1", "canonical", "d1");
    const b = mockChunk("c2", "curated", "d2");
    const c = mockChunk("c3", "user_uploaded", "d3");

    // All at different ranks in vector results only
    const results = fuseResults([c, b, a], [], new Set());

    for (let i = 1; i < results.length; i++) {
      assert.ok(
        results[i - 1].score >= results[i].score,
        `results[${i - 1}].score (${results[i - 1].score}) should be >= results[${i}].score (${results[i].score})`,
      );
    }
  });
});
