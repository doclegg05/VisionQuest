import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { mockAdminSession, mockTeacherSession, mockRequest } from "@/lib/test-helpers";
import {
  session,
  setSession,
  mockResolveAiProvider,
  mockLogger,
  mockGetOrCreateConversation,
  mockGetConversationContext,
  mockSaveMessage,
  mockMessageFindFirst,
  mockRunAgentTurn,
  mockAssembleStudentContextBundle,
  mockRecordWellbeingConcern,
  readSseBody,
  route,
  resetMocks,
} from "./route-harness";

describe("POST /api/chat/send — honest failure causes (E1)", () => {
  // The route decides why Sage could not answer and sends it as `failure`.
  // The client never parses the text for the cause.
  const previousAgentFlag = process.env.SAGE_AGENT_ENABLED;
  const previousAgentMode = process.env.SAGE_AGENT_MODE;
  let sageFailure: typeof import("@/lib/chat/sage-failure");

  before(async () => {
    sageFailure = await import("@/lib/chat/sage-failure");
  });

  function useAgentLoop(mode: "off" | "readonly") {
    if (mode === "off") {
      process.env.SAGE_AGENT_ENABLED = "false";
      delete process.env.SAGE_AGENT_MODE;
    } else {
      process.env.SAGE_AGENT_MODE = mode;
      delete process.env.SAGE_AGENT_ENABLED;
    }
  }

  beforeEach(() => {
    resetMocks();
    useAgentLoop("off");
  });
  after(() => {
    if (previousAgentFlag === undefined) delete process.env.SAGE_AGENT_ENABLED;
    else process.env.SAGE_AGENT_ENABLED = previousAgentFlag;
    if (previousAgentMode === undefined) delete process.env.SAGE_AGENT_MODE;
    else process.env.SAGE_AGENT_MODE = previousAgentMode;
  });

  const NORMAL_MESSAGE = "How do I finish my OSHA 10 certification?";
  const CRISIS_MESSAGE = "I just want to end it all";
  const EN_BLOCK = /call or text 988/;

  function post(message: string) {
    const req = mockRequest("/api/chat/send", { method: "POST", body: { message } });
    return route.POST(req as never, { params: Promise.resolve({}) } as never);
  }

  function failingProvider(error: Error) {
    return {
      name: "ollama",
      async generateResponse(): Promise<string> {
        throw error;
      },
      async *streamResponse(): AsyncGenerator<string> {
        throw error;
      },
      async *streamWithTools(): AsyncGenerator<never> {
        throw error;
      },
      async generateStructuredResponse() {
        return "{}";
      },
    };
  }

  /** The SSE error event's JSON, or a failed assertion. */
  type ErrorEvent = { error: string; failure?: unknown; crisisBlock?: string; userMessageId?: string };
  function errorEvent(body: string): ErrorEvent {
    const line = body
      .split("\n")
      .find((l) => l.startsWith("data: ") && l.includes('"error"'));
    assert.ok(line, `expected an SSE error event in: ${body}`);
    return JSON.parse(line!.slice("data: ".length)) as ErrorEvent;
  }

  function userMessageSaved(): boolean {
    return mockSaveMessage.mock.calls.some((call) => call.arguments[2] === "user");
  }

  describe("before the stream opens (provider setup)", () => {
    const setupCases: Array<[string, string, "off" | "not_set_up" | "unknown"]> = [
      ["no model configured", "Local AI server URL is not configured. Set it in Program Setup > AI Provider.", "not_set_up"],
      ["the server cannot be reached", "Local AI server unreachable", "off"],
      ["an unknown failure", "database went away", "unknown"],
    ];

    for (const [label, message, code] of setupCases) {
      it(`${label}: 503 with failure "${code}" and no "not lost" claim`, async () => {
        mockResolveAiProvider.mock.mockImplementation(async () => {
          throw new Error(message);
        });
        const res = await post(NORMAL_MESSAGE);
        assert.equal(res.status, 503);
        const body = (await res.json()) as { error: string; failure?: unknown };
        assert.equal(body.failure, code);
        assert.equal(
          body.error,
          sageFailure.sageFailureMessage(code, { audience: "student", messageSaved: false, canRetry: sageFailure.offersRetry(code) }),
        );
        // The claim is withheld because it would be false: nothing was saved.
        assert.equal(userMessageSaved(), false);
      });
    }

    it("never sends a student API-key instructions", async () => {
      mockResolveAiProvider.mock.mockImplementation(async () => {
        throw new Error("Sage is not configured yet (no API key).");
      });
      const body = (await (await post(NORMAL_MESSAGE)).json()) as { error: string };
      assert.doesNotMatch(body.error, /API|key|Settings/i);
    });

    it("gives staff the staff wording", async () => {
      setSession(mockTeacherSession());
      mockResolveAiProvider.mock.mockImplementation(async () => {
        throw new Error("Local AI server URL is not configured.");
      });
      const body = (await (await post("How is my class doing?")).json()) as { error: string; failure?: unknown };
      assert.equal(body.failure, "not_set_up");
      assert.equal(
        body.error,
        sageFailure.sageFailureMessage("not_set_up", { audience: "staff", messageSaved: false, canRetry: false }),
      );
    });
  });

  describe("after the stream opens", () => {
    const streamCases: Array<[string, Error, "off" | "busy" | "slow" | "unknown"]> = [
      ["the relay has no Mac (502)", new Error("Local AI stream failed (502)"), "off"],
      ["the relay is at capacity (503)", new Error("Local AI stream failed (503)"), "busy"],
      ["no first reply in time", new Error("Local AI did not produce a first content token within 45 seconds."), "slow"],
      ["an unknown failure", new Error("kaboom"), "unknown"],
    ];

    for (const mode of ["off", "readonly"] as const) {
      for (const [label, error, code] of streamCases) {
        it(`agent loop ${mode}: ${label} sends failure "${code}" and says the message was saved`, async () => {
          useAgentLoop(mode);
          // The real agent loop catches the provider error and reports only
          // agent_stop { reason: "error" }; this double does the same.
          mockRunAgentTurn.mock.mockImplementation(async function* (args: { provider: { streamWithTools: () => AsyncGenerator<unknown> } }) {
            try {
              for await (const event of args.provider.streamWithTools()) void event;
            } catch {
              yield { type: "agent_stop", reason: "error", transcript: [], finalText: "" };
            }
          });
          mockResolveAiProvider.mock.mockImplementation(async () => failingProvider(error));

          const event = errorEvent(await readSseBody(await post(NORMAL_MESSAGE)));
          assert.equal(event.failure, code);
          assert.equal(
            event.error,
            sageFailure.sageFailureMessage(code, { audience: "student", messageSaved: true, canRetry: sageFailure.offersRetry(code) }),
          );
          assert.equal(userMessageSaved(), true);
          // Try again points the server at this saved message.
          assert.equal(event.userMessageId, "test-msg-id");
        });
      }
    }
  });

  describe("the 988 block stays on every failure path that had it", () => {
    for (const [label, message] of [
      ["not set up", "Local AI server URL is not configured."],
      ["off", "Local AI server unreachable"],
      ["unknown", "database went away"],
    ] as const) {
      it(`provider setup, ${label}: the error carries the block for a crisis message`, async () => {
        mockResolveAiProvider.mock.mockImplementation(async () => {
          throw new Error(message);
        });
        const body = (await (await post(CRISIS_MESSAGE)).json()) as { error: string };
        assert.match(body.error, EN_BLOCK);
      });
    }

    for (const [label, message] of [
      ["off", "Local AI stream failed (502)"],
      ["busy", "Local AI stream failed (503)"],
      ["slow", "Local AI did not produce a first content token within 45 seconds."],
      ["unknown", "kaboom"],
    ] as const) {
      it(`stream, ${label}: the error event carries the block for a crisis message`, async () => {
        mockResolveAiProvider.mock.mockImplementation(async () => failingProvider(new Error(message)));
        const event = errorEvent(await readSseBody(await post(CRISIS_MESSAGE)));
        assert.match(event.error, EN_BLOCK);
        assert.ok(event.error.startsWith("Sage "), event.error);
        // Named on its own, so the chat can keep it when Try again runs.
        assert.ok(event.crisisBlock && event.error.endsWith(event.crisisBlock));
      });
    }
  });
});

describe("POST /api/chat/send — a throw before the stream opens (E1b)", () => {
  let sageFailure: typeof import("@/lib/chat/sage-failure");
  let ApiErrorClass: typeof import("@/lib/api-error").ApiError;

  before(async () => {
    sageFailure = await import("@/lib/chat/sage-failure");
    ApiErrorClass = (await import("@/lib/api-error")).ApiError;
  });
  beforeEach(() => {
    resetMocks();
  });

  const CRISIS_MESSAGE = "I just want to end it all";

  function post(message: string) {
    const req = mockRequest("/api/chat/send", { method: "POST", body: { message } });
    return route.POST(req as never, { params: Promise.resolve({}) } as never);
  }

  type FailureBody = { error: string; failure?: string; crisisBlock?: string; userMessageId?: string };

  /**
   * E7 moved context assembly (the bundle, RAG, memory, history) after the
   * stream's first event, so a throw there now arrives as the stream's error
   * event, with the same sentence, code and 988 block it had as a 500 body.
   */
  async function streamFailure(res: Response): Promise<FailureBody> {
    assert.equal(res.status, 200);
    const body = await readSseBody(res);
    const line = body.split("\n").find((l) => l.startsWith("data: ") && l.includes('"failure"'));
    assert.ok(line, body);
    return JSON.parse(line!.slice("data: ".length)) as FailureBody;
  }

  it("a throw after the message was saved answers with the fixed unknown sentence and the saved id", async () => {
    mockAssembleStudentContextBundle.mock.mockImplementation(async () => {
      throw new Error("prisma: connection to the database was lost");
    });
    const body = await streamFailure(await post("How do I finish my OSHA 10 certification?"));
    assert.equal(body.failure, "unknown");
    assert.equal(
      body.error,
      sageFailure.sageFailureMessage("unknown", { audience: "student", messageSaved: true, canRetry: true }),
    );
    assert.equal(body.userMessageId, "test-msg-id");
    assert.equal(body.crisisBlock, undefined);
  });

  it("a throw before the message was saved makes no 'not lost' claim", async () => {
    mockGetOrCreateConversation.mock.mockImplementation(async () => {
      throw new Error("prisma: connection to the database was lost");
    });
    const body = (await (await post("How do I finish my OSHA 10 certification?")).json()) as FailureBody;
    assert.equal(
      body.error,
      sageFailure.sageFailureMessage("unknown", { audience: "student", messageSaved: false, canRetry: true }),
    );
    assert.equal(body.userMessageId, undefined);
  });

  it("carries the 988 block, and names it, for a crisis message", async () => {
    mockAssembleStudentContextBundle.mock.mockImplementation(async () => {
      throw new Error("boom");
    });
    const body = await streamFailure(await post(CRISIS_MESSAGE));
    assert.match(body.error, /call or text 988/);
    assert.ok(body.crisisBlock && body.error.endsWith(body.crisisBlock));
  });

  it("logs the failure without its text or the student's id", async () => {
    mockAssembleStudentContextBundle.mock.mockImplementation(async () => {
      throw new Error("prisma: secret detail");
    });
    await readSseBody(await post("How do I finish my OSHA 10 certification?"));
    const logged = JSON.stringify(mockLogger.error.mock.calls.map((call: { arguments: unknown[] }) => call.arguments));
    assert.match(logged, /assembly failed before the model call/);
    assert.doesNotMatch(logged, /secret detail/);
    assert.doesNotMatch(logged, new RegExp(session.id));
  });

  it("leaves a request error (4xx) as it was", async () => {
    mockGetOrCreateConversation.mock.mockImplementation(async () => {
      throw new ApiErrorClass(404, "Conversation not found.");
    });
    const res = await post("How do I finish my OSHA 10 certification?");
    assert.equal(res.status, 404);
  });
});

describe("POST /api/chat/send — Try again reuses the saved message (E1b)", () => {
  beforeEach(() => {
    resetMocks();
  });

  const CONVERSATION_ID = "cconversation00000000001";
  const RETRY_OF = "cmessage0000000000000001";
  const MESSAGE = "I just want to end it all";

  function post(body: Record<string, unknown>) {
    const req = mockRequest("/api/chat/send", { method: "POST", body: { message: MESSAGE, ...body } });
    return route.POST(req as never, { params: Promise.resolve({}) } as never);
  }

  function userSaves(): number {
    return mockSaveMessage.mock.calls.filter((call: { arguments: unknown[] }) => call.arguments[2] === "user").length;
  }

  function firstEvent(body: string): Record<string, unknown> {
    const line = body.split("\n").find((l) => l.startsWith("data: "));
    assert.ok(line, body);
    return JSON.parse(line!.slice("data: ".length)) as Record<string, unknown>;
  }

  /** The stored message is this student's, in this conversation, and the latest question. */
  function storedMessageIsRetryable() {
    mockGetOrCreateConversation.mock.mockImplementation(async () => ({
      id: CONVERSATION_ID,
      title: "t",
      stage: "general",
      messages: [],
    }));
    mockMessageFindFirst.mock.mockImplementation(async (args: { where: { role: string } }) =>
      args.where.role === "assistant" ? null : { id: RETRY_OF, conversationId: CONVERSATION_ID, createdAt: new Date(0) },
    );
  }

  it("does not save the message again, still scans it, and still adds the 988 block", async () => {
    storedMessageIsRetryable();
    const res = await post({ conversationId: CONVERSATION_ID, retryOf: RETRY_OF });
    const body = await readSseBody(res);
    assert.equal(userSaves(), 0);
    // E1c 3: the first send's alert may have failed; the scan dedupes by day.
    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1, "a retried crisis message runs the scan");
    assert.match(body, /988/);
    assert.equal(firstEvent(body).userMessageId, RETRY_OF);
  });

  it("looks the message up by this student, this conversation, this text and the user role", async () => {
    storedMessageIsRetryable();
    await readSseBody(await post({ conversationId: CONVERSATION_ID, retryOf: RETRY_OF }));
    const where = mockMessageFindFirst.mock.calls[0].arguments[0].where;
    assert.deepEqual(where, {
      id: RETRY_OF,
      studentId: session.id,
      conversationId: CONVERSATION_ID,
      role: "user",
      content: MESSAGE,
    });
  });

  it("saves and scans as usual when the id is not this student's message", async () => {
    const body = await readSseBody(await post({ conversationId: CONVERSATION_ID, retryOf: RETRY_OF }));
    assert.equal(userSaves(), 1);
    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1);
    assert.equal(firstEvent(body).userMessageId, "test-msg-id");
  });

  it("saves as usual when a later question came after the stored one", async () => {
    storedMessageIsRetryable();
    let call = 0;
    mockMessageFindFirst.mock.mockImplementation(async () =>
      ++call === 1 ? { id: RETRY_OF, conversationId: CONVERSATION_ID, createdAt: new Date(0) } : { id: "clater000000000000000001" },
    );
    await readSseBody(await post({ conversationId: CONVERSATION_ID, retryOf: RETRY_OF }));
    assert.equal(userSaves(), 1);
  });

  it("saves as usual when the lookup fails, and logs it", async () => {
    mockMessageFindFirst.mock.mockImplementation(async () => {
      throw new Error("db down");
    });
    await readSseBody(await post({ conversationId: CONVERSATION_ID, retryOf: RETRY_OF }));
    assert.equal(userSaves(), 1);
    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1);
    const logged = JSON.stringify(mockLogger.warn.mock.calls.map((c: { arguments: unknown[] }) => c.arguments));
    assert.match(logged, /retry/i);
  });

  it("refuses a retryOf that is not an id", async () => {
    const res = await post({ conversationId: CONVERSATION_ID, retryOf: "not an id" });
    assert.equal(res.status, 400);
  });

  it("a first send reports the saved message's id on its first event", async () => {
    const body = await readSseBody(await post({}));
    assert.equal(firstEvent(body).userMessageId, "test-msg-id");
    assert.equal(userSaves(), 1);
  });
});

describe("POST /api/chat/send — round 3 failure fixes (E1c)", () => {
  let sageFailure: typeof import("@/lib/chat/sage-failure");
  const previousAgentFlag = process.env.SAGE_AGENT_ENABLED;

  before(async () => {
    sageFailure = await import("@/lib/chat/sage-failure");
  });
  beforeEach(() => {
    resetMocks();
    process.env.SAGE_AGENT_ENABLED = "false";
  });
  after(() => {
    if (previousAgentFlag === undefined) delete process.env.SAGE_AGENT_ENABLED;
    else process.env.SAGE_AGENT_ENABLED = previousAgentFlag;
  });

  const CONVERSATION_ID = "cconversation00000000002";
  const SAVED_ID = "cmessage0000000000000002";
  const QUESTION = "How do I finish my OSHA 10 certification?";

  function post(body: Record<string, unknown>) {
    const req = mockRequest("/api/chat/send", { method: "POST", body: { message: QUESTION, ...body } });
    return route.POST(req as never, { params: Promise.resolve({}) } as never);
  }

  function userSaves(): number {
    return mockSaveMessage.mock.calls.filter((call: { arguments: unknown[] }) => call.arguments[2] === "user").length;
  }

  function newConversationSavesAs(id: string) {
    mockGetOrCreateConversation.mock.mockImplementation(async () => ({ id: CONVERSATION_ID, title: "t", stage: "general", messages: [] }));
    mockSaveMessage.mock.mockImplementation(async () => ({ id }));
  }

  type ReplyWhere = { role: string; NOT?: { OR?: Array<{ content?: { contains?: string } }> } };

  /**
   * findFirst answers: the stored question, then (role assistant) the newest of
   * the replies after it, oldest first, that passes the query's `NOT` filter.
   */
  function storedQuestion(after: { content: string } | null, ...later: Array<{ content: string }>) {
    newConversationSavesAs("cnewmessage0000000000001");
    const replies = [after, ...later].filter((r): r is { content: string } => r !== null);
    mockMessageFindFirst.mock.mockImplementation(async (args: { where: ReplyWhere }) => {
      if (args.where.role !== "assistant") {
        return { id: SAVED_ID, conversationId: CONVERSATION_ID, createdAt: new Date(0) };
      }
      const excluded = (args.where.NOT?.OR ?? []).flatMap((clause) => clause.content?.contains ?? []);
      const kept = replies.filter((r) => !excluded.some((mark) => r.content.includes(mark)));
      return kept.at(-1) ?? null;
    });
  }

  describe("(2) a throw after the save names the conversation, so Try again stays in it", () => {
    it("the error body carries the new conversation's id", async () => {
      newConversationSavesAs(SAVED_ID);
      mockAssembleStudentContextBundle.mock.mockImplementation(async () => {
        throw new Error("boom");
      });
      // A stream error event since E7 (context assembly runs inside the stream).
      const sse = await readSseBody(await post({}));
      const line = sse.split("\n").find((l) => l.startsWith("data: ") && l.includes('"failure"'));
      assert.ok(line, sse);
      const body = JSON.parse(line!.slice(6)) as { conversationId?: string; userMessageId?: string };
      assert.equal(body.conversationId, CONVERSATION_ID);
      assert.equal(body.userMessageId, SAVED_ID);
    });

    it("a retry with that id reuses the saved message in the same conversation and saves nothing new", async () => {
      newConversationSavesAs(SAVED_ID);
      storedQuestion(null);
      await readSseBody(await post({ conversationId: CONVERSATION_ID, retryOf: SAVED_ID }));
      assert.equal(userSaves(), 0);
      assert.equal(mockGetOrCreateConversation.mock.calls[0].arguments[1], CONVERSATION_ID);
    });

    it("the stream's error event carries the conversation's id too", async () => {
      newConversationSavesAs(SAVED_ID);
      mockResolveAiProvider.mock.mockImplementation(async () => ({
        ...makeThrowingStream(),
      }));
      const body = await readSseBody(await post({}));
      const line = body.split("\n").find((l) => l.startsWith("data: ") && l.includes('"failure"'));
      assert.ok(line, body);
      assert.equal(JSON.parse(line!.slice(6)).conversationId, CONVERSATION_ID);
    });
  });

  describe("(4) a Try again whose question was already answered is refused", () => {
    it("answers 409 with plain words, and calls no model and saves nothing", async () => {
      storedQuestion({ content: "Here is the whole answer." });
      const res = await post({ conversationId: CONVERSATION_ID, retryOf: SAVED_ID });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, "Sage already sent the answer. It is above.");
      assert.equal(mockResolveAiProvider.mock.callCount(), 0);
      assert.equal(mockSaveMessage.mock.callCount(), 0);
    });

    it("still answers a Try again after a cut-off reply, which is not an answer", async () => {
      storedQuestion({ content: sageFailure.savedCutOffReply("Part one", "slow", "student") });
      const res = await post({ conversationId: CONVERSATION_ID, retryOf: SAVED_ID });
      assert.equal(res.status, 200);
      await readSseBody(res);
      assert.equal(userSaves(), 0);
    });

    it("still answers a Try again after a partial saved with the old note, before E2b (E2b 6)", async () => {
      storedQuestion({ content: "Part one\n\n(Sage got cut off here.)" });
      const res = await post({ conversationId: CONVERSATION_ID, retryOf: SAVED_ID });
      assert.equal(res.status, 200);
      await readSseBody(res);
    });

    it("refuses when a full answer was saved and a cut-off copy came after it", async () => {
      const full = "Here is the whole answer.";
      storedQuestion({ content: full }, { content: sageFailure.savedCutOffReply(full, "unknown", "student") });
      const res = await post({ conversationId: CONVERSATION_ID, retryOf: SAVED_ID });
      assert.equal(res.status, 409);
      assert.equal(mockResolveAiProvider.mock.callCount(), 0);
    });

    it("still runs the crisis scan on a refused Try again", async () => {
      storedQuestion({ content: "Here is the whole answer." });
      const req = mockRequest("/api/chat/send", {
        method: "POST",
        body: { message: "I want to kill myself", conversationId: CONVERSATION_ID, retryOf: SAVED_ID },
      });
      const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);
      assert.equal(res.status, 409);
      assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1);
    });

    it("looks only after the stored question, in its conversation", async () => {
      storedQuestion(null);
      await readSseBody(await post({ conversationId: CONVERSATION_ID, retryOf: SAVED_ID }));
      const answered = mockMessageFindFirst.mock.calls.find(
        (call: { arguments: Array<{ where: { role: string } }> }) => call.arguments[0].where.role === "assistant",
      );
      assert.ok(answered, "an answered check ran");
      const where = answered!.arguments[0].where as Record<string, unknown>;
      assert.equal(where.conversationId, CONVERSATION_ID);
      assert.deepEqual(where.createdAt, { gt: new Date(0) });
    });
  });

  it("(5) after a saved partial, the model reads the question, the partial, then the question again", async () => {
    const partial = sageFailure.savedCutOffReply("Part one", "slow", "student");
    storedQuestion({ content: partial });
    mockGetConversationContext.mock.mockImplementation(async () => ({
      messages: [
        { role: "user", content: QUESTION },
        { role: "assistant", content: partial },
      ],
    }));
    const seen: Array<Array<{ role: string; content: string }>> = [];
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "ollama",
      async generateResponse() {
        return "ok";
      },
      async *streamResponse(_system: string, messages: Array<{ role: string; content: string }>) {
        seen.push(messages);
        yield "Full answer.";
      },
      async generateStructuredResponse() {
        return "{}";
      },
    }));
    await readSseBody(await post({ conversationId: CONVERSATION_ID, retryOf: SAVED_ID }));
    assert.deepEqual(
      seen[0].map((m) => [m.role, m.content]),
      [
        ["user", QUESTION],
        ["assistant", partial],
        ["user", QUESTION],
      ],
    );
  });

  it("(7b) saves a cut-off reply with no Try again wording, since a reload shows no button", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => makeThrowingStream(["Part one"]));
    await readSseBody(await post({}));
    const saved = mockSaveMessage.mock.calls.find((call: { arguments: unknown[] }) => call.arguments[2] === "assistant");
    assert.ok(saved, "the partial was saved");
    assert.equal(saved!.arguments[3], "Part one\n\n(Sage stopped here.)");
  });

  it("(12) tells an admin to check Program Setup when Sage is not set up", async () => {
    setSession(mockAdminSession());
    mockResolveAiProvider.mock.mockImplementation(async () => {
      throw new Error("Local AI server URL is not configured.");
    });
    const body = (await (await post({ message: "How is my class doing?" })).json()) as { error: string };
    assert.equal(body.error, "Sage is not set up yet. Check the Sage connection settings in Program Setup.");
  });
});

/** A provider whose stream sends `chunks`, then throws an unknown error. */
function makeThrowingStream(chunks: string[] = []) {
  return {
    name: "ollama",
    async generateResponse(): Promise<string> {
      throw new Error("kaboom");
    },
    async *streamResponse(): AsyncGenerator<string> {
      for (const chunk of chunks) yield chunk;
      throw new Error("kaboom");
    },
    async generateStructuredResponse() {
      return "{}";
    },
  };
}
