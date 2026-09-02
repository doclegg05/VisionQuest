import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessReadability, PLAIN_LANGUAGE_IDEAL_GRADE } from "@/lib/sage/readability";
import { buildAskSagePrompt, streamSageReply } from "./ask-sage";

function sseResponse(lines: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

describe("buildAskSagePrompt (F24)", () => {
  it("quotes the goal the student is asking about", () => {
    assert.ok(buildAskSagePrompt("Get my GED").includes("Get my GED"));
  });

  it("reads at or under the grade-6 ideal so the student can edit it", () => {
    const result = assessReadability(buildAskSagePrompt("Get my GED"), { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    assert.ok(result.scorable, "prompt should be long enough to score");
    assert.ok(result.withinTarget, `prompt grade ${result.grade} is above ${PLAIN_LANGUAGE_IDEAL_GRADE}`);
  });
});

describe("streamSageReply (F24)", () => {
  it("posts the student's message to /api/chat/send and accumulates streamed text", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return sseResponse(['data: {"text":"Hi"}\n', 'data: {"text":" there"}\n', 'data: {"done":true}\n']);
    };
    const seen: string[] = [];
    const reply = await streamSageReply("My goal is X", fetcher, (partial) => seen.push(partial));
    assert.equal(reply, "Hi there");
    assert.deepEqual(seen, ["Hi", "Hi there"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/chat/send");
    assert.deepEqual(calls[0].body, { message: "My goal is X" });
  });

  it("throws when the send is rejected", async () => {
    const fetcher = async () => new Response(null, { status: 500 });
    await assert.rejects(() => streamSageReply("hello", fetcher, () => {}));
  });
});
