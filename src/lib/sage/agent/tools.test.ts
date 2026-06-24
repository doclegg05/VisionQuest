import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

let getToolByName: typeof import("./tools").getToolByName;

before(async () => {
  ({ getToolByName } = await import("./tools"));
});

const CTX = {
  session: { id: "stu-1", role: "student" },
  conversationId: "conv-1",
} as never;

describe("present_form — link target", () => {
  it("links catalog forms to the PDF download endpoint, NOT the Forms Hub fill route", async () => {
    const tool = getToolByName("present_form");
    assert.ok(tool, "present_form tool exists");

    const result = await tool.execute({ query: "education and career plan" }, CTX);

    assert.equal(result.status, "success");
    assert.equal(result.action?.action, "open_form");
    // /forms/<catalog-slug> is the Forms Hub fill UI keyed by DB FormTemplate
    // ids — catalog slugs 404 there ("We couldn't load this form").
    assert.equal(
      result.action?.target,
      "/api/forms/download?formId=education-career-plan&mode=view",
    );
  });

  it("fuzzy match still resolves the right form", async () => {
    const tool = getToolByName("present_form");
    const result = await tool!.execute({ query: "career plan" }, CTX);
    assert.equal(result.status, "success");
    assert.match(String(result.summary), /Education and Career Plan/);
  });
});
