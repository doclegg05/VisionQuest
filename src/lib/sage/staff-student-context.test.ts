import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveStudentMention, type StaffStudentCandidate } from "./staff-student-context";

const candidates: StaffStudentCandidate[] = [
  { id: "stu1", displayName: "Karissa Johnson", studentId: "karissa.j" },
  { id: "stu2", displayName: "Marcus Lee", studentId: "mlee" },
  { id: "stu3", displayName: "Karissa Smith", studentId: "ksmith" },
];

describe("resolveStudentMention", () => {
  it("resolves a managed student by full display name", () => {
    const result = resolveStudentMention(
      candidates,
      "Can you give me a progress report for Karissa Johnson?",
    );

    assert.equal(result.status, "resolved");
    assert.equal(result.student?.id, "stu1");
  });

  it("resolves a managed student by student username", () => {
    const result = resolveStudentMention(
      candidates,
      "What should I do next for mlee?",
    );

    assert.equal(result.status, "resolved");
    assert.equal(result.student?.id, "stu2");
  });

  it("uses recent prior instructor messages for pronoun follow-up", () => {
    const result = resolveStudentMention(
      candidates,
      "She is in my class. Do you have access to her record?",
      ["Tell me about Marcus Lee."],
    );

    assert.equal(result.status, "resolved");
    assert.equal(result.student?.id, "stu2");
  });

  it("marks first-name-only matches ambiguous when multiple managed students match", () => {
    const result = resolveStudentMention(
      candidates,
      "Can you check Karissa's progress?",
    );

    assert.equal(result.status, "ambiguous");
    assert.equal(result.matches?.length, 2);
  });
});
