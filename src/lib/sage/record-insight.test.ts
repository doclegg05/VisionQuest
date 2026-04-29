import test from "node:test";
import assert from "node:assert/strict";
import { validateInsightInput } from "./record-insight";

test("validateInsightInput: accepts a valid barrier insight", () => {
  const r = validateInsightInput({
    category: "barrier",
    content: "  Anxious about returning to school after 10 years.  ",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.category, "barrier");
    assert.equal(r.content, "Anxious about returning to school after 10 years.");
  }
});

test("validateInsightInput: accepts all five recognized categories", () => {
  for (const category of ["goal", "barrier", "strength", "context", "concern"]) {
    const r = validateInsightInput({
      category,
      content: `insight about ${category}`,
    });
    assert.equal(r.ok, true, `expected category "${category}" to be accepted`);
  }
});

test("validateInsightInput: rejects empty content", () => {
  const r = validateInsightInput({ category: "context", content: "  " });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /empty/i);
});

test("validateInsightInput: rejects content over 2000 chars", () => {
  const r = validateInsightInput({
    category: "context",
    content: "x".repeat(2001),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /2000/);
});

test("validateInsightInput: rejects unknown category", () => {
  const r = validateInsightInput({
    category: "vibes",
    content: "Something",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /invalid category/i);
});

test("validateInsightInput: rejects confidence outside [0, 1]", () => {
  const above = validateInsightInput({
    category: "context",
    content: "x",
    confidence: 1.5,
  });
  assert.equal(above.ok, false);

  const below = validateInsightInput({
    category: "context",
    content: "x",
    confidence: -0.1,
  });
  assert.equal(below.ok, false);
});

test("validateInsightInput: accepts confidence at the boundaries", () => {
  for (const c of [0, 0.5, 1]) {
    const r = validateInsightInput({
      category: "context",
      content: "x",
      confidence: c,
    });
    assert.equal(r.ok, true, `expected confidence=${c} to be accepted`);
  }
});
