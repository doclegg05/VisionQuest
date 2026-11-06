import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { staffChatStageFor } from "./staff-chat-stage";

// /api/chat/send picks the staff path or the student path from this. A staff
// role that falls through to the student path is crisis-scanned as a student
// and gets the student prompt about itself.
describe("staffChatStageFor", () => {
  it("gives a program coordinator the coordinator staff path, never the student path", () => {
    assert.equal(staffChatStageFor("program_coordinator"), "coordinator_assistant");
  });

  it("gives a regional coordinator the coordinator staff path", () => {
    assert.equal(staffChatStageFor("coordinator"), "coordinator_assistant");
  });

  it("keeps admins and instructors on their own staff stages", () => {
    assert.equal(staffChatStageFor("admin"), "admin_assistant");
    assert.equal(staffChatStageFor("teacher"), "teacher_assistant");
  });

  it("sends students and every other role down the student path", () => {
    assert.equal(staffChatStageFor("student"), null);
    assert.equal(staffChatStageFor("cdc"), null);
  });
});
