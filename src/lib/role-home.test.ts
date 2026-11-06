import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getRoleHomePath } from "./role-home";

describe("getRoleHomePath", () => {
  it("sends a program coordinator to /coordinator", () => {
    assert.equal(getRoleHomePath("program_coordinator"), "/coordinator");
  });
  it("keeps existing homes", () => {
    assert.equal(getRoleHomePath("coordinator"), "/coordinator");
    assert.equal(getRoleHomePath("admin"), "/admin");
  });
});
