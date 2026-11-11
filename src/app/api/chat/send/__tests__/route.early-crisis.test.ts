import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";
import { readSseBody, resetMocks, route, setSession } from "./route-harness";

// E2: a Stop or a dropped connection ends the stream before the 988 block the
// route appends at the end, so the first event says it applies.

const CRISIS_MESSAGE = "I just want to end it all";
const SPANISH_CRISIS_MESSAGE = "me quiero morir";
const NORMAL_MESSAGE = "How do I finish my OSHA 10 certification?";

function post(message: string) {
  const req = mockRequest("/api/chat/send", { method: "POST", body: { message } });
  return route.POST(req as never, { params: Promise.resolve({}) } as never);
}

function firstEvent(body: string): Record<string, unknown> {
  const line = body.split("\n").find((l) => l.startsWith("data: "));
  assert.ok(line, body);
  return JSON.parse(line!.slice("data: ".length)) as Record<string, unknown>;
}

describe("POST /api/chat/send: the 988 block on the first event (E2)", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("names the English block on the first event for a student's crisis message", async () => {
    const first = firstEvent(await readSseBody(await post(CRISIS_MESSAGE)));
    assert.ok(first.conversationId, JSON.stringify(first));
    assert.equal(first.crisisHelp, "en");
    // A language, not the text: the student sees 988 once, from the reply.
    assert.doesNotMatch(JSON.stringify(first), /988/);
  });

  it("names the Spanish block for a Spanish crisis message", async () => {
    const first = firstEvent(await readSseBody(await post(SPANISH_CRISIS_MESSAGE)));
    assert.equal(first.crisisHelp, "es");
  });

  it("still appends the block at the end of a full reply", async () => {
    const body = await readSseBody(await post(CRISIS_MESSAGE));
    const texts = body
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)) as { text?: string })
      .map((e) => e.text ?? "")
      .join("");
    assert.match(texts, /988/);
  });

  it("sends no block for an ordinary message", async () => {
    const first = firstEvent(await readSseBody(await post(NORMAL_MESSAGE)));
    assert.equal(first.crisisHelp, undefined);
  });

  it("sends no block on staff chat", async () => {
    setSession(mockTeacherSession());
    const first = firstEvent(await readSseBody(await post(CRISIS_MESSAGE)));
    assert.equal(first.crisisHelp, undefined);
  });
});
