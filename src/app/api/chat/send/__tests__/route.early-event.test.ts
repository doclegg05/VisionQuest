import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";
import type { GenerationOptions } from "@/lib/ai/types";
import {
  mockAssembleStudentContextBundle,
  mockBuildStaffStudentContext,
  mockLogAiAuditEvent,
  mockRecordWellbeingConcern,
  mockResolveAiProvider,
  mockRunAgentTurn,
  mockSaveMessage,
  mockShouldAttemptStaffStudentContext,
  readSseBody,
  resetMocks,
  route,
  setSession,
} from "./route-harness";

// E7: the chat never traps a student waiting, and a Stop frees the model.
// (1) The first event (ids and crisisHelp) leaves before context assembly, so
//     Stop arms at once and a stalled assembly cannot lock the message box.
// (3) A client abort (req.signal, or the stream's cancel) aborts the model
//     call; the stopped turn still saves E2's reply row and its audit row.

const CRISIS_MESSAGE = "I just want to end it all";
const NORMAL_MESSAGE = "How do I finish my OSHA 10 certification?";
const BOUND_MS = 1_000;
const BOUND = { timeout: 5_000 };

function post(message: string, signal?: AbortSignal) {
  const base = mockRequest("/api/chat/send", { method: "POST", body: { message } });
  const req = signal ? new Request(base, { signal }) : base;
  return route.POST(req as never, { params: Promise.resolve({}) } as never);
}

/** Resolves with `work`, or rejects when it takes longer than BOUND_MS. */
function within<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${BOUND_MS} ms`)), BOUND_MS);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** A gate a mock waits on until the test opens it. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

function firstEventOf(chunk: Uint8Array | undefined): Record<string, unknown> {
  const text = new TextDecoder().decode(chunk);
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  assert.ok(line, text);
  return JSON.parse(line!.slice("data: ".length)) as Record<string, unknown>;
}

function auditStatuses(): Array<{ status?: string; errorCode?: string }> {
  return mockLogAiAuditEvent.mock.calls.map((call: { arguments: Array<{ status?: string; errorCode?: string }> }) => call.arguments[0]);
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400 && !check(); i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(check(), what);
}

function assistantSaves(): string[] {
  return mockSaveMessage.mock.calls
    .filter((call: { arguments: unknown[] }) => call.arguments[2] === "assistant")
    .map((call: { arguments: unknown[] }) => String(call.arguments[3]));
}

/** A provider whose stream waits until its signal aborts, recording the signal. */
function hangingProvider() {
  const seen: { signal: AbortSignal | undefined; calls: number } = { signal: undefined, calls: 0 };
  const provider = {
    name: "ollama",
    async generateResponse(): Promise<string> {
      return "";
    },
    async *streamResponse(_s: string, _m: unknown, _u: unknown, options?: GenerationOptions): AsyncGenerator<string> {
      seen.calls += 1;
      seen.signal = options?.signal;
      await new Promise<void>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
      });
      yield "never";
    },
    async generateStructuredResponse() {
      return "{}";
    },
  };
  return { provider, seen };
}

describe("POST /api/chat/send: the first event leaves before context assembly (E7 1)", () => {
  const previousAgentFlag = process.env.SAGE_AGENT_ENABLED;
  before(() => {
    process.env.SAGE_AGENT_ENABLED = "false";
  });
  after(() => {
    if (previousAgentFlag === undefined) delete process.env.SAGE_AGENT_ENABLED;
    else process.env.SAGE_AGENT_ENABLED = previousAgentFlag;
  });
  beforeEach(() => {
    resetMocks();
  });

  it("answers, with the ids and the crisis flag, while the student's context is still loading", BOUND, async () => {
    const assembly = gate();
    mockAssembleStudentContextBundle.mock.mockImplementation(async () => {
      await assembly.wait;
      throw new Error("never reached in this test");
    });
    const res = await within(post(CRISIS_MESSAGE), "the response");
    const reader = res.body!.getReader();
    const first = firstEventOf((await within(reader.read(), "the first event")).value);
    assert.equal(first.conversationId, "conv-1");
    assert.equal(first.userMessageId, "test-msg-id");
    assert.equal(first.crisisHelp, "en");
    // The crisis scan ran before anything else, so the staff alert is raised.
    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1);
    assembly.open();
    await reader.cancel();
  });

  it("does the same for a staff turn whose student context is still loading", BOUND, async () => {
    setSession(mockTeacherSession());
    mockShouldAttemptStaffStudentContext.mock.mockImplementation(() => true);
    const staffContext = gate();
    mockBuildStaffStudentContext.mock.mockImplementation(async () => {
      await staffContext.wait;
      return { context: null, targetStudentId: null, resolution: "none" };
    });
    const res = await within(post("How is Jordan doing this week?"), "the response");
    const reader = res.body!.getReader();
    const first = firstEventOf((await within(reader.read(), "the first event")).value);
    assert.equal(first.conversationId, "conv-tch-1");
    staffContext.open();
    await reader.cancel();
  });

  it("an assembly failure arrives as an error event with the unknown sentence, the saved id and the 988 block", BOUND, async () => {
    const { sageFailureMessage } = await import("@/lib/chat/sage-failure");
    mockAssembleStudentContextBundle.mock.mockImplementation(async () => {
      throw new Error("prisma: connection to the database was lost");
    });
    const res = await post(CRISIS_MESSAGE);
    assert.equal(res.status, 200);
    const body = await readSseBody(res);
    const line = body.split("\n").find((l) => l.startsWith("data: ") && l.includes('"failure"'));
    assert.ok(line, body);
    const event = JSON.parse(line!.slice(6)) as { error: string; failure: string; crisisBlock?: string; userMessageId?: string; conversationId?: string };
    assert.equal(event.failure, "unknown");
    assert.ok(event.crisisBlock);
    assert.equal(
      event.error,
      sageFailureMessage("unknown", { audience: "student", messageSaved: true, canRetry: true }) + event.crisisBlock,
    );
    assert.equal(event.userMessageId, "test-msg-id");
    assert.equal(event.conversationId, "conv-1");
    assert.doesNotMatch(body, /connection to the database/);
  });
});

describe("POST /api/chat/send: a client abort cancels the model call (E7 3)", () => {
  const previousAgentFlag = process.env.SAGE_AGENT_ENABLED;
  const previousAgentMode = process.env.SAGE_AGENT_MODE;
  after(() => {
    if (previousAgentFlag === undefined) delete process.env.SAGE_AGENT_ENABLED;
    else process.env.SAGE_AGENT_ENABLED = previousAgentFlag;
    if (previousAgentMode === undefined) delete process.env.SAGE_AGENT_MODE;
    else process.env.SAGE_AGENT_MODE = previousAgentMode;
  });
  beforeEach(() => {
    resetMocks();
    process.env.SAGE_AGENT_ENABLED = "false";
    delete process.env.SAGE_AGENT_MODE;
  });

  for (const how of ["stream cancel", "request signal"] as const) {
    it(`${how}: the provider's signal aborts, and the stopped crisis turn saves its 988 row`, BOUND, async () => {
      const { provider, seen } = hangingProvider();
      mockResolveAiProvider.mock.mockImplementation(async () => provider);
      const client = new AbortController();
      const res = await post(CRISIS_MESSAGE, how === "request signal" ? client.signal : undefined);
      const reader = res.body!.getReader();
      await reader.read();
      await until(() => seen.calls === 1, "the model call started");
      if (how === "stream cancel") await reader.cancel();
      else client.abort();
      await until(() => seen.signal?.aborted === true, "the model call was aborted");
      await until(() => auditStatuses().some((a) => a.status === "failed"), "the stopped turn was finished");
      assert.equal(auditStatuses().find((a) => a.status === "failed")?.errorCode, "CLIENT_STREAM_CLOSED");
      assert.equal(seen.calls, 1, "the cancelled call was not retried");
      const saves = assistantSaves();
      assert.equal(saves.length, 1, JSON.stringify(saves));
      assert.match(saves[0], /988/);
      if (how === "request signal") await reader.cancel().catch(() => undefined);
    });
  }

  it("agent loop: the turn's signal reaches runAgentTurn", BOUND, async () => {
    process.env.SAGE_AGENT_MODE = "full";
    delete process.env.SAGE_AGENT_ENABLED;
    let signal: AbortSignal | undefined;
    mockRunAgentTurn.mock.mockImplementation(async function* (options: { signal?: AbortSignal }) {
      signal = options.signal;
      await new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      yield { type: "text", text: "never" };
    });
    const res = await post(NORMAL_MESSAGE);
    const reader = res.body!.getReader();
    await reader.read();
    await until(() => signal !== undefined, "the agent turn started");
    await reader.cancel();
    await until(() => signal?.aborted === true, "the agent turn's signal aborted");
    await until(() => auditStatuses().some((a) => a.status === "failed"), "the stopped turn was finished");
  });

  it("a Stop while the context is still loading never calls the model", BOUND, async () => {
    const { provider, seen } = hangingProvider();
    mockResolveAiProvider.mock.mockImplementation(async () => provider);
    const assembly = gate();
    mockAssembleStudentContextBundle.mock.mockImplementation(async () => {
      await assembly.wait;
      return {
        chatPromptContext: { priorConversationContext: "", goalsByLevel: {}, goalsSummary: "" },
        meta: { selfMetrics: undefined },
      };
    });
    const res = await post(CRISIS_MESSAGE);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    assembly.open();
    await until(() => auditStatuses().some((a) => a.status === "failed"), "the stopped turn was finished");
    assert.equal(seen.calls, 0, "no model call after the student left");
    assert.match(assistantSaves()[0] ?? "", /988/);
  });
});
