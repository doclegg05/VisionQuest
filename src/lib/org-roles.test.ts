import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROGRAM_COORDINATOR,
  canInviteRole,
  inviteNeedsRegion,
  isCoordinatorRole,
  seesWholeState,
} from "./org-roles";

describe("org roles", () => {
  it("names the program coordinator role", () => {
    assert.equal(PROGRAM_COORDINATOR, "program_coordinator");
  });
  it("isCoordinatorRole covers both coordinator roles", () => {
    assert.equal(isCoordinatorRole("coordinator"), true);
    assert.equal(isCoordinatorRole("program_coordinator"), true);
    assert.equal(isCoordinatorRole("teacher"), false);
    assert.equal(isCoordinatorRole("admin"), false);
  });
  it("only admins invite program coordinators", () => {
    assert.equal(canInviteRole("admin", "program_coordinator"), true);
    assert.equal(canInviteRole("program_coordinator", "program_coordinator"), false);
  });
  it("program coordinators invite regional coordinators and instructors", () => {
    assert.equal(canInviteRole("program_coordinator", "coordinator"), true);
    assert.equal(canInviteRole("program_coordinator", "teacher"), true);
  });
  it("regional coordinators invite instructors only", () => {
    assert.equal(canInviteRole("coordinator", "teacher"), true);
    assert.equal(canInviteRole("coordinator", "coordinator"), false);
  });
  it("instructors, cdc and students invite no staff", () => {
    for (const r of ["teacher", "cdc", "student"]) assert.equal(canInviteRole(r, "teacher"), false);
  });
  it("seesWholeState is admin and program coordinator only", () => {
    assert.deepEqual(
      ["admin", "program_coordinator", "coordinator", "teacher"].map(seesWholeState),
      [true, true, false, false],
    );
  });
  it("coordinator and instructor invites need a region", () => {
    assert.equal(inviteNeedsRegion("coordinator"), true);
    assert.equal(inviteNeedsRegion("teacher"), true);
    assert.equal(inviteNeedsRegion("program_coordinator"), false);
  });
});
