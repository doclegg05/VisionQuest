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
