import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import { CRISIS_RESOURCE_BLOCK, CRISIS_RESOURCE_BLOCK_ES } from "@/lib/chat/crisis-safety-net";
import { FIRST_EVENT_TIMEOUT_WORDS, SageSendError } from "@/lib/chat/send-outcome";
import { assessReadability, PLAIN_LANGUAGE_IDEAL_GRADE } from "@/lib/sage/readability";
import { createSendAbort } from "./send-abort";
import { messagesAfterSendError } from "./send-turn";
import { FIRST_EVENT_TIMEOUT_MS, STALLED_REPLY_WORDS, STOP_ARM_DELAY_MS, STOPPED_NOTE } from "./wait-and-stop";

// E9b: what the chat shows when it ends a send itself before the server's
// first event (the 20 second bound, or a dropped connection), and what a Stop
// with nothing streamed leaves.

const DASHES = /[-‐-―−]/;
const HELP_EN = CRISIS_RESOURCE_BLOCK.replace(/^\n+/, "");
const HELP_ES = CRISIS_RESOURCE_BLOCK_ES.replace(/^\n+/, "");
const CRISIS_TEXT = "i want to kill myself";
const CRISIS_TEXT_ES = "me quiero morir";

function abortError(): Error {
  return Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

/** A send the gate timed out before the first event. */
function timedOutSend(text: string, role: "student" | "teacher" | "admin" | "coordinator" = "student") {
  return messagesAfterSendError({
    err: abortError(),
    stopped: false,
    timedOut: true,
    text,
    firstEventSeen: false,
    partial: "",
    events: [],
    crisisBlock: null,
    role,
    savedUserMessageId: null,
    id: "err-1",
  });
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
});
afterEach(() => {
  mock.timers.reset();
});

describe("a crisis message the chat cut off itself still shows the 988 help (E9b 1)", () => {
  it("the 20 second bound on a crisis message adds the English 988 bubble", () => {
    const after = timedOutSend(CRISIS_TEXT);
    assert.equal(after.messages.at(-1)?.content, HELP_EN);
    assert.equal(after.messages.at(-1)?.failure, undefined, "the help is not drawn as the error");
  });

  it("the help follows the language of the matched pattern", () => {
    assert.equal(timedOutSend(CRISIS_TEXT_ES).messages.at(-1)?.content, HELP_ES);
  });

  it("staff never get the 988 bubble, matching the server, which runs no crisis check for staff", () => {
    for (const role of ["teacher", "admin", "coordinator"] as const) {
      const after = timedOutSend(CRISIS_TEXT, role);
      assert.equal(after.messages.length, 1, role);
    }
  });

  it("a plain message gets no 988 bubble", () => {
    const after = timedOutSend("How do I get my OSHA card?");
    assert.equal(after.messages.length, 1);
    assert.doesNotMatch(after.messages[0].content, /988/);
  });

  it("a dropped connection before the first event also checks the text", () => {
    const after = messagesAfterSendError({
      err: new TypeError("Failed to fetch"), stopped: false, timedOut: false, text: CRISIS_TEXT, firstEventSeen: false,
      partial: "", events: [], crisisBlock: null, role: "student", savedUserMessageId: null, id: "err-2",
    });
    assert.equal(after.messages.at(-1)?.content, HELP_EN);
  });

  it("once the server sent its first event, its crisis flag decides, not the chat", () => {
    const after = messagesAfterSendError({
      err: new TypeError("network error"), stopped: false, timedOut: false, text: CRISIS_TEXT, firstEventSeen: true,
      partial: "", events: [], crisisBlock: null, role: "student", savedUserMessageId: "u1", id: "err-3",
    });
    assert.ok(after.messages.every((m) => !m.content.includes("988")));
  });

  it("a failure the server answered keeps the server's own 988 handling", () => {
    const err = new SageSendError("Sage is off right now.", "off");
    const after = messagesAfterSendError({
      err, stopped: false, timedOut: false, text: CRISIS_TEXT, firstEventSeen: false,
      partial: "", events: [], crisisBlock: null, role: "student", savedUserMessageId: null, id: "err-4",
    });
    assert.ok(after.messages.every((m) => !m.content.includes("988")));
  });
});

describe("the 20 second failure has its own sentence (E9b 3)", () => {
  it("says Sage could not be reached, offers Try again, and never says the message was saved", () => {
    const after = timedOutSend("hello");
    assert.equal(after.messages[0].content, FIRST_EVENT_TIMEOUT_WORDS);
    assert.equal(after.failedTurn?.offerRetry, true);
    assert.doesNotMatch(after.messages[0].content, /not lost/i);
    assert.doesNotMatch(after.messages[0].content, /instructor/i);
  });

  it("is plain words with no dashes", () => {
    assert.equal(FIRST_EVENT_TIMEOUT_WORDS, "We could not reach Sage. Check your internet, then tap Try again.");
    assert.doesNotMatch(FIRST_EVENT_TIMEOUT_WORDS, DASHES);
    const grade = assessReadability(FIRST_EVENT_TIMEOUT_WORDS, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    assert.ok(grade.withinTarget, JSON.stringify(grade));
  });

  it("the gate reports the timeout, and a Stop is not one", () => {
    const late = createSendAbort(() => undefined);
    late.begin();
    mock.timers.tick(FIRST_EVENT_TIMEOUT_MS);
    assert.equal(late.timedOut(), true);
    assert.equal(late.wasStopped(), false);

    const stopped = createSendAbort(() => undefined);
    stopped.begin();
    stopped.noteIds();
    mock.timers.tick(STOP_ARM_DELAY_MS);
    stopped.stop();
    assert.equal(stopped.timedOut(), false);
    assert.equal(stopped.wasStopped(), true);
  });

  it("a new send clears the timeout flag", () => {
    const gate = createSendAbort(() => undefined);
    const first = gate.begin();
    mock.timers.tick(FIRST_EVENT_TIMEOUT_MS);
    gate.end(first);
    gate.begin();
    assert.equal(gate.timedOut(), false);
  });
});

describe("a Stop with nothing streamed offers Try again (E9b 2)", () => {
  const stop = { err: abortError(), stopped: true, timedOut: false, text: "hi", firstEventSeen: true, events: [], crisisBlock: null, role: "student" as const, id: "s1" };

  it("with the saved message known, Try again points at it", () => {
    const after = messagesAfterSendError({ ...stop, partial: "", savedUserMessageId: "u1" });
    assert.equal(after.messages[0].content, STOPPED_NOTE);
    assert.deepEqual(after.messages[0].failure, { keepOnRetry: false, retryOf: "u1", alert: false });
    assert.deepEqual(after.failedTurn, { messageId: "s1", offerRetry: true, setupLink: false });
  });

  it("with partial text, today's Stop: no Try again", () => {
    const after = messagesAfterSendError({ ...stop, partial: "Half", savedUserMessageId: "u1" });
    assert.equal(after.messages[0].failure, undefined);
    assert.equal(after.failedTurn, null);
  });

  it("the two minute words name the button that now shows", () => {
    assert.equal(STALLED_REPLY_WORDS, "Sage is taking a long time. You can tap Stop, then tap Try again.");
    assert.doesNotMatch(STALLED_REPLY_WORDS, DASHES);
    const grade = assessReadability(STALLED_REPLY_WORDS, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    assert.ok(grade.withinTarget, JSON.stringify(grade));
  });
});
