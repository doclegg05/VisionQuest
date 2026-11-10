import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readChatStream, type ChatStreamHandlers } from "./chat-stream";
import { SageSendError } from "@/lib/chat/send-outcome";

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function recorder() {
  const seen = { ids: [] as Array<{ conversationId: string; userMessageId: string | null }>, text: [] as string[], done: 0 };
  const handlers: ChatStreamHandlers = {
    onIds: (ids) => seen.ids.push(ids),
    onText: (full) => seen.text.push(full),
    onEvents: () => undefined,
    onDone: () => {
      seen.done += 1;
    },
  };
  return { seen, handlers };
}

describe("readChatStream", () => {
  it("reports the saved message id from the first event, then the text, then done", async () => {
    const { seen, handlers } = recorder();
    const result = await readChatStream(
      sseResponse([{ conversationId: "c1", userMessageId: "m1" }, { text: "Hi " }, { text: "there" }, { done: true, conversationId: "c1" }]),
      handlers,
    );
    assert.deepEqual(seen.ids, [{ conversationId: "c1", userMessageId: "m1" }]);
    assert.deepEqual(seen.text, ["Hi ", "Hi there"]);
    assert.deepEqual(result, { completed: true, content: "Hi there", events: [] });
  });

  it("(1) an error after some text throws the server's failure, after the text was reported", async () => {
    const { seen, handlers } = recorder();
    await assert.rejects(
      readChatStream(
        sseResponse([
          { conversationId: "c1", userMessageId: "m1" },
          { text: "First part" },
          { error: "Sage is taking too long to answer.", failure: "slow", crisisBlock: "\n\n988", userMessageId: "m1" },
        ]),
        handlers,
      ),
      (err: unknown) =>
        err instanceof SageSendError && err.failure === "slow" && err.crisisBlock === "\n\n988" && err.userMessageId === "m1",
    );
    assert.deepEqual(seen.text, ["First part"]);
    assert.equal(seen.done, 0);
  });

  it("throws plainly when there is no body to read", async () => {
    const { handlers } = recorder();
    await assert.rejects(readChatStream(new Response(null), handlers), /No response stream/);
  });
});
