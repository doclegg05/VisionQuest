import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createTurnRecorder } from "./turn-recorder";

function recorder() {
  const calls: string[] = [];
  const turn = createTurnRecorder({
    noteIds: () => calls.push("noteIds"),
    noteConversation: (id) => calls.push(`conversation:${id}`),
    onFirstText: () => calls.push("firstText"),
    showText: (text) => calls.push(`text:${text}`),
    showEvents: (events) => calls.push(`events:${events.length}`),
  });
  return { calls, turn };
}

describe("the turn recorder (E2c 6)", () => {
  it("starts with nothing received", () => {
    const { turn } = recorder();
    assert.deepEqual(turn.sent(), { partial: "", events: [], crisisBlock: null, savedUserMessageId: null });
  });

  it("notes the ids before telling the Stop gate, so a kept Stop sees the saved message", () => {
    const { calls, turn } = recorder();
    turn.handlers.onIds({ conversationId: "c1", userMessageId: "u1" });
    assert.deepEqual(calls, ["conversation:c1", "noteIds"]);
    assert.equal(turn.sent().savedUserMessageId, "u1");
  });

  it("keeps the 988 block, the text and the events a Stop or failure needs", () => {
    const { calls, turn } = recorder();
    turn.handlers.onCrisisBlock?.("988 help");
    turn.handlers.onText("Hi");
    turn.handlers.onText("Hi there");
    turn.handlers.onEvents([]);
    assert.deepEqual(turn.sent(), { partial: "Hi there", events: [], crisisBlock: "988 help", savedUserMessageId: null });
    assert.deepEqual(calls, ["firstText", "text:Hi", "text:Hi there", "events:0"]);
  });

  it("hands each snapshot back as a new object", () => {
    const { turn } = recorder();
    const before = turn.sent();
    turn.handlers.onText("Hi");
    assert.equal(before.partial, "");
  });
});
