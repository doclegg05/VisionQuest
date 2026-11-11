import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CRISIS_RESOURCE_BLOCK } from "@/lib/chat/crisis-safety-net";
import { SageSendError } from "@/lib/chat/send-outcome";
import { messagesAfterSendError, turnResultMessages } from "./send-turn";
import { STOPPED_NOTE } from "./wait-and-stop";

const HELP = CRISIS_RESOURCE_BLOCK.replace(/^\n+/, "");

describe("turnResultMessages (E2b 7a)", () => {
  it("a full reply is one bubble with no Try again", () => {
    const { messages, failedTurn } = turnResultMessages({
      result: { completed: true, content: "All done.", events: [] }, id: "m1", savedUserMessageId: "u1", crisisBlock: CRISIS_RESOURCE_BLOCK,
    });
    assert.deepEqual(messages, [{ id: "m1", role: "assistant", content: "All done.", events: undefined, failure: undefined }]);
    assert.equal(failedTurn, null);
  });

  it("keeps tool chips on the reply", () => {
    const events = [{ id: "t1", kind: "tool" as const, summary: "Checking goals..." }];
    const { messages } = turnResultMessages({ result: { completed: true, content: "Ok.", events }, id: "m1", savedUserMessageId: null, crisisBlock: null });
    assert.deepEqual(messages[0].events, events);
  });

  it("a stream that ended early keeps the partial, offers Try again and adds the 988 help", () => {
    const { messages, failedTurn } = turnResultMessages({
      result: { completed: false, content: "Part", events: [] }, id: "m1", savedUserMessageId: "u1", crisisBlock: CRISIS_RESOURCE_BLOCK,
    });
    assert.equal(messages.length, 2);
    assert.match(messages[0].content, /^Part\n\n/);
    assert.deepEqual(messages[0].failure, { keepOnRetry: true, retryOf: "u1", alert: false });
    assert.equal(messages[1].content, HELP);
    assert.deepEqual(failedTurn, { messageId: "m1", offerRetry: true, setupLink: false });
  });

  it("an empty reply is drawn as an error", () => {
    const { messages } = turnResultMessages({ result: { completed: true, content: "", events: [] }, id: "m1", savedUserMessageId: "u1", crisisBlock: null });
    assert.equal(messages[0].failure?.alert, true);
  });
});

describe("messagesAfterSendError (E2b 7b)", () => {
  const base = { partial: "", events: [], crisisBlock: null, role: "student" as const, savedUserMessageId: "u1", id: "e1" };

  it("a Stop: the stopped note, no failure, no Try again, conversation unchanged", () => {
    const after = messagesAfterSendError({ ...base, err: new Error("aborted"), stopped: true, partial: "Half" });
    assert.deepEqual(after.messages.map((m) => m.content), [`Half\n\n${STOPPED_NOTE}`]);
    assert.equal(after.messages[0].failure, undefined);
    assert.equal(after.failedTurn, null);
    assert.equal(after.conversationId, null);
  });

  it("a Stop on a crisis message: the stopped reply, then the 988 help bubble (E2b 8)", () => {
    const after = messagesAfterSendError({ ...base, err: new Error("aborted"), stopped: true, partial: "I hear you", crisisBlock: CRISIS_RESOURCE_BLOCK });
    assert.deepEqual(after.messages.map((m) => m.content), [`I hear you\n\n${STOPPED_NOTE}`, HELP]);
    assert.deepEqual(after.messages.map((m) => m.id), ["e1", "e1-help"]);
  });

  it("a failure: the failure bubble, Try again, and the server's conversation", () => {
    const err = new SageSendError("Sage is busy right now.", "busy", { conversationId: "c9", userMessageId: "u1" });
    const after = messagesAfterSendError({ ...base, err, stopped: false });
    assert.equal(after.messages[0].failure?.alert, true);
    assert.deepEqual(after.failedTurn, { messageId: "e1", offerRetry: true, setupLink: false });
    assert.equal(after.conversationId, "c9");
  });

  it("a failure on a crisis message adds the 988 help when nothing shows it", () => {
    const after = messagesAfterSendError({ ...base, err: new TypeError("Failed to fetch"), stopped: false, crisisBlock: CRISIS_RESOURCE_BLOCK });
    assert.equal(after.messages.at(-1)?.content, HELP);
  });
});
