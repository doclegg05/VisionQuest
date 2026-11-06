import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import * as realForms from "@/lib/spokes/forms";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

// The real catalog has no instructor-only form today, so the test adds one.
// Every other export is the real module, including canViewForm.
const INSTRUCTOR_FORM_ID = "synthetic-instructor-checklist";
const instructorForm = {
  ...realForms.FORMS[0],
  id: INSTRUCTOR_FORM_ID,
  title: "Synthetic Instructor Checklist",
  audience: "instructor" as const,
};

mock.module("@/lib/spokes/forms", {
  exports: {
    ...realForms,
    FORMS: [...realForms.FORMS, instructorForm],
    resolveFormId: (raw: string) =>
      raw.trim().toLowerCase() === INSTRUCTOR_FORM_ID ? INSTRUCTOR_FORM_ID : realForms.resolveFormId(raw),
  },
});

let getToolByName: typeof import("./tools").getToolByName;

before(async () => {
  ({ getToolByName } = await import("./tools"));
});

function ctxFor(role: string) {
  return { session: { id: `${role}-1`, studentId: "", displayName: "Someone", role }, conversationId: "c-1" } as never;
}

describe("present_form — audience check on an exact id (R25)", () => {
  for (const role of ["student", "coordinator", "program_coordinator"]) {
    it(`refuses an instructor-only form to a ${role} asked for by id`, async () => {
      const tool = getToolByName("present_form");
      assert.ok(tool);

      const result = await tool.execute({ query: INSTRUCTOR_FORM_ID }, ctxFor(role));

      assert.equal(result.status, "error");
      assert.equal(result.action, undefined);
      assert.ok(!JSON.stringify(result).includes("Synthetic Instructor Checklist"));
    });
  }

  for (const role of ["teacher", "admin"]) {
    it(`opens the instructor-only form for a ${role}`, async () => {
      const tool = getToolByName("present_form");
      assert.ok(tool);

      const result = await tool.execute({ query: INSTRUCTOR_FORM_ID }, ctxFor(role));

      assert.equal(result.status, "success");
      assert.equal(result.action?.action, "open_form");
    });
  }

  it("still opens a student-audience form by id for a coordinator", async () => {
    const tool = getToolByName("present_form");
    assert.ok(tool);
    const result = await tool.execute({ query: "education-career-plan" }, ctxFor("coordinator"));
    assert.equal(result.status, "success");
  });
});
