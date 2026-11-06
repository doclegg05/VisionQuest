import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canPlaceApplicants, placeApplicantRequest } from "./org-placement-client";

describe("canPlaceApplicants", () => {
  it("is true for admins only", () => {
    assert.equal(canPlaceApplicants("admin"), true);
    for (const role of ["program_coordinator", "coordinator", "teacher", "student"]) {
      assert.equal(canPlaceApplicants(role), false, role);
    }
  });
});

describe("placeApplicantRequest", () => {
  it("targets reassign-class with the class id the route expects", () => {
    assert.deepEqual(placeApplicantRequest("stu1", "cls1"), {
      url: "/api/teacher/students/stu1/reassign-class",
      body: { newClassId: "cls1" },
    });
  });
});
