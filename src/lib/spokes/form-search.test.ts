import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

// Force the keyword-only path: with no API key the embedding index throws and
// searchForms falls back to deterministic keyword ranking.
delete process.env.GEMINI_API_KEY;

let searchForms: typeof import("./form-search").searchForms;
let keywordScore: typeof import("./form-search").keywordScore;
let resetCache: typeof import("./form-search").__resetFormEmbeddingCache;
let getFormById: typeof import("./forms").getFormById;

before(async () => {
  ({ searchForms, keywordScore, __resetFormEmbeddingCache: resetCache } = await import("./form-search"));
  ({ getFormById } = await import("./forms"));
  resetCache();
});

describe("keywordScore", () => {
  it("scores a form that hits the title above one that doesn't", () => {
    const attendance = getFormById("attendance-contract")!;
    const dress = getFormById("dress-code")!;
    assert.ok(attendance && dress);
    assert.ok(
      keywordScore("attendance", attendance) > keywordScore("attendance", dress),
      "attendance query should favor the attendance contract",
    );
  });

  it("returns 0 for an empty query", () => {
    const form = getFormById("welcome-letter")!;
    assert.equal(keywordScore("", form), 0);
  });
});

describe("searchForms — keyword fallback", () => {
  it("falls back to keyword ranking when embeddings are unavailable", async () => {
    const result = await searchForms({ query: "personal attendance contract", role: "student" });
    assert.equal(result.method, "keyword");
    assert.ok(result.candidates.length > 0);
    assert.equal(result.candidates[0].form.id, "attendance-contract");
  });

  it("resolves a loose paraphrase via synonym expansion", async () => {
    const result = await searchForms({
      query: "the paper I sign promising I'll show up",
      role: "student",
    });
    const ids = result.candidates.map((c) => c.form.id);
    assert.ok(ids.includes("attendance-contract"), `expected attendance-contract in ${ids.join(",")}`);
  });

  it("respects the limit", async () => {
    const result = await searchForms({ query: "form", role: "student", limit: 2 });
    assert.ok(result.candidates.length <= 2);
  });

  it("returns no candidates for an empty query", async () => {
    const result = await searchForms({ query: "   ", role: "student" });
    assert.deepEqual(result.candidates, []);
  });

  it("marks availability and exposes the form for link building", async () => {
    const result = await searchForms({ query: "attendance contract", role: "student" });
    const top = result.candidates[0];
    assert.ok(typeof top.available === "boolean");
    assert.ok(top.form.id.length > 0);
  });
});
