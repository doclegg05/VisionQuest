import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ATTACHMENT_KINDS,
  classifyFromText,
  normalizeClassification,
} from "./classify-attachment";

describe("normalizeClassification — model JSON hardening", () => {
  it("accepts a well-formed object and trims nullable strings", () => {
    const result = normalizeClassification({
      kind: "certificate",
      title: "  IC3 Digital Literacy  ",
      issuer: "Certiport",
      dateOn: "March 3, 2026",
      isCompleted: true,
      identifiers: ["IC3-1234", "  ", "MOS-9"],
      summary: "An IC3 certificate awarded to the student.",
      confidence: "high",
    });

    assert.ok(result);
    assert.equal(result.kind, "certificate");
    assert.equal(result.title, "IC3 Digital Literacy");
    assert.equal(result.issuer, "Certiport");
    assert.equal(result.dateOn, "March 3, 2026");
    assert.equal(result.isCompleted, true);
    // Blank/whitespace identifiers are dropped, real ones trimmed.
    assert.deepEqual(result.identifiers, ["IC3-1234", "MOS-9"]);
    assert.equal(result.confidence, "high");
  });

  it("rejects objects with an invalid/missing kind", () => {
    assert.equal(normalizeClassification({ kind: "spaceship", summary: "x" }), null);
    assert.equal(normalizeClassification({ summary: "x" }), null);
    assert.equal(normalizeClassification(null), null);
    assert.equal(normalizeClassification("not an object"), null);
  });

  it("coerces missing optional fields to safe defaults", () => {
    const result = normalizeClassification({ kind: "form" });
    assert.ok(result);
    assert.equal(result.title, null);
    assert.equal(result.issuer, null);
    assert.equal(result.dateOn, null);
    assert.equal(result.isCompleted, null);
    assert.deepEqual(result.identifiers, []);
    assert.equal(result.confidence, "low"); // invalid/missing confidence floors to low
    assert.ok(result.summary.length > 0);
  });

  it("only keeps boolean isCompleted (string 'true' is not a boolean)", () => {
    const result = normalizeClassification({ kind: "certificate", isCompleted: "true", summary: "s" });
    assert.ok(result);
    assert.equal(result.isCompleted, null);
  });

  it("every declared kind round-trips", () => {
    for (const kind of ATTACHMENT_KINDS) {
      const result = normalizeClassification({ kind, summary: "s", confidence: "medium" });
      assert.ok(result, `kind ${kind} should normalize`);
      assert.equal(result.kind, kind);
    }
  });
});

describe("classifyFromText — local heuristic fallback", () => {
  it("detects a certificate and a completed signal", () => {
    const result = classifyFromText(
      "Certificate of Completion. This is hereby awarded to Jane Doe, who has completed the course on 03/14/2026.",
    );
    assert.equal(result.kind, "certificate");
    assert.equal(result.isCompleted, true);
    assert.equal(result.dateOn, "03/14/2026");
    assert.equal(result.confidence, "low");
  });

  it("detects a resume", () => {
    const result = classifyFromText(
      "Professional Summary: dependable worker. Work Experience: cashier. References available upon request.",
    );
    assert.equal(result.kind, "resume");
  });

  it("falls back to 'other' for unrecognizable text", () => {
    const result = classifyFromText("lorem ipsum dolor sit amet nothing matches here");
    assert.equal(result.kind, "other");
    assert.equal(result.isCompleted, null);
    assert.equal(result.dateOn, null);
  });

  it("never returns an empty summary", () => {
    const result = classifyFromText("a");
    assert.ok(result.summary.length > 0);
  });
});
