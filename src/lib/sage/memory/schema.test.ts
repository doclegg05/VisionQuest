import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  memoryCandidateSchema,
  parseExtractionItems,
  sourceHashFor,
} from "./schema";

const valid = {
  subjectType: "student",
  subjectId: "stu-1",
  kind: "semantic",
  content: "Wants to become a certified nursing assistant.",
  category: "goal",
  confidence: 0.9,
  sourceType: "conversation",
  sourceId: "conv-1",
};

describe("memoryCandidateSchema", () => {
  it("accepts a valid candidate and defaults confidence", () => {
    const { confidence: _unused, ...noConfidence } = valid;
    const parsed = memoryCandidateSchema.parse(noConfidence);
    assert.equal(parsed.confidence, 0.7);
  });

  it("rejects out-of-vocab values", () => {
    assert.equal(memoryCandidateSchema.safeParse({ ...valid, kind: "vibes" }).success, false);
    assert.equal(memoryCandidateSchema.safeParse({ ...valid, category: "secret" }).success, false);
    assert.equal(memoryCandidateSchema.safeParse({ ...valid, subjectType: "robot" }).success, false);
  });

  it("rejects empty and oversized content", () => {
    assert.equal(memoryCandidateSchema.safeParse({ ...valid, content: "  " }).success, false);
    assert.equal(
      memoryCandidateSchema.safeParse({ ...valid, content: "x".repeat(501) }).success,
      false,
    );
  });

  it("rejects confidence outside 0-1", () => {
    assert.equal(memoryCandidateSchema.safeParse({ ...valid, confidence: 1.2 }).success, false);
  });
});

describe("sourceHashFor", () => {
  it("is stable across casing, punctuation, and whitespace", () => {
    const a = sourceHashFor({
      subjectType: "student",
      subjectId: "stu-1",
      content: "Wants to become a certified nursing assistant.",
    });
    const b = sourceHashFor({
      subjectType: "student",
      subjectId: "stu-1",
      content: "  wants to become a CERTIFIED nursing assistant!  ",
    });
    assert.equal(a, b);
  });

  it("differs across subjects and content", () => {
    const base = { subjectType: "student" as const, subjectId: "stu-1", content: "fact" };
    assert.notEqual(sourceHashFor(base), sourceHashFor({ ...base, subjectId: "stu-2" }));
    assert.notEqual(sourceHashFor(base), sourceHashFor({ ...base, content: "other fact" }));
  });
});

describe("parseExtractionItems", () => {
  it("keeps valid entries, counts rejects, never throws", () => {
    const { accepted, rejected } = parseExtractionItems([
      { kind: "semantic", content: "Valid fact.", category: "skill", confidence: 0.8 },
      { kind: "nonsense", content: "Bad kind.", category: "skill", confidence: 0.8 },
      "garbage",
    ]);
    assert.equal(accepted.length, 1);
    assert.equal(rejected, 2);
  });

  it("returns empty for non-arrays", () => {
    assert.deepEqual(parseExtractionItems({ not: "an array" }), { accepted: [], rejected: 0 });
  });
});
