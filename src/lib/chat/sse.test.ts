import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatChatSseComment, formatChatSseEvent, parseChatSseChunk } from "./sse";

describe("parseChatSseChunk", () => {
  it("buffers partial data events until the full event arrives", () => {
    const first = parseChatSseChunk('data: {"text":"Hel', "");
    assert.deepEqual(first.events, []);

    const second = parseChatSseChunk('lo"}\n\ndata: {"done":true}\n\n', first.buffer);
    assert.deepEqual(second.events, [
      { text: "Hello" },
      { done: true },
    ]);
    assert.equal(second.buffer, "");
  });

  it("preserves stream error events so callers can surface them", () => {
    const result = parseChatSseChunk(
      'data: {"error":"Relay: connect ECONNREFUSED 127.0.0.1:11434"}\n\n',
      "",
    );

    assert.deepEqual(result.events, [
      { error: "Relay: connect ECONNREFUSED 127.0.0.1:11434" },
    ]);
    assert.equal(result.buffer, "");
  });

  it("ignores SSE keep-alive comments", () => {
    const result = parseChatSseChunk(
      `${formatChatSseComment("keep-alive")}${formatChatSseEvent({ text: "ready" })}`,
      "",
    );

    assert.deepEqual(result.events, [{ text: "ready" }]);
    assert.equal(result.buffer, "");
  });
});

describe("parseChatSseChunk boundary parse", () => {
  it("drops an event whose known fields have the wrong type", () => {
    for (const payload of ['{"error":42}', '{"text":["a"]}', '{"done":"yes"}', '{"failure":7,"error":"x"}', "[1,2]", '"just text"']) {
      const parsed = parseChatSseChunk(`data: ${payload}\n\n`, "");
      assert.deepEqual(parsed.events, [], payload);
    }
  });

  it("keeps a well-formed error event with its cause, 988 block and saved message id", () => {
    const event = { error: "Sage is busy.", failure: "busy", crisisBlock: "\n\n988", userMessageId: "m1" };
    const parsed = parseChatSseChunk(`data: ${JSON.stringify(event)}\n\n`, "");
    assert.deepEqual(parsed.events, [event]);
  });
});
