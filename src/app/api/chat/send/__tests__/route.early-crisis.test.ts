import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";
import {
  mockLogAiAuditEvent,
  mockRunAgentTurn,
  mockSaveMessage,
  readSseBody,
  resetMocks,
  route,
  setSession,
} from "./route-harness";

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

describe("POST /api/chat/send: a Stop before any text saves the 988 help (E2c 3)", () => {
  const previousAgentFlag = process.env.SAGE_AGENT_ENABLED;
  const previousAgentMode = process.env.SAGE_AGENT_MODE;
  before(() => {
    process.env.SAGE_AGENT_MODE = "full";
    delete process.env.SAGE_AGENT_ENABLED;
  });
  after(() => {
    if (previousAgentFlag === undefined) delete process.env.SAGE_AGENT_ENABLED;
    else process.env.SAGE_AGENT_ENABLED = previousAgentFlag;
    if (previousAgentMode === undefined) delete process.env.SAGE_AGENT_MODE;
    else process.env.SAGE_AGENT_MODE = previousAgentMode;
  });

  beforeEach(() => {
    resetMocks();
  });

  /**
   * Sage starts with a tool call, so no text has streamed when the student
   * presses Stop. The route notices the closed stream on its next event.
   */
  async function stopBeforeAnyText(message: string): Promise<void> {
    let release: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => { release = resolve; });
    mockRunAgentTurn.mock.mockImplementation(async function* () {
      await stopped;
      yield { type: "tool_call", callId: "t1", tool: "lookup_program_info", args: {} };
    });
    const res = await post(message);
    const reader = res.body!.getReader();
    await reader.read(); // the first event: ids and crisisHelp
    await reader.cancel();
    release();
    for (let i = 0; i < 200 && !failedAuditWritten(); i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(failedAuditWritten(), "the route finished the stopped turn");
  }

  function failedAuditWritten(): boolean {
    return mockLogAiAuditEvent.mock.calls.some(
      (call: { arguments: Array<{ status?: string }> }) => call.arguments[0]?.status === "failed",
    );
  }

  function assistantSaves(): string[] {
    return mockSaveMessage.mock.calls
      .filter((call: { arguments: unknown[] }) => call.arguments[2] === "assistant")
      .map((call: { arguments: unknown[] }) => String(call.arguments[3]));
  }

  it("a crisis message: saves the 988 block as the reply, marked as stopped so Try again still works", async () => {
    await stopBeforeAnyText(CRISIS_MESSAGE);
    const saves = assistantSaves();
    assert.equal(saves.length, 1, JSON.stringify(saves));
    const { SAVED_CUT_OFF_NOTE } = await import("@/lib/chat/sage-failure");
    const { CRISIS_RESOURCE_BLOCK } = await import("@/lib/chat/crisis-resource-blocks");
    // Exactly the note, then the 988 block as written: nothing reworded.
    assert.equal(saves[0], `\n\n${SAVED_CUT_OFF_NOTE}${CRISIS_RESOURCE_BLOCK}`);
  });

  it("an ordinary message: saves no reply (unchanged)", async () => {
    await stopBeforeAnyText(NORMAL_MESSAGE);
    assert.deepEqual(assistantSaves(), []);
  });
});

