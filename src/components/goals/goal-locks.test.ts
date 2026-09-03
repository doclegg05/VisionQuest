import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessReadability, PLAIN_LANGUAGE_IDEAL_GRADE } from "@/lib/sage/readability";
import { isLockedByProposal, PROPOSED_TOGGLE_HINT, type LockableGoal } from "./goal-locks";

const goals: LockableGoal[] = [
  { id: "m-proposed", status: "proposed", parentId: null },
  { id: "w-under-proposed", status: "active", parentId: "m-proposed" },
  { id: "t-under-proposed", status: "active", parentId: "w-under-proposed" },
  { id: "m-confirmed", status: "confirmed", parentId: null },
  { id: "w-proposed-self", status: "proposed", parentId: "m-confirmed" },
  { id: "t-under-confirmed", status: "active", parentId: "m-confirmed" },
  { id: "t-parent-missing", status: "active", parentId: "gone" },
];
const byId = new Map(goals.map((g) => [g.id, g]));
const find = (id: string) => byId.get(id)!;

describe("isLockedByProposal (F23 client guard)", () => {
  it("locks a goal that is itself Sage-proposed", () => {
    assert.equal(isLockedByProposal(find("w-proposed-self"), byId), true);
  });

  it("locks a weekly goal whose monthly parent is proposed", () => {
    assert.equal(isLockedByProposal(find("w-under-proposed"), byId), true);
  });

  it("locks a task whose monthly grandparent is proposed", () => {
    assert.equal(isLockedByProposal(find("t-under-proposed"), byId), true);
  });

  it("does not lock a task under a confirmed monthly goal", () => {
    assert.equal(isLockedByProposal(find("t-under-confirmed"), byId), false);
  });

  it("does not lock when the parent is missing from the map", () => {
    assert.equal(isLockedByProposal(find("t-parent-missing"), byId), false);
  });
});

describe("PROPOSED_TOGGLE_HINT copy", () => {
  it("reads at or under the grade-6 ideal", () => {
    const result = assessReadability(PROPOSED_TOGGLE_HINT, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    assert.ok(result.scorable, `hint too short to score: ${PROPOSED_TOGGLE_HINT}`);
    assert.ok(result.withinTarget, `hint grade ${result.grade} is above ${PLAIN_LANGUAGE_IDEAL_GRADE}`);
  });
});
