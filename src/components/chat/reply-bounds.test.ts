import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import { assessReadability, PLAIN_LANGUAGE_IDEAL_GRADE } from "@/lib/sage/readability";
import { sageFailureMessage } from "@/lib/chat/sage-failure";
import { createSendAbort } from "./send-abort";
import { messagesAfterSendError } from "./send-turn";
import {
  FIRST_EVENT_TIMEOUT_MS,
  REPLY_STALL_MS,
  SLOW_REPLY_MS,
  STALLED_REPLY_WORDS,
  STOP_ARM_DELAY_MS,
  firstEventOverdue,
  startStalledReplyTimer,
} from "./wait-and-stop";

// E7 (2): bounded recovery. A send whose first event never comes is ended by
// the client with E1's "unknown" failure and Try again; a reply that has its
// ids but sends no word for a long time tells the student Stop works.

const DASHES = /[-‐-―−]/;

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
});
afterEach(() => {
  mock.timers.reset();
});

describe("the first event's bound (E7 2)", () => {
  it("is 20 seconds, far past a normal first event and well before the server's own deadlines", () => {
    assert.equal(FIRST_EVENT_TIMEOUT_MS, 20_000);
    assert.ok(FIRST_EVENT_TIMEOUT_MS > SLOW_REPLY_MS);
  });

  it("is overdue only without the ids, from the bound on", () => {
    const sentAt = 1_000;
    assert.equal(firstEventOverdue({ idsArrived: false, sentAt, now: sentAt + FIRST_EVENT_TIMEOUT_MS - 1 }), false);
    assert.equal(firstEventOverdue({ idsArrived: false, sentAt, now: sentAt + FIRST_EVENT_TIMEOUT_MS }), true);
    assert.equal(firstEventOverdue({ idsArrived: true, sentAt, now: sentAt + FIRST_EVENT_TIMEOUT_MS * 10 }), false);
  });

  it("the gate aborts a send whose first event never comes, as a failure and not a Stop", () => {
    const gate = createSendAbort(() => undefined);
    const controller = gate.begin();
    mock.timers.tick(FIRST_EVENT_TIMEOUT_MS - 1);
    assert.equal(controller.signal.aborted, false);
    mock.timers.tick(1);
    assert.equal(controller.signal.aborted, true);
    assert.equal(gate.wasStopped(), false);
  });

  it("a Stop kept before the ids still ends as that failure, so the box unlocks", () => {
    const gate = createSendAbort(() => undefined);
    const controller = gate.begin();
    mock.timers.tick(STOP_ARM_DELAY_MS);
    gate.stop();
    assert.equal(controller.signal.aborted, false, "kept, waiting for the ids");
    mock.timers.tick(FIRST_EVENT_TIMEOUT_MS);
    assert.equal(controller.signal.aborted, true);
    assert.equal(gate.wasStopped(), false);
  });

  it("never fires once the ids arrive, or after the send ends", () => {
    const withIds = createSendAbort(() => undefined);
    const first = withIds.begin();
    withIds.noteIds();
    mock.timers.tick(FIRST_EVENT_TIMEOUT_MS * 3);
    assert.equal(first.signal.aborted, false);

    const ended = createSendAbort(() => undefined);
    const second = ended.begin();
    ended.end(second);
    mock.timers.tick(FIRST_EVENT_TIMEOUT_MS * 3);
    assert.equal(second.signal.aborted, false);
  });

  it("what the student sees: E1's unknown sentence with Try again, and no lost message claim", () => {
    const gate = createSendAbort(() => undefined);
    gate.begin();
    mock.timers.tick(FIRST_EVENT_TIMEOUT_MS);
    const after = messagesAfterSendError({
      err: Object.assign(new Error("The operation was aborted."), { name: "AbortError" }),
      stopped: gate.wasStopped(),
      partial: "",
      events: [],
      crisisBlock: null,
      role: "student",
      savedUserMessageId: null,
      id: "err-1",
    });
    assert.equal(after.failedTurn?.offerRetry, true);
    assert.equal(
      after.messages[0].content,
      sageFailureMessage("unknown", { audience: "student", messageSaved: false, canRetry: true }),
    );
  });
});

describe("a reply with no word for a long time (E7 2)", () => {
  it("is two minutes, past the slow words and the local model's 45 second first word bound", () => {
    assert.equal(REPLY_STALL_MS, 120_000);
    assert.ok(REPLY_STALL_MS > SLOW_REPLY_MS);
  });

  it("calls back once at two minutes, and never once cancelled", () => {
    const onStalled = mock.fn();
    startStalledReplyTimer(onStalled);
    mock.timers.tick(REPLY_STALL_MS - 1);
    assert.equal(onStalled.mock.callCount(), 0);
    mock.timers.tick(1);
    assert.equal(onStalled.mock.callCount(), 1);

    const cancelled = mock.fn();
    const cancel = startStalledReplyTimer(cancelled);
    cancel();
    mock.timers.tick(REPLY_STALL_MS * 2);
    assert.equal(cancelled.mock.callCount(), 0);
  });

  it("tells the student Stop works, in plain words with no dashes", () => {
    assert.match(STALLED_REPLY_WORDS, /Stop/);
    assert.doesNotMatch(STALLED_REPLY_WORDS, DASHES);
    const grade = assessReadability(STALLED_REPLY_WORDS, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    assert.ok(grade.withinTarget, JSON.stringify(grade));
  });
});
