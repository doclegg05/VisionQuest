/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockTeacherSession, mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Request-level tests for POST /api/chat/send.
//
// The route is wrapped in `withRegistry("sage.chat", ...)`. We mock the
// registry middleware as a passthrough that just hands a session to the
// inner handler, then mock every external dependency the handler reaches
// for: prisma, AI provider, rate limiter, conversation helpers, etc.
//
// PR-IN-FLIGHT NOTES (assertions tied to current code at 1bd69eb):
//   * #41 (SSE error generic) — does not currently affect these tests.
//   * #45 (Ollama rate limit) — the rate-limit test asserts CURRENT
//     behavior: rate limits ONLY apply when the provider is cloud.
//     When #45 merges, the test for rate-limited-with-cloud-provider
//     stays valid, but a future test could assert local-provider also
//     enforces limits.
// ---------------------------------------------------------------------------

let session = mockStudentSession();
let toolCapturedBy_withRegistry: string | null = null;

const mockRateLimit = mock.fn() as any;
const mockRateLimitDaily = mock.fn() as any;
const mockResolveAiProvider = mock.fn() as any;
const mockGetPromptTier = mock.fn() as any;
const mockGetProviderClass = mock.fn() as any;
const mockLogAiAuditEvent = mock.fn() as any;
const mockPolicyDecisionForProvider = mock.fn() as any;
const mockLogger = {
  error: mock.fn() as any,
  warn: mock.fn() as any,
  info: mock.fn() as any,
};
const mockBuildSystemPrompt = mock.fn() as any;
const mockGetDocumentContext = mock.fn() as any;
const mockGetDirectFormAnswer = mock.fn() as any;
const mockResolveDirectFormMatch = mock.fn() as any;
const mockGetFormContext = mock.fn() as any;
const mockRecordChatSession = mock.fn() as any;
const mockAwardEvent = mock.fn() as any;
const mockGetOrCreateConversation = mock.fn() as any;
const mockGetOrCreateTeacherConversation = mock.fn() as any;
const mockSaveMessage = mock.fn() as any;
const mockGetConversationContext = mock.fn() as any;
const mockMaybeUpdateSummary = mock.fn() as any;
const mockHandlePostResponse = mock.fn() as any;
const mockGetStudentPromptContext = mock.fn() as any;
const mockBuildStaffStudentContext = mock.fn() as any;
const mockShouldAttemptStaffStudentContext = mock.fn() as any;
const mockCheckTokenQuota = mock.fn() as any;
const mockWithUsageLogging = mock.fn() as any;
const mockGetStudentProgramType = mock.fn() as any;
const mockPrismaStudentFindUnique = mock.fn() as any;
const mockFormatClustersForPrompt = mock.fn() as any;
const mockRunAgentTurn = mock.fn() as any;
const mockExecuteSlashCommand = mock.fn() as any;
const mockExecuteAgentTool = mock.fn() as any;
const mockAssembleStudentContextBundle = mock.fn() as any;
const mockSelfMetricLineFromBundle = mock.fn() as any;
const mockGetSituationalSnapshot = mock.fn() as any;

// ---------------------------------------------------------------------------
// withRegistry passthrough — mirrors the withTeacherAuth pattern in
// class-route-auth.test.ts. Calls the handler directly with the test
// session unless mockGetSessionReturnsNull flips, which simulates the
// 401 path for auth-guard test.
// ---------------------------------------------------------------------------
let getSessionReturnsNull = false;

// withRegistry passthrough — wraps the inner handler with auth + error
// adaptation so parseBody's thrown ApiError surfaces as a 400 response.
mock.module("@/lib/registry/middleware", {
  namedExports: {
    withRegistry:
      (toolId: string, handler: (s: typeof session, req: any, ctx: any, tool: any) => Promise<Response>) =>
      async (req: any, ctx: any) => {
        toolCapturedBy_withRegistry = toolId;
        if (getSessionReturnsNull) {
          return Response.json(
            { error: "Unauthorized", code: "UNAUTHORIZED" },
            { status: 401 },
          );
        }
        const tool = { id: toolId, name: "Sage Chat" };
        try {
          return await handler(session, req, ctx, tool);
        } catch (err) {
          if (err && typeof err === "object" && "statusCode" in err) {
            const statusCode = Number((err as { statusCode: number }).statusCode);
            const message = err instanceof Error ? err.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw err;
        }
      },
    withRegistryPublic: () => async () => Response.json({ error: "n/a" }, { status: 404 }),
  },
});

mock.module("@/lib/api-error", {
  namedExports: {
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
    badRequest: (msg: string) => {
      const e = new Error(msg) as Error & { statusCode: number };
      e.statusCode = 400;
      e.name = "ApiError";
      return e;
    },
    ApiError: class ApiError extends Error {
      statusCode: number;
      code: string;
      constructor(statusCode: number, message: string, code = "ERR") {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = "ApiError";
      }
    },
    rlsContextFor: () => ({ userId: "stu-test-001", role: "student", studentId: "stu-test-001" }),
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: mockRateLimit,
    rateLimitDaily: mockRateLimitDaily,
  },
});

mock.module("@/lib/ai", {
  namedExports: {
    resolveAiProvider: mockResolveAiProvider,
    getPromptTier: mockGetPromptTier,
  },
});

mock.module("@/lib/ai/audit", {
  namedExports: {
    getProviderClass: mockGetProviderClass,
    logAiAuditEvent: mockLogAiAuditEvent,
    policyDecisionForProvider: mockPolicyDecisionForProvider,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: mockLogger,
  },
});

mock.module("@/lib/sage/system-prompts", {
  namedExports: {
    buildSystemPrompt: mockBuildSystemPrompt,
    // ConversationStage is a type-only export — not needed at runtime.
  },
});

mock.module("@/lib/sage/knowledge-base-server", {
  namedExports: {
    getDocumentContext: mockGetDocumentContext,
  },
});

const mockFindRelevantForms = mock.fn() as any;

mock.module("@/lib/sage/knowledge-base", {
  namedExports: {
    getDirectFormAnswer: mockGetDirectFormAnswer,
    resolveDirectFormMatch: mockResolveDirectFormMatch,
    getFormContext: mockGetFormContext,
    findRelevantForms: mockFindRelevantForms,
  },
});

mock.module("@/lib/progression/engine", {
  namedExports: {
    recordChatSession: mockRecordChatSession,
  },
});

mock.module("@/lib/progression/events", {
  namedExports: {
    awardEvent: mockAwardEvent,
  },
});

mock.module("@/lib/chat/conversation", {
  namedExports: {
    getOrCreateConversation: mockGetOrCreateConversation,
    getOrCreateTeacherConversation: mockGetOrCreateTeacherConversation,
    saveMessage: mockSaveMessage,
    getConversationContext: mockGetConversationContext,
    maybeUpdateSummary: mockMaybeUpdateSummary,
  },
});

mock.module("@/lib/chat/post-response", {
  namedExports: {
    handlePostResponse: mockHandlePostResponse,
  },
});

mock.module("@/lib/chat/context", {
  namedExports: {
    getStudentPromptContext: mockGetStudentPromptContext,
  },
});

mock.module("@/lib/sage/context-bundle", {
  namedExports: {
    assembleStudentContextBundle: mockAssembleStudentContextBundle,
    selfMetricLineFromBundle: mockSelfMetricLineFromBundle,
  },
});

mock.module("@/lib/sage/situational-snapshot", {
  namedExports: {
    getSituationalSnapshot: mockGetSituationalSnapshot,
  },
});

mock.module("@/lib/sage/staff-student-context", {
  namedExports: {
    buildStaffStudentContext: mockBuildStaffStudentContext,
    shouldAttemptStaffStudentContext: mockShouldAttemptStaffStudentContext,
  },
});

mock.module("@/lib/spokes/career-clusters", {
  namedExports: {
    formatClustersForPrompt: mockFormatClustersForPrompt,
  },
});

mock.module("@/lib/llm-usage", {
  namedExports: {
    checkTokenQuota: mockCheckTokenQuota,
    withUsageLogging: mockWithUsageLogging,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: {
        findUnique: mockPrismaStudentFindUnique,
      },
    },
    prismaAdmin: {
      student: {
        findUnique: mockPrismaStudentFindUnique,
      },
    },
  },
});

mock.module("@/lib/program-type-server", {
  namedExports: {
    getStudentProgramType: mockGetStudentProgramType,
  },
});

mock.module("@/lib/sage/agent/loop", {
  namedExports: {
    runAgentTurn: mockRunAgentTurn,
  },
});

mock.module("@/lib/sage/agent/executor", {
  namedExports: {
    executeSlashCommand: mockExecuteSlashCommand,
    executeAgentTool: mockExecuteAgentTool,
  },
});

// chat/sse uses pure functions; let it run for real so SSE format is real.
// program-type is types only — no need to mock.

// ---------------------------------------------------------------------------
// Provider double — the route iterates `provider.streamResponse(...)`.
// Build a tiny generator that yields a few chunks then completes.
// ---------------------------------------------------------------------------
function makeFakeProvider(name = "ollama", chunks: string[] = ["Hello, ", "world!"]) {
  return {
    name,
    async generateResponse() {
      return chunks.join("");
    },
    async *streamResponse() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
    async generateStructuredResponse() {
      return "{}";
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers: read the entire SSE response body as a string for assertions.
// ---------------------------------------------------------------------------
async function readSseBody(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

// ---------------------------------------------------------------------------
// Late import — must come after all mock.module calls.
// ---------------------------------------------------------------------------
let route: Awaited<typeof import("../route")>;

before(async () => {
  route = await import("../route");
});

// ---------------------------------------------------------------------------
// Default mock state used by most happy-path tests. Reset in beforeEach.
// ---------------------------------------------------------------------------
function resetMocks() {
  for (const m of [
    mockRateLimit,
    mockRateLimitDaily,
    mockResolveAiProvider,
    mockGetPromptTier,
    mockGetProviderClass,
    mockLogAiAuditEvent,
    mockPolicyDecisionForProvider,
    mockBuildSystemPrompt,
    mockGetDocumentContext,
    mockGetDirectFormAnswer,
    mockResolveDirectFormMatch,
    mockFindRelevantForms,
    mockGetFormContext,
    mockRecordChatSession,
    mockAwardEvent,
    mockGetOrCreateConversation,
    mockGetOrCreateTeacherConversation,
    mockSaveMessage,
    mockGetConversationContext,
    mockMaybeUpdateSummary,
    mockHandlePostResponse,
    mockGetStudentPromptContext,
    mockAssembleStudentContextBundle,
    mockSelfMetricLineFromBundle,
    mockGetSituationalSnapshot,
    mockBuildStaffStudentContext,
    mockShouldAttemptStaffStudentContext,
    mockCheckTokenQuota,
    mockWithUsageLogging,
    mockGetStudentProgramType,
    mockPrismaStudentFindUnique,
    mockFormatClustersForPrompt,
    mockRunAgentTurn,
    mockExecuteSlashCommand,
    mockExecuteAgentTool,
    mockLogger.error,
    mockLogger.warn,
    mockLogger.info,
  ]) {
    m.mock.resetCalls();
  }

  session = mockStudentSession();
  getSessionReturnsNull = false;
  toolCapturedBy_withRegistry = null;

  mockGetDirectFormAnswer.mock.mockImplementation(() => null);
  mockResolveDirectFormMatch.mock.mockImplementation(() => null);
  mockFindRelevantForms.mock.mockImplementation(() => []);
  mockGetFormContext.mock.mockImplementation(() => "");
  mockGetDocumentContext.mock.mockImplementation(async () => "");
  mockResolveAiProvider.mock.mockImplementation(async () => makeFakeProvider("ollama"));
  mockGetPromptTier.mock.mockImplementation(() => "compact");
  mockGetProviderClass.mock.mockImplementation(() => "local");
  mockLogAiAuditEvent.mock.mockImplementation(async () => undefined);
  mockPolicyDecisionForProvider.mock.mockImplementation((name?: string | null) =>
    name === "ollama" ? "local_only" : "configured_provider",
  );
  mockBuildSystemPrompt.mock.mockImplementation(() => "SYSTEM PROMPT");
  mockCheckTokenQuota.mock.mockImplementation(async () => ({ allowed: true, warning: null }));
  mockWithUsageLogging.mock.mockImplementation((provider: unknown) => provider);
  mockRateLimit.mock.mockImplementation(async () => ({ success: true, remaining: 100, resetTime: Date.now() + 3600_000 }));
  mockRateLimitDaily.mock.mockImplementation(async () => ({ success: true, remaining: 200, resetTime: Date.now() + 3600_000 }));
  mockGetOrCreateConversation.mock.mockImplementation(async () => ({
    id: "conv-1",
    title: "test",
    stage: "general",
    messages: [],
  }));
  mockGetOrCreateTeacherConversation.mock.mockImplementation(async () => ({
    id: "conv-tch-1",
    title: "test",
    stage: "general",
    messages: [],
  }));
  mockSaveMessage.mock.mockImplementation(async () => ({ id: "test-msg-id" }));
  mockGetConversationContext.mock.mockImplementation(async () => ({ messages: [] }));
  mockMaybeUpdateSummary.mock.mockImplementation(async () => undefined);
  mockHandlePostResponse.mock.mockImplementation(async () => undefined);
  mockGetStudentPromptContext.mock.mockImplementation(async () => ({
    priorConversationContext: "",
    goalsByLevel: {},
    goalsSummary: "",
    studentStatusSummary: undefined,
    discoverySummary: undefined,
    careerDiscovery: null,
    skillGapContext: undefined,
    pathwayContext: undefined,
    coachingArcContext: undefined,
    careerProfileContext: undefined,
  }));
  mockAssembleStudentContextBundle.mock.mockImplementation(async () => ({
    chatPromptContext: {
      priorConversationContext: "",
      goalsByLevel: {},
      goalsSummary: "",
      studentStatusSummary: undefined,
      discoverySummary: undefined,
      careerDiscovery: null,
      skillGapContext: undefined,
      pathwayContext: undefined,
      coachingArcContext: undefined,
      careerProfileContext: undefined,
      careerThreadContext: undefined,
    },
    meta: { selfMetrics: undefined },
  }));
  mockSelfMetricLineFromBundle.mock.mockImplementation(() => "");
  mockGetSituationalSnapshot.mock.mockImplementation(async () => null);
  mockBuildStaffStudentContext.mock.mockImplementation(async () => ({
    context: null,
    targetStudentId: null,
    resolution: "none",
  }));
  mockShouldAttemptStaffStudentContext.mock.mockImplementation(() => false);
  mockGetStudentProgramType.mock.mockImplementation(async () => null);
  mockPrismaStudentFindUnique.mock.mockImplementation(async () => ({ classroomConfirmedAt: null }));
  mockAwardEvent.mock.mockImplementation(async () => undefined);
  mockFormatClustersForPrompt.mock.mockImplementation(() => "");
  mockRunAgentTurn.mock.mockImplementation(async function* () {
    /* default: no events */
  });
  mockExecuteSlashCommand.mock.mockImplementation(async () => null);
  mockExecuteAgentTool.mock.mockImplementation(async () => ({
    callId: "call-form-1",
    tool: "present_form",
    args: { query: "student-profile" },
    result: {
      status: "success",
      summary: 'Found "SPOKES Student Profile".',
      data: { formId: "student-profile", title: "SPOKES Student Profile" },
      action: {
        action: "open_form",
        target: "/api/forms/download?formId=student-profile&mode=view",
        label: "Open SPOKES Student Profile",
      },
    },
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe("POST /api/chat/send — auth guard", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns 401 when withRegistry reports no session (unauthenticated)", async () => {
    getSessionReturnsNull = true;

    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "hi" },
    });

    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);

    assert.equal(res.status, 401);
    // The inner handler must NOT have run any provider/conversation work.
    assert.equal(mockResolveAiProvider.mock.callCount(), 0);
    assert.equal(mockSaveMessage.mock.callCount(), 0);
  });
});

describe("POST /api/chat/send — input validation", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns 400 when message is an empty string", async () => {
    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "" },
    });

    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);
    assert.equal(res.status, 400);
    // Provider must not be invoked when validation fails.
    assert.equal(mockResolveAiProvider.mock.callCount(), 0);
  });

  it("returns 400 when message field is missing", async () => {
    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: {},
    });

    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);
    assert.equal(res.status, 400);
    assert.equal(mockResolveAiProvider.mock.callCount(), 0);
  });

  it("returns 400 when message is the wrong type (number)", async () => {
    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: 123 },
    });

    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);
    assert.equal(res.status, 400);
    assert.equal(mockResolveAiProvider.mock.callCount(), 0);
  });
});

describe("POST /api/chat/send — rate limiting", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns 429 when the cloud provider is rate-limited (hourly cap reached)", async () => {
    // Force cloud provider so the rate-limit branch executes (current
    // behavior at 1bd69eb — PR #45 will extend to local providers too).
    mockResolveAiProvider.mock.mockImplementation(async () => makeFakeProvider("gemini"));
    mockRateLimit.mock.mockImplementation(async () => ({
      success: false,
      remaining: 0,
      resetTime: Date.now() + 3600_000,
    }));

    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "Hello, can you help me?" },
    });

    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);
    assert.equal(res.status, 429);
    // Conversation save should not happen on rate-limit reject.
    assert.equal(mockSaveMessage.mock.callCount(), 0);
  });
});

describe("POST /api/chat/send — SSE happy path", () => {
  // This suite drives the classic streamResponse() path; the agent default
  // flipped to on (Phase 3), so pin it off explicitly.
  const previousAgentFlag = process.env.SAGE_AGENT_ENABLED;
  const previousAgentMode = process.env.SAGE_AGENT_MODE;
  before(() => {
    process.env.SAGE_AGENT_ENABLED = "false";
    delete process.env.SAGE_AGENT_MODE;
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

  it("returns a 200 SSE response with conversationId, text, and done events", async () => {
    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "Hello Sage, how are you?" },
    });

    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);

    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/i);

    const body = await readSseBody(res);
    // SSE event format is "data: {...}\n\n"
    assert.match(body, /data: /);
    // The route sends a conversationId event first
    assert.match(body, /"conversationId":"conv-1"/);
    // The fake provider yields "Hello, " and "world!"
    assert.match(body, /"text":"Hello, "/);
    assert.match(body, /"text":"world!"/);
    // And finally a done event
    assert.match(body, /"done":true/);

    // Assistant message persisted (user + assistant = 2 saveMessage calls)
    assert.ok(mockSaveMessage.mock.callCount() >= 2);
  });

  it("registers the route under the `sage.chat` tool ID", async () => {
    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "Just checking in" },
    });

    await route.POST(req as never, { params: Promise.resolve({}) } as never);
    assert.equal(toolCapturedBy_withRegistry, "sage.chat");
  });

  it("appends the crisis resource block when the model reply omits 988 on a crisis-signal message", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () =>
      makeFakeProvider("ollama", ["I hear you, ", "that sounds really hard."]),
    );

    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "I just want to end it all" },
    });

    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);
    const body = await readSseBody(res);

    assert.match(body, /988/);

    // Persisted assistant message must match what the student saw (SSE + history parity).
    const assistantCall = mockSaveMessage.mock.calls.find(
      (call) => call.arguments[2] === "assistant",
    );
    assert.ok(assistantCall, "expected an assistant saveMessage call");
    assert.match(String(assistantCall!.arguments[3]), /988/);
  });

  it("does not append the crisis block when the model reply already contains 988", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () =>
      makeFakeProvider("ollama", ["Please call or text 988 right now — you matter."]),
    );

    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "I just want to end it all" },
    });

    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);
    const body = await readSseBody(res);

    const occurrences = (body.match(/988/g) ?? []).length;
    assert.equal(occurrences, 1, "988 should appear exactly once — no duplicate safety-net block");
  });

  it("does not append the crisis block for a non-crisis message", async () => {
    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "Hello Sage, how are you?" },
    });

    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);
    const body = await readSseBody(res);

    assert.doesNotMatch(body, /988/);
  });

  it("does not append the crisis block for staff (teacher) chat — student-only scope guard", async () => {
    session = mockTeacherSession();
    mockResolveAiProvider.mock.mockImplementation(async () =>
      makeFakeProvider("ollama", ["I hear you, ", "that sounds really hard."]),
    );

    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "A student mentioned they want to end it all — how should I respond?" },
    });

    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);
    const body = await readSseBody(res);

    assert.doesNotMatch(body, /988/);
  });
});

describe("POST /api/chat/send — Sage self-metric wiring", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("routes the student prompt through the bundle and injects the self-metric line", async () => {
    mockSelfMetricLineFromBundle.mock.mockImplementation(
      () => "Of the 5 goals you proposed recently, 3 were confirmed (60%).",
    );

    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "How am I doing on my goals?" },
    });

    await route.POST(req as never, { params: Promise.resolve({}) } as never);

    // Bundle is the canonical feed: assembled with viewer "sage" + the
    // prompt-context composition flag + the active conversation id.
    assert.equal(mockAssembleStudentContextBundle.mock.callCount(), 1);
    const [studentId, options] =
      mockAssembleStudentContextBundle.mock.calls[0].arguments;
    assert.equal(studentId, session.id);
    assert.equal(options.viewer, "sage");
    assert.equal(options.includeChatPromptContext, true);
    assert.equal(options.conversationId, "conv-1");

    // The formatted line reaches buildSystemPrompt.
    assert.ok(mockBuildSystemPrompt.mock.callCount() >= 1);
    const promptCtx = mockBuildSystemPrompt.mock.calls[0].arguments[1];
    assert.equal(
      promptCtx.selfMetricsLine,
      "Of the 5 goals you proposed recently, 3 were confirmed (60%).",
    );

    // The legacy direct path is no longer used on the student branch.
    assert.equal(mockGetStudentPromptContext.mock.callCount(), 0);
  });

  it("passes an empty self-metric line through for a new student (zero settled wagers)", async () => {
    mockSelfMetricLineFromBundle.mock.mockImplementation(() => "");

    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "How am I doing on my goals?" },
    });
    await route.POST(req as never, { params: Promise.resolve({}) } as never);

    const promptCtx = mockBuildSystemPrompt.mock.calls[0].arguments[1];
    assert.equal(promptCtx.selfMetricsLine, "");
  });

  it("computes situationalSnapshot (non-discovery, non-compact) and passes it to buildSystemPrompt", async () => {
    mockGetPromptTier.mock.mockImplementation(() => "full");
    mockGetSituationalSnapshot.mock.mockImplementation(async () => "SNAPSHOT_STUB");

    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "How am I doing on my goals?" },
    });
    await route.POST(req as never, { params: Promise.resolve({}) } as never);

    // The gated situational call fires for a non-discovery stage at non-compact tier...
    assert.equal(mockGetSituationalSnapshot.mock.callCount(), 1);
    assert.equal(mockGetSituationalSnapshot.mock.calls[0].arguments[0], session.id);
    // ...and its result reaches buildSystemPrompt.
    const promptCtx = mockBuildSystemPrompt.mock.calls[0].arguments[1];
    assert.equal(promptCtx.situationalSnapshot, "SNAPSHOT_STUB");
  });
});

describe("POST /api/chat/send — form commitment → present_form", () => {
  const previousAgentFlag = process.env.SAGE_AGENT_ENABLED;
  const previousAgentMode = process.env.SAGE_AGENT_MODE;

  before(() => {
    process.env.SAGE_AGENT_MODE = "readonly";
    process.env.SAGE_AGENT_ENABLED = "false";
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

  it("on Yes after a form offer, emits open_form action without asking for the link", async () => {
    const conversationId = "cm1234567890abcdefghijklm";
    mockGetOrCreateConversation.mock.mockImplementation(async () => ({
      id: conversationId,
      title: "test",
      stage: "orientation",
      messages: [
        {
          role: "assistant",
          content:
            "Would you like to start with the [SPOKES Student Profile](/api/forms/download?formId=student-profile&mode=view)?",
        },
      ],
    }));

    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "Yes", conversationId },
    });

    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);
    assert.equal(res.status, 200);

    const body = await readSseBody(res);
    assert.match(body, /"type":"action"/);
    assert.match(body, /"action":"open_form"/);
    assert.match(body, /formId=student-profile/);
    assert.match(body, /Open SPOKES Student Profile/);
    assert.equal(mockExecuteAgentTool.mock.callCount(), 1);
    assert.equal(
      mockExecuteAgentTool.mock.calls[0].arguments[0].toolName,
      "present_form",
    );
    // Must not fall through to the model agent loop.
    assert.equal(mockRunAgentTurn.mock.callCount(), 0);
  });

  it("on an explicit form ask, presents via present_form without the model", async () => {
    mockResolveDirectFormMatch.mock.mockImplementation(() => [
      {
        form: {
          id: "student-profile",
          title: "SPOKES Student Profile",
        },
        url: "/api/forms/download?formId=student-profile&mode=view",
        score: 40,
      },
    ]);

    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "show me the student profile form" },
    });

    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);
    assert.equal(res.status, 200);

    const body = await readSseBody(res);
    assert.match(body, /"action":"open_form"/);
    assert.match(body, /formId=student-profile/);
    assert.equal(mockExecuteAgentTool.mock.callCount(), 1);
    assert.equal(mockGetDirectFormAnswer.mock.callCount(), 0);
    assert.equal(mockRunAgentTurn.mock.callCount(), 0);
    assert.equal(mockResolveAiProvider.mock.callCount(), 0);
  });
});
