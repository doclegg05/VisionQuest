import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { getFormContext, resolveDirectFormMatch } from "./knowledge-base";

describe("getFormContext — agent vs plain wording", () => {
  const previousEnabled = process.env.SAGE_AGENT_ENABLED;
  const previousMode = process.env.SAGE_AGENT_MODE;

  after(() => {
    if (previousEnabled === undefined) delete process.env.SAGE_AGENT_ENABLED;
    else process.env.SAGE_AGENT_ENABLED = previousEnabled;
    if (previousMode === undefined) delete process.env.SAGE_AGENT_MODE;
    else process.env.SAGE_AGENT_MODE = previousMode;
  });

  it("when agent loop is on, instructs present_form and does not say provide URLs", () => {
    process.env.SAGE_AGENT_MODE = "readonly";
    process.env.SAGE_AGENT_ENABLED = "false";
    const ctx = getFormContext("I need the student profile form");
    assert.match(ctx, /MATCHING FORMS/);
    assert.match(ctx, /call present_form/i);
    assert.ok(!ctx.includes("provide these exact URLs"));
    assert.ok(!ctx.includes("/api/forms/download"));
    assert.match(ctx, /student-profile/);
  });

  it("when agent loop is off, keeps FORM LINKS with download URLs", () => {
    process.env.SAGE_AGENT_ENABLED = "false";
    delete process.env.SAGE_AGENT_MODE;
    const ctx = getFormContext("I need the student profile form");
    assert.match(ctx, /FORM LINKS \(provide these exact URLs/);
    assert.match(ctx, /\/api\/forms\/download\?formId=student-profile/);
  });
});

describe("resolveDirectFormMatch", () => {
  it("matches an explicit student profile form ask", () => {
    const matches = resolveDirectFormMatch("show me the student profile form");
    assert.ok(matches);
    assert.equal(matches![0].form.id, "student-profile");
  });

  it("returns null for goal talk with no form intent", () => {
    assert.equal(resolveDirectFormMatch("I want to set a big goal"), null);
  });
});

describe("findRelevantForms — sibling rules", () => {
  it("ranks attendance-contract first for promise-to-attend asks", async () => {
    const { findRelevantForms } = await import("./knowledge-base");
    const matches = findRelevantForms(
      "What form do I sign to promise I will come to class every day?",
    );
    assert.ok(matches.length >= 1);
    assert.equal(matches[0].form.id, "attendance-contract");
    assert.ok(!matches.some((m) => m.form.id === "sign-in-sheet"));
  });
});
