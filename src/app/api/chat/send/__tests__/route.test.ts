/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockRequest } from "@/lib/test-helpers";

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
const mockLogger = {
  error: mock.fn() as any,
  warn: mock.fn() as any,
  info: mock.fn() as any,
};
const mockBuildSystemPrompt = mock.fn() as any;
const mockGetDocumentContext = mock.fn() as any;
const mockGetDirectFormAnswer = mock.fn() as any;
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
const mockGetStudentProgramType = mock.fn() as any;
const mockPrismaStudentFindUnique = mock.fn() as any;
const mockFormatClustersForPrompt = mock.fn() as any;
const mockRunAgentTurn = mock.fn() as any;
const mockExecuteSlashCommand = mock.fn() as any;

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

mock.module("@/lib/sage/knowledge-base", {
  namedExports: {
    getDirectFormAnswer: mockGetDirectFormAnswer,
    getFormContext: mockGetFormContext,
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
    mockBuildSystemPrompt,
    mockGetDocumentContext,
    mockGetDirectFormAnswer,
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
    mockBuildStaffStudentContext,
    mockShouldAttemptStaffStudentContext,
    mockCheckTokenQuota,
    mockGetStudentProgramType,
    mockPrismaStudentFindUnique,
    mockFormatClustersForPrompt,
    mockRunAgentTurn,
    mockExecuteSlashCommand,
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
  mockGetFormContext.mock.mockImplementation(() => "");
  mockGetDocumentContext.mock.mockImplementation(async () => "");
  mockResolveAiProvider.mock.mockImplementation(async () => makeFakeProvider("ollama"));
  mockGetPromptTier.mock.mockImplementation(() => "compact");
  mockGetProviderClass.mock.mockImplementation(() => "local");
  mockLogAiAuditEvent.mock.mockImplementation(async () => undefined);
  mockBuildSystemPrompt.mock.mockImplementation(() => "SYSTEM PROMPT");
  mockCheckTokenQuota.mock.mockImplementation(async () => ({ allowed: true, warning: null }));
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
  mockSaveMessage.mock.mockImplementation(async () => undefined);
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
});
