/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; the same "accept any implementation" escape hatch the route's own test file uses. */
/**
 * crisis-latency harness — measures the real chat route, not a stand-in.
 *
 * WHY A SEPARATE PROCESS
 * ----------------------
 * The measurement has to go through `POST /api/chat/send` itself, because the
 * property under test is an ORDERING property of that handler: VQ-R-001 was
 * exactly the case where the detector worked fine and the route reached its
 * exits without ever calling it. Only the route can prove the scan still sits
 * in front of provider resolution, the rate limiters and the direct-answer
 * branches. Driving the route means mocking its dependencies, which needs
 * `mock.module` and therefore `--experimental-test-module-mocks`; the benchmark
 * runner cannot be assumed to carry that flag, so the scorer spawns this file
 * with it and reads one JSON object off stdout.
 *
 * WHAT IS MEASURED
 * ----------------
 * Wall-clock milliseconds from just before `route.POST(...)` is called to the
 * moment `recordWellbeingConcern` is entered — the instant the staff alert
 * path is committed to. Every sample runs under a FAILING provider, because
 * the failure modes are the ones VQ-R-001 was about:
 *
 *   provider_503  resolveAiProvider throws        -> route answers 503
 *   rate_limit    the hourly chat limiter rejects -> route answers 429
 *   stream_error  streamResponse throws mid-reply -> SSE error event
 *
 * Everything downstream of the scan is mocked, so this measures the route's
 * own path to the alert and not a database or a model. That is the right
 * scope: a regression here means someone moved the scan, added an await in
 * front of it, or put work between the request and the alert.
 *
 * OUTPUT: one line of JSON on stdout, `{"samples":[{mode, ms, status}, ...]}`.
 * Anything else on stdout would corrupt the parse, so the harness prints
 * nothing else.
 */
import { mock } from "node:test";
import { mockStudentSession, mockRequest } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

const MODES = ["provider_503", "rate_limit", "stream_error"] as const;
type Mode = (typeof MODES)[number];

let session: Session = mockStudentSession();
let mode: Mode = "provider_503";
/** Set immediately before route.POST; read inside the recordWellbeingConcern stub. */
let requestStartedAt = 0;
let recordedAt: number | null = null;

const noop = () => undefined;
const asyncNoop = async () => undefined;

mock.module("@/lib/registry/middleware", {
  namedExports: {
    withRegistry:
      (toolId: string, handler: (s: Session, req: any, ctx: any, tool: any) => Promise<Response>) =>
      async (req: any, ctx: any) => {
        try {
          return await handler(session, req, ctx, { id: toolId, name: "Sage Chat" });
        } catch (err) {
          if (err && typeof err === "object" && "statusCode" in err) {
            return Response.json(
              { error: err instanceof Error ? err.message : "Request failed" },
              { status: Number((err as { statusCode: number }).statusCode) },
            );
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
    rlsContextFor: () => ({ userId: session.id, role: "student", studentId: session.id }),
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    // The crisis record cap and the hourly chat cap are different keys. Only
    // the chat key is exhausted, and only in rate_limit mode — the crisis cap
    // must never be the thing that stops a first signal.
    rateLimit: async (key: string) =>
      mode === "rate_limit" && key.startsWith("chat:")
        ? { success: false, remaining: 0, resetTime: Date.now() + 3_600_000, degraded: false }
        : { success: true, remaining: 100, resetTime: Date.now() + 3_600_000, degraded: false },
    rateLimitDaily: async () => ({ success: true, remaining: 200, resetTime: Date.now() + 3_600_000 }),
    refundRateLimit: asyncNoop,
  },
});

mock.module("@/lib/rate-limit-switch", { namedExports: { rateLimitsDisabled: () => false } });

function failingProvider() {
  return {
    name: "ollama",
    async generateResponse() {
      throw new Error("upstream connection reset");
    },
    async *streamResponse() {
      yield "I hear ";
      throw new Error("upstream connection reset");
    },
    async generateStructuredResponse() {
      return "{}";
    },
  };
}

mock.module("@/lib/ai", {
  namedExports: {
    resolveAiProvider: async () => {
      if (mode === "provider_503") throw new Error("Local AI server unreachable");
      return failingProvider();
    },
    getPromptTier: () => "compact",
  },
});

mock.module("@/lib/ai/audit", {
  namedExports: {
    getProviderClass: () => "local",
    logAiAuditEvent: asyncNoop,
    policyDecisionForProvider: () => "local_only",
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: noop, warn: noop, info: noop, debug: noop } },
});

mock.module("@/lib/sage/system-prompts", {
  namedExports: {
    buildSystemPrompt: () => "SYSTEM PROMPT",
    sanitizeForPrompt: (text: string) => text,
  },
});

mock.module("@/lib/sage/knowledge-base-server", {
  namedExports: { getDocumentContext: async () => "" },
});

mock.module("@/lib/sage/knowledge-base", {
  namedExports: {
    getDirectFormAnswer: () => null,
    resolveDirectFormMatch: () => null,
    getFormContext: () => "",
    findRelevantForms: () => [],
  },
});

mock.module("@/lib/progression/engine", { namedExports: { recordChatSession: asyncNoop } });
mock.module("@/lib/progression/events", { namedExports: { awardEvent: asyncNoop } });

mock.module("@/lib/chat/conversation", {
  namedExports: {
    getOrCreateConversation: async () => ({ id: "conv-1", title: "t", stage: "general", messages: [] }),
    getOrCreateTeacherConversation: async () => ({ id: "conv-t", title: "t", stage: "general", messages: [] }),
    saveMessage: async () => ({ id: "msg-1" }),
    getConversationContext: async () => ({ messages: [] }),
    maybeUpdateSummary: asyncNoop,
  },
});

mock.module("@/lib/chat/post-response", { namedExports: { handlePostResponse: asyncNoop } });

const emptyPromptContext = {
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
};

mock.module("@/lib/chat/context", {
  namedExports: { getStudentPromptContext: async () => emptyPromptContext },
});

mock.module("@/lib/sage/context-bundle", {
  namedExports: {
    assembleStudentContextBundle: async () => ({
      chatPromptContext: emptyPromptContext,
      meta: { selfMetrics: undefined },
    }),
    selfMetricLineFromBundle: () => "",
  },
});

mock.module("@/lib/sage/situational-snapshot", {
  namedExports: { getSituationalSnapshot: async () => null },
});

mock.module("@/lib/sage/staff-student-context", {
  namedExports: {
    buildStaffStudentContext: async () => ({ context: null, targetStudentId: null, resolution: "none" }),
    shouldAttemptStaffStudentContext: () => false,
  },
});

mock.module("@/lib/spokes/career-clusters", { namedExports: { formatClustersForPrompt: () => "" } });

mock.module("@/lib/llm-usage", {
  namedExports: {
    checkTokenQuota: async () => ({ allowed: true, warning: null }),
    withUsageLogging: (provider: unknown) => provider,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: { student: { findUnique: async () => ({ classroomConfirmedAt: null }) } },
    prismaAdmin: { student: { findUnique: async () => ({ classroomConfirmedAt: null }) } },
  },
});

mock.module("@/lib/program-type-server", { namedExports: { getStudentProgramType: async () => null } });
mock.module("@/lib/sage/agent/loop", {
  namedExports: {
    async *runAgentTurn() {
      /* no events */
    },
  },
});
mock.module("@/lib/sage/agent/executor", {
  namedExports: { executeSlashCommand: async () => null, executeAgentTool: async () => null },
});

async function drainSse(res: Response): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

async function main() {
  // The real detector, with only the DB/notification sink replaced — the same
  // arrangement the route's own test file uses. The stub is what stamps the
  // measurement, so the clock stops exactly where the alert path begins.
  const realCrisisDetection = await import("@/lib/sage/crisis-detection");
  mock.module("@/lib/sage/crisis-detection", {
    namedExports: {
      ...realCrisisDetection,
      recordWellbeingConcern: async () => {
        if (recordedAt === null) recordedAt = performance.now();
      },
    },
  });

  // The classic streaming path, so a mid-stream throw is a real stream error.
  process.env.SAGE_AGENT_ENABLED = "false";
  delete process.env.SAGE_AGENT_MODE;

  const route = await import("@/app/api/chat/send/route");

  const messages: string[] = JSON.parse(process.env.BENCH_CRISIS_MESSAGES ?? "[]");
  if (messages.length === 0) throw new Error("BENCH_CRISIS_MESSAGES is empty");

  const samples: Array<{ mode: Mode; ms: number; status: number; recorded: boolean }> = [];

  for (const [index, message] of messages.entries()) {
    mode = MODES[index % MODES.length];
    session = mockStudentSession();
    recordedAt = null;

    const req = mockRequest("/api/chat/send", { method: "POST", body: { message } });
    requestStartedAt = performance.now();
    const res = await route.POST(req as never, { params: Promise.resolve({}) } as never);
    if (res.body) await drainSse(res);

    samples.push({
      mode,
      ms: recordedAt === null ? -1 : recordedAt - requestStartedAt,
      status: res.status,
      recorded: recordedAt !== null,
    });
  }

  process.stdout.write(`${JSON.stringify({ samples })}\n`);
}

void main().catch((err) => {
  process.stderr.write(`${String(err instanceof Error ? err.stack : err)}\n`);
  process.exitCode = 1;
});
