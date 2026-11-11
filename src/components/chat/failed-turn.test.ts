import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { failedTurnMessages, runExclusive, shouldFocusRetry } from "./failed-turn";
import type { SendErrorOutcome } from "@/lib/chat/send-outcome";

const BLOCK = "If you are in crisis, call or text 988.";

function outcome(overrides: Partial<SendErrorOutcome> = {}): SendErrorOutcome {
  return {
    displayContent: "Sage is busy.",
    failure: "busy",
    offerRetry: true,
    keepOnRetry: false,
    retryOf: "m1",
    conversationId: "c1",
    alert: true,
    setupLink: false,
    helpBlock: null,
    ...overrides,
  };
}

describe("failedTurnMessages (E1c 13)", () => {
  it("draws the 988 help as its own bubble after the error, with no error styling", () => {
    const [error, help, ...rest] = failedTurnMessages(outcome({ helpBlock: BLOCK }), "err-1");
    assert.equal(rest.length, 0);
    assert.equal(error.id, "err-1");
    assert.equal(error.content, "Sage is busy.");
    assert.deepEqual(error.failure, { keepOnRetry: false, retryOf: "m1", alert: true });
    assert.equal(help.id, "err-1-help");
    assert.equal(help.content, BLOCK);
    // No failure: the bubble draws as a reply, and Try again leaves it alone.
    assert.equal(help.failure, undefined);
  });

  it("adds no help bubble when there is no 988 block", () => {
    assert.equal(failedTurnMessages(outcome(), "err-1").length, 1);
  });
});

describe("shouldFocusRetry (E1c 9)", () => {
  it("moves focus to Try again only after loading ends", () => {
    const turn = { messageId: "err-1", offerRetry: true, setupLink: false };
    assert.equal(shouldFocusRetry(turn, true), false);
    assert.equal(shouldFocusRetry(turn, false), true);
    assert.equal(shouldFocusRetry({ ...turn, offerRetry: false }, false), false);
    assert.equal(shouldFocusRetry(null, false), false);
  });
});

describe("runExclusive (E1c 4)", () => {
  it("runs a second tap's task only after the first one finished", async () => {
    const flag = { current: false };
    let runs = 0;
    let release: () => void = () => undefined;
    const task = () =>
      new Promise<void>((resolve) => {
        runs += 1;
        release = resolve;
      });
    const first = runExclusive(flag, task);
    const second = runExclusive(flag, task);
    assert.equal(runs, 1, "the second tap before a re-render does nothing");
    release();
    await Promise.all([first, second]);
    assert.equal(flag.current, false);
    await Promise.all([runExclusive(flag, async () => void (runs += 1))]);
    assert.equal(runs, 2, "a later tap runs");
  });

  it("clears the flag when the task throws", async () => {
    const flag = { current: false };
    await assert.rejects(runExclusive(flag, async () => {
      throw new Error("boom");
    }));
    assert.equal(flag.current, false);
  });
});
