import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canReachFormCsvExport } from "./region-rollup";

// No mocks: this pins the composition itself. The coordinator forms panel
// renders its CSV link from this answer, and the link must agree with the two
// gates on /api/teacher/forms/[templateId]/export — withTeacherAuth (teacher
// or admin) AND canPerformElevatedStaffAction (admin or coordinator).
describe("canReachFormCsvExport", () => {
  it("admits admins — the intersection of both gates", () => {
    assert.equal(canReachFormCsvExport("admin"), true);
  });

  it("refuses coordinators: they clear the tier gate but not withTeacherAuth", () => {
    assert.equal(canReachFormCsvExport("coordinator"), false);
  });

  it("refuses teachers: they clear withTeacherAuth but not the tier gate", () => {
    assert.equal(canReachFormCsvExport("teacher"), false);
  });

  it("refuses students and unknown roles", () => {
    assert.equal(canReachFormCsvExport("student"), false);
    assert.equal(canReachFormCsvExport("cdc"), false);
    assert.equal(canReachFormCsvExport(""), false);
  });
});
