import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { AIProvider, ToolStreamEvent } from "@/lib/ai/types";

// E9b 8: a Stop aborts the provider stream, and the loop catches that throw.
// It is the student's choice, not a fault, so it logs at info: Sentry counts
// error-level lines, and every Stop would read as an outage.

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";
process.env.SAGE_AGENT_MODE = "full";

const errorMock = mock.fn();
const infoMock = mock.fn();

mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: infoMock, warn: mock.fn(), error: errorMock },
    requestId: () => "req-test",
  },
});
mock.module("./executor", { namedExports: { executeAgentTool: mock.fn() } });

let runAgentTurn: typeof import("./loop").runAgentTurn;

before(async () => {
  ({ runAgentTurn } = await import("./loop"));
});

beforeEach(() => {
  errorMock.mock.resetCalls();
  infoMock.mock.resetCalls();
});

function throwingProvider(onStart: () => void): AIProvider {
  return {
    name: "fake",
    generateResponse: async () => "",
    generateStructuredResponse: async () => "",
    async *streamResponse() {
      yield "";
    },
    async *streamWithTools(): AsyncGenerator<ToolStreamEvent> {
      onStart();
      throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    },
  };
}

async function drain(provider: AIProvider, signal: AbortSignal) {
  const reasons: string[] = [];
  for await (const event of runAgentTurn({
    provider,
    systemPrompt: "sys",
    messages: [{ role: "user", content: "hi" }],
    session: { id: "stu-1", role: "student" } as never,
    conversationId: "conv-1",
    toolNames: ["lookup_program_info"],
    hasAttachment: false,
    signal,
  })) {
    if (event.type === "agent_stop") reasons.push(event.reason);
  }
  return reasons;
}

describe("a Stop is not logged as an error (E9b 8)", () => {
  it("an aborted turn logs at info and still stops with reason error", async () => {
    const turn = new AbortController();
    const reasons = await drain(throwingProvider(() => turn.abort()), turn.signal);
    assert.deepEqual(reasons, ["error"]);
    assert.equal(errorMock.mock.callCount(), 0);
    assert.equal(infoMock.mock.callCount(), 1);
  });

  it("a real provider failure still logs at error", async () => {
    const turn = new AbortController();
    await drain(throwingProvider(() => undefined), turn.signal);
    assert.equal(errorMock.mock.callCount(), 1);
  });
});
