import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

const created: Array<{ targetId: string }> = [];

// mock.module MUST be at top level (not inside before()) — see operations.test.ts idiom.
// Placement inside before() silently bypasses the mock in Node's experimental module mocks.
mock.module("./wagers", {
  namedExports: {
    goalProposalWagerInput: (p: { goalId: string }) => ({ targetId: p.goalId }),
    createWager: async (input: { targetId: string }) => {
      created.push(input);
      return { wagerId: "w", created: true };
    },
  },
});

let maybeCreateGoalProposalWager: typeof import("./propose-goal-wager").maybeCreateGoalProposalWager;

before(async () => {
  const mod = await import("./propose-goal-wager");
  maybeCreateGoalProposalWager = mod.maybeCreateGoalProposalWager;
});

describe("maybeCreateGoalProposalWager", () => {
  it("creates a wager for a freshly created goal", async () => {
    await maybeCreateGoalProposalWager(
      { status: "created", goalId: "g1" },
      { studentId: "s1", sourceMessageId: "m1", now: new Date() },
    );
    assert.equal(created.at(-1)?.targetId, "g1");
  });

  it("creates a wager on the duplicate path too (recovery)", async () => {
    await maybeCreateGoalProposalWager(
      { status: "duplicate", goalId: "g2" },
      { studentId: "s1", sourceMessageId: "m1", now: new Date() },
    );
    assert.equal(created.at(-1)?.targetId, "g2");
  });

  it("does nothing for a rejected proposal", async () => {
    const lengthBefore = created.length;
    await maybeCreateGoalProposalWager(
      { status: "rejected", reason: "bad" },
      { studentId: "s1", sourceMessageId: "m1", now: new Date() },
    );
    assert.equal(created.length, lengthBefore);
  });
});
