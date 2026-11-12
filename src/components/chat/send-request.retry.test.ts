import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// E9b 6: a Try again whose saved id never arrived sends retryOf null, so the
// route can match the copy it may have saved. A plain send leaves it out.

const bodies: Array<Record<string, unknown>> = [];
const apiFetch = mock.fn(async (_url: string, init: { body: string }) => {
  bodies.push(JSON.parse(init.body) as Record<string, unknown>);
  return new Response("", { status: 200 });
});
mock.module("@/lib/api", { namedExports: { apiFetch } });

let postChatMessage: typeof import("./send-request").postChatMessage;
before(async () => {
  ({ postChatMessage } = await import("./send-request"));
});
beforeEach(() => {
  bodies.length = 0;
});

const base = { text: "hi", conversationId: "c1", stage: undefined, signal: new AbortController().signal };

describe("what a send tells the route about a Try again (E9b 6)", () => {
  it("keeps retryOf null for a Try again with no saved id", async () => {
    await postChatMessage({ ...base, retryOf: null });
    assert.equal(bodies[0].retryOf, null);
    assert.ok("retryOf" in bodies[0]);
  });

  it("sends the saved id when it is known, and nothing for a plain send", async () => {
    await postChatMessage({ ...base, retryOf: "ckq1question0000000000000" });
    await postChatMessage(base);
    assert.equal(bodies[0].retryOf, "ckq1question0000000000000");
    assert.ok(!("retryOf" in bodies[1]));
  });
});
