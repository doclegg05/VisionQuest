import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateNode, type ExpectedHardFields } from "./validate";
import type { CatalogNode } from "./schema";

function node(over: Partial<CatalogNode["frontmatter"]> = {}, sections = {}): CatalogNode {
  return {
    frontmatter: {
      type: "form", title: "T", description: "d", resource: "r", tags: [], timestamp: "2026-06-30",
      vq_id: "dfa-ts-12", vq_audience: "BOTH", vq_category: "dohs",
      vq_storage_key: "forms/DFA-TS-12.pdf", vq_status: "approved", ...over,
    },
    sections: { whenToUse: "use it", whenNotToUse: "", related: "", ...sections },
    body: "", filePath: "catalog/forms/dfa-ts-12.md",
  };
}
const expected: ExpectedHardFields = {
  type: "form", title: "T", vq_audience: "BOTH", vq_category: "dohs", vq_storage_key: "forms/DFA-TS-12.pdf",
};
const ctx = { existingNodePaths: new Set<string>(), allowlistIds: ["dfa-ts-12"] };

describe("validateNode", () => {
  it("passes a well-formed approved node", () => {
    assert.deepEqual(validateNode(node(), expected, ctx), []);
  });
  it("flags a missing type", () => {
    const errs = validateNode(node({ type: undefined as never }), expected, ctx);
    assert.ok(errs.some((e) => e.rule === "type"));
  });
  it("flags hard-field drift", () => {
    const errs = validateNode(node({ vq_category: "onboarding" }), expected, ctx);
    assert.ok(errs.some((e) => e.rule === "drift"));
  });
  it("flags an approved node with an empty when-to-use", () => {
    const errs = validateNode(node({}, { whenToUse: "" }), expected, ctx);
    assert.ok(errs.some((e) => e.rule === "empty-approved"));
  });
});
