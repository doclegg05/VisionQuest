/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import { before, mock } from "node:test";
import { mockStudentSession } from "@/lib/test-helpers";

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

export let session = mockStudentSession();
export function setSession(next: typeof session): void {
  session = next;
}
export let toolCapturedBy_withRegistry: string | null = null;

export const mockRateLimit = mock.fn() as any;
export const mockRateLimitDaily = mock.fn() as any;
export const mockRefundRateLimit = mock.fn() as any;
export const mockRateLimitsDisabled = mock.fn() as any;
export const mockResolveAiProvider = mock.fn() as any;
export const mockGetPromptTier = mock.fn() as any;
export const mockGetProviderClass = mock.fn() as any;
export const mockLogAiAuditEvent = mock.fn() as any;
export const mockPolicyDecisionForProvider = mock.fn() as any;
export const mockLogger = {
  error: mock.fn() as any,
  warn: mock.fn() as any,
  info: mock.fn() as any,
};
export const mockBuildSystemPrompt = mock.fn() as any;
export const mockGetDocumentContext = mock.fn() as any;
export const mockGetDirectFormAnswer = mock.fn() as any;
export const mockResolveDirectFormMatch = mock.fn() as any;
export const mockGetFormContext = mock.fn() as any;
export const mockRecordChatSession = mock.fn() as any;
export const mockAwardEvent = mock.fn() as any;
export const mockGetOrCreateConversation = mock.fn() as any;
export const mockGetOrCreateTeacherConversation = mock.fn() as any;
export const mockSaveMessage = mock.fn() as any;
export const mockGetConversationContext = mock.fn() as any;
export const mockMaybeUpdateSummary = mock.fn() as any;
export const mockHandlePostResponse = mock.fn() as any;
export const mockGetStudentPromptContext = mock.fn() as any;
export const mockBuildStaffStudentContext = mock.fn() as any;
export const mockShouldAttemptStaffStudentContext = mock.fn() as any;
export const mockCheckTokenQuota = mock.fn() as any;
export const mockWithUsageLogging = mock.fn() as any;
export const mockGetStudentProgramType = mock.fn() as any;
export const mockPrismaStudentFindUnique = mock.fn() as any;
export const mockFileUploadFindMany = mock.fn() as any;
export const mockMessageFindFirst = mock.fn() as any;
export const mockFormatClustersForPrompt = mock.fn() as any;
export const mockRunAgentTurn = mock.fn() as any;
export const mockExecuteSlashCommand = mock.fn() as any;
export const mockExecuteAgentTool = mock.fn() as any;
export const mockAssembleStudentContextBundle = mock.fn() as any;
export const mockSelfMetricLineFromBundle = mock.fn() as any;
export const mockGetSituationalSnapshot = mock.fn() as any;
export const mockRecordWellbeingConcern = mock.fn() as any;

// ---------------------------------------------------------------------------
// withRegistry passthrough — mirrors the withTeacherAuth pattern in
// class-route-auth.test.ts. Calls the handler directly with the test
// session unless mockGetSessionReturnsNull flips, which simulates the
// 401 path for auth-guard test.
// ---------------------------------------------------------------------------
let getSessionReturnsNull = false;
export function setSessionReturnsNull(next: boolean): void {
  getSessionReturnsNull = next;
}

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
    conflict: (msg: string) => {
      const e = new Error(msg) as Error & { statusCode: number };
      e.statusCode = 409;
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
    refundRateLimit: mockRefundRateLimit,
  },
});

mock.module("@/lib/rate-limit-switch", {
  namedExports: {
    rateLimitsDisabled: mockRateLimitsDisabled,
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
    // renderRecentActivity sanitizes alert lines through this; identity is
    // enough here — the sanitizer has its own tests.
    sanitizeForPrompt: (text: string) => text,
    // ConversationStage is a type-only export — not needed at runtime.
  },
});

mock.module("@/lib/sage/knowledge-base-server", {
  namedExports: {
    getDocumentContext: mockGetDocumentContext,
  },
});

export const mockFindRelevantForms = mock.fn() as any;

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
      fileUpload: {
        findMany: mockFileUploadFindMany,
      },
      message: {
        findFirst: mockMessageFindFirst,
      },
    },
    prismaAdmin: {
      student: {
        findUnique: mockPrismaStudentFindUnique,
      },
    },
  },
});

mock.module("@/lib/chat/open-orientation-items", {
  namedExports: {
    loadOpenOrientationItems: async () => [],
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
export function makeFakeProvider(name = "ollama", chunks: string[] = ["Hello, ", "world!"]) {
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
export async function readSseBody(res: Response): Promise<string> {
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
export let route: Awaited<typeof import("../route")>;

before(async () => {
  // Crisis detection: keep the real deterministic detector (the 988
  // safety-net and request-time scan suites prove real patterns match) and
  // stub only the DB/notification sink. The real module is loaded here, after
  // the prisma/logger mocks above, so nothing reaches a database.
  const realCrisisDetection = await import("@/lib/sage/crisis-detection");
  mock.module("@/lib/sage/crisis-detection", {
    namedExports: {
      ...realCrisisDetection,
      recordWellbeingConcern: mockRecordWellbeingConcern,
    },
  });

  route = await import("../route");
});

// ---------------------------------------------------------------------------
// Default mock state used by most happy-path tests. Reset in beforeEach.
// ---------------------------------------------------------------------------
export function resetMocks() {
  for (const m of [
    mockRateLimit,
    mockRateLimitDaily,
    mockRefundRateLimit,
    mockRateLimitsDisabled,
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
    mockFileUploadFindMany,
    mockMessageFindFirst,
    mockFormatClustersForPrompt,
    mockRunAgentTurn,
    mockExecuteSlashCommand,
    mockExecuteAgentTool,
    mockRecordWellbeingConcern,
    mockLogger.error,
    mockLogger.warn,
    mockLogger.info,
  ]) {
    m.mock.resetCalls();
  }
  mockRecordWellbeingConcern.mock.mockImplementation(async () => undefined);

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
  mockRefundRateLimit.mock.mockImplementation(async () => undefined);
  mockRateLimitsDisabled.mock.mockImplementation(() => false);
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
  mockFileUploadFindMany.mock.mockImplementation(async () => []);
  mockMessageFindFirst.mock.mockImplementation(async () => null);
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
