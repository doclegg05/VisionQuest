import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getFormById, resolveFormId } from "./forms";

describe("resolveFormId / FORM_ID_ALIASES", () => {
  it("resolves canonical ids unchanged", () => {
    assert.equal(resolveFormId("student-profile"), "student-profile");
    assert.equal(resolveFormId("attendance-contract"), "attendance-contract");
  });

  it("resolves legacy spokes-student-profile alias", () => {
    assert.equal(resolveFormId("spokes-student-profile"), "student-profile");
    assert.equal(getFormById("spokes-student-profile")?.id, "student-profile");
  });

  it("resolves common title-style aliases", () => {
    assert.equal(resolveFormId("rights-and-responsibilities"), "rights-responsibilities");
    assert.equal(resolveFormId("dress-code-policy"), "dress-code");
    assert.equal(resolveFormId("personal-attendance-contract"), "attendance-contract");
  });

  it("returns null for unknown ids", () => {
    assert.equal(resolveFormId("not-a-real-form"), null);
    assert.equal(getFormById("not-a-real-form"), undefined);
  });
});

describe("portfolio twin titles", () => {
  it("gives tracking checklist a distinct title", () => {
    const onboarding = getFormById("portfolio-checklist");
    const tracking = getFormById("portfolio-checklist-tracking");
    assert.ok(onboarding && tracking);
    assert.notEqual(onboarding!.title, tracking!.title);
    assert.match(tracking!.title, /Tracking/i);
  });
});
