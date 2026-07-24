import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// P2-4: post-response priority ordering + feature-flagged per-turn model-call
// cap (SAGE_POST_RESPONSE_MAX_CALLS).
// - cap unset/0/invalid → every eligible step launches (pre-flag behavior)
// - cap set → budget allocated in priority order (mood, goals, discovery,
//   classroom_confirmation, memory); mood is safety-exempt and never counted
// - discovery stage keeps its early return (goal extraction never runs)
// - the deterministic crisis scan always runs, regardless of any cap

const mockGoalFindMany = mock.fn<(args: unknown) => Promise<{ level: string }[]>>(async () => []);
const mockCareerDiscoveryUpsert = mock.fn<(args: unknown) => Promise<unknown>>(async () => ({}));
const mockCareerDiscoveryFindUnique = mock.fn<(args: unknown) => Promise<unknown>>(async () => null);
const mockConversationUpdate = mock.fn<(args: unknown) => Promise<unknown>>(async () => ({}));
const mockMessageCount = mock.fn<(args: unknown) => Promise<number>>(async () => 0);

const mockExtractGoals = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
  goals_found: [],
  stage_complete: false,
}));
const mockExtractDiscoverySignals = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
  interests: [],
  strengths: [],
  subjects: [],
  problems: [],
  values: [],
  circumstances: [],
  cluster_scores: {},
  summary: "",
  riasec_scores: {},
  holland_code: "",
  national_career_clusters: [],
  transferable_skills: [],
  work_values: [],
  assessment_summary: "",
  stage_complete: false,
}));
const mockExtractMood = mock.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockClassroomConfirmation = mock.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockExtractMemories = mock.fn<(args: unknown) => Promise<void>>(async () => undefined);
const mockGenerateTitle = mock.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockDetectCrisisSignal = mock.fn<(text: string) => { matched: boolean; category?: string }>(
  () => ({ matched: false }),
);
const mockRecordWellbeingConcern = mock.fn<(args: unknown) => Promise<void>>(async () => undefined);
const mockRateLimitDaily = mock.fn<
  (key: string, limit: number) => Promise<{ success: boolean; remaining: number; resetTime: number }>
>(async () => ({ success: true, remaining: 10, resetTime: 0 }));
const mockAwardEvent = mock.fn<(args: unknown) => Promise<void>>(async () => undefined);
const mockLogAiAuditEvent = mock.fn<(args: unknown) => Promise<void>>(async () => undefined);
const mockLoggerInfo = mock.fn<(msg: string, meta?: Record<string, unknown>) => void>();
const mockLoggerWarn = mock.fn<(msg: string, meta?: Record<string, unknown>) => void>();
const mockLoggerError = mock.fn<(msg: string, meta?: Record<string, unknown>) => void>();

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      goal: { findMany: mockGoalFindMany },
      careerDiscovery: { upsert: mockCareerDiscoveryUpsert, findUnique: mockCareerDiscoveryFindUnique },
      careerEducationPlan: { findUnique: async () => null },
      conversation: { update: mockConversationUpdate },
      message: { count: mockMessageCount },
      studentAlert: { upsert: async () => ({}) },
    },
  },
});

mock.module("@/lib/ai", {
  namedExports: {
    resolveAiProvider: async () => ({ name: "ollama" }),
  },
});

mock.module("@/lib/ai/audit", {
  namedExports: {
    getProviderClass: () => "local",
    logAiAuditEvent: mockLogAiAuditEvent,
    policyDecisionForProvider: () => "local_only",
  },
});

mock.module("@/lib/llm-usage", {
  namedExports: {
    withUsageLogging: (provider: unknown) => provider,
  },
});

mock.module("@/lib/goals", {
  namedExports: {
    GOAL_PLANNING_STATUSES: ["confirmed", "active"],
    isGoalLevel: () => true,
  },
});

mock.module("@/lib/sage/goal-extractor", {
  namedExports: { extractGoals: mockExtractGoals },
});

mock.module("@/lib/sage/propose-goal", {
  namedExports: { proposeGoal: async () => ({ status: "created" }) },
});

mock.module("@/lib/sage/propose-goal-wager", {
  namedExports: { maybeCreateGoalProposalWager: async () => undefined },
});

mock.module("@/lib/sage/mood-extractor", {
  namedExports: { extractMoodFromConversation: mockExtractMood },
});

mock.module("@/lib/sage/discovery-extractor", {
  namedExports: {
    extractDiscoverySignals: mockExtractDiscoverySignals,
    topClusterIds: () => [],
  },
});

mock.module("@/lib/sage/plan-extractor", {
  namedExports: {
    extractCareerPlanSignals: async () => ({
      terminal_outcome: null,
      target_clusters: [],
      target_industries: [],
      onet_codes: [],
      assessment_results: { tabe: null, cfwv: null, onet_or_cos: null, other: null },
      ecp_status: "not_started",
      summary: "",
      needs_wioa_referral: false,
      wioa_reason: "",
      stage_complete: false,
    }),
  },
});

mock.module("@/lib/sage/propose-career-plan", {
  namedExports: { proposeCareerPlan: async () => ({ status: "created", planId: "plan-1" }) },
});

mock.module("@/lib/sage/milestone-memory", {
  namedExports: { recordMilestoneMemory: async () => undefined },
});

mock.module("@/lib/sage/system-prompts", {
  namedExports: { determineStage: () => "planning" },
});

mock.module("@/lib/sage/classroom-confirmation", {
  namedExports: { detectAndRecordClassroomConfirmation: mockClassroomConfirmation },
});

mock.module("@/lib/sage/memory/extract", {
  namedExports: { extractAndStoreMemories: mockExtractMemories },
});

mock.module("@/lib/rate-limit", {
  namedExports: { rateLimitDaily: mockRateLimitDaily },
});

mock.module("@/lib/sage/crisis-detection", {
  namedExports: {
    detectCrisisSignal: mockDetectCrisisSignal,
    recordWellbeingConcern: mockRecordWellbeingConcern,
  },
});

mock.module("@/lib/sage/readability", {
  namedExports: {
    assessReadability: () => ({ scorable: false, withinTarget: true, grade: 0, ease: 0, words: 0 }),
    PLAIN_LANGUAGE_MAX_GRADE: 8,
  },
});

mock.module("@/lib/sage/retry", {
  namedExports: {
    retryWithBackoff: async (fn: () => Promise<unknown>) => fn(),
  },
});

mock.module("@/lib/progression/engine", {
  namedExports: {
    recordWeeklyReview: () => undefined,
    recordMonthlyReview: () => undefined,
  },
});

mock.module("@/lib/progression/events", {
  namedExports: { awardEvent: mockAwardEvent },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      info: mockLoggerInfo,
      warn: mockLoggerWarn,
      error: mockLoggerError,
      debug: mock.fn(),
    },
  },
});

mock.module("./conversation", {
  namedExports: { generateConversationTitle: mockGenerateTitle },
});

let postResponseModule: typeof import("./post-response");

before(async () => {
  postResponseModule = await import("./post-response");
});

type HandlerParams = Parameters<typeof postResponseModule.handlePostResponse>[0];

function baseParams(overrides: Partial<HandlerParams> = {}): HandlerParams {
  return {
    conversationId: "conv-1",
    conversationTitle: null,
    conversationStage: "checkin",
    fullResponse: "Nice work today.",
    sourceMessageId: "msg-1",
    studentId: "student-1",
    allMessages: [{ role: "user" as const, content: "hello" }],
    userMessage: "hello",
    programType: "spokes",
    classroomConfirmedAt: null,
    ...overrides,
  };
}

function infoEvents(name: string): Record<string, unknown>[] {
  return mockLoggerInfo.mock.calls
    .filter((call) => call.arguments[0] === name)
    .map((call) => (call.arguments[1] ?? {}) as Record<string, unknown>);
}

function summaryEvent(): Record<string, unknown> {
  const events = infoEvents("sage.post_response.summary");
  assert.equal(events.length, 1, "expected exactly one summary log per invocation");
  return events[0];
}

const ALL_MOCKS = [
  mockGoalFindMany,
  mockCareerDiscoveryUpsert,
  mockCareerDiscoveryFindUnique,
  mockConversationUpdate,
  mockMessageCount,
  mockExtractGoals,
  mockExtractDiscoverySignals,
  mockExtractMood,
  mockClassroomConfirmation,
  mockExtractMemories,
  mockGenerateTitle,
  mockDetectCrisisSignal,
  mockRecordWellbeingConcern,
  mockRateLimitDaily,
  mockAwardEvent,
  mockLogAiAuditEvent,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
];

describe("handlePostResponse priority order and per-turn cap", () => {
  beforeEach(() => {
    for (const fn of ALL_MOCKS) {
      fn.mock.resetCalls();
    }
    mockDetectCrisisSignal.mock.mockImplementation(() => ({ matched: false }));
    mockRateLimitDaily.mock.mockImplementation(async () => ({
      success: true,
      remaining: 10,
      resetTime: 0,
    }));
    delete process.env.SAGE_POST_RESPONSE_MAX_CALLS;
    delete process.env.SAGE_MEMORY_ENABLED;
  });

  it("runs every eligible step when the cap is unset (default off)", async () => {
    await postResponseModule.handlePostResponse(baseParams());

    assert.equal(mockExtractMood.mock.callCount(), 1);
    assert.equal(mockExtractGoals.mock.callCount(), 1);
    assert.equal(mockClassroomConfirmation.mock.callCount(), 1);
    assert.equal(mockExtractMemories.mock.callCount(), 1);
    assert.equal(mockExtractDiscoverySignals.mock.callCount(), 0);
    assert.equal(infoEvents("sage.post_response.skipped").length, 0);

    const summary = summaryEvent();
    assert.equal(summary.cap, 0);
    assert.equal(summary.ran, 4);
    assert.equal(summary.skipped, 0);
    assert.deepEqual(summary.steps, [
      "mood:ran",
      "goals:ran",
      "discovery:not_eligible",
      "career_plan:not_eligible",
      "classroom_confirmation:ran",
      "memory:ran",
    ]);
    assert.equal(typeof summary.durationMs, "number");
  });

  it("treats an invalid cap value as unlimited", async () => {
    process.env.SAGE_POST_RESPONSE_MAX_CALLS = "not-a-number";

    await postResponseModule.handlePostResponse(baseParams());

    assert.equal(infoEvents("sage.post_response.skipped").length, 0);
    assert.equal(summaryEvent().ran, 4);
  });

  it("cap=2 keeps mood (exempt) plus the two highest-priority counted steps", async () => {
    process.env.SAGE_POST_RESPONSE_MAX_CALLS = "2";

    await postResponseModule.handlePostResponse(baseParams());

    assert.equal(mockExtractMood.mock.callCount(), 1);
    assert.equal(mockExtractGoals.mock.callCount(), 1);
    assert.equal(mockClassroomConfirmation.mock.callCount(), 1);
    assert.equal(mockExtractMemories.mock.callCount(), 0);

    const skipped = infoEvents("sage.post_response.skipped");
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].step, "memory");
    assert.equal(skipped[0].cap, 2);

    const summary = summaryEvent();
    assert.equal(summary.ran, 3);
    assert.equal(summary.skipped, 1);
    assert.deepEqual(summary.steps, [
      "mood:ran",
      "goals:ran",
      "discovery:not_eligible",
      "career_plan:not_eligible",
      "classroom_confirmation:ran",
      "memory:skipped_cap",
    ]);
  });

  it("cap=1 still runs mood and goals; classroom and memory are skipped and logged", async () => {
    process.env.SAGE_POST_RESPONSE_MAX_CALLS = "1";

    await postResponseModule.handlePostResponse(baseParams());

    assert.equal(mockExtractMood.mock.callCount(), 1);
    assert.equal(mockExtractGoals.mock.callCount(), 1);
    assert.equal(mockClassroomConfirmation.mock.callCount(), 0);
    assert.equal(mockExtractMemories.mock.callCount(), 0);
    // The deterministic wellbeing scan is outside the budget entirely.
    assert.equal(mockDetectCrisisSignal.mock.callCount(), 1);

    const skipped = infoEvents("sage.post_response.skipped");
    assert.deepEqual(
      skipped.map((event) => event.step),
      ["classroom_confirmation", "memory"],
    );
    assert.ok(skipped.every((event) => event.cap === 1));

    const summary = summaryEvent();
    assert.equal(summary.ran, 2);
    assert.equal(summary.skipped, 2);
  });

  it("records a wellbeing concern even under the tightest cap", async () => {
    process.env.SAGE_POST_RESPONSE_MAX_CALLS = "1";
    mockDetectCrisisSignal.mock.mockImplementation(() => ({
      matched: true,
      category: "self_harm",
    }));

    await postResponseModule.handlePostResponse(baseParams());

    assert.equal(mockRecordWellbeingConcern.mock.callCount(), 1);
    const concern = mockRecordWellbeingConcern.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(concern.studentId, "student-1");
    assert.equal(concern.category, "self_harm");
  });

  it("preserves the discovery-stage early return: discovery runs, goals never does", async () => {
    await postResponseModule.handlePostResponse(
      baseParams({ conversationStage: "discovery" }),
    );

    assert.equal(mockExtractDiscoverySignals.mock.callCount(), 1);
    assert.equal(mockCareerDiscoveryUpsert.mock.callCount(), 1);
    assert.equal(mockExtractGoals.mock.callCount(), 0);
    assert.equal(mockExtractMood.mock.callCount(), 0);
    assert.equal(mockGenerateTitle.mock.callCount(), 1);
    // Early return still closes out the audit trail (routed + completed).
    assert.equal(mockLogAiAuditEvent.mock.callCount(), 2);

    const summary = summaryEvent();
    assert.equal(summary.ran, 3); // discovery + classroom_confirmation + memory
    assert.equal(summary.skipped, 0);
    assert.deepEqual(summary.steps, [
      "mood:not_eligible",
      "goals:not_eligible",
      "discovery:ran",
      "career_plan:not_eligible",
      "classroom_confirmation:ran",
      "memory:ran",
    ]);
  });

  it("marks memory skipped_limit when its own daily circuit breaker trips", async () => {
    mockRateLimitDaily.mock.mockImplementation(async () => ({
      success: false,
      remaining: 0,
      resetTime: 0,
    }));

    await postResponseModule.handlePostResponse(baseParams());

    assert.equal(mockExtractMemories.mock.callCount(), 0);
    // A limiter skip is not a cap skip — no sage.post_response.skipped event.
    assert.equal(infoEvents("sage.post_response.skipped").length, 0);

    const summary = summaryEvent();
    assert.equal(summary.ran, 3); // mood + goals + classroom_confirmation
    assert.equal(summary.skipped, 0);
    assert.ok((summary.steps as string[]).includes("memory:skipped_limit"));
  });

  it("marks ineligible steps without consuming budget or logging cap skips", async () => {
    process.env.SAGE_MEMORY_ENABLED = "false";
    process.env.SAGE_POST_RESPONSE_MAX_CALLS = "2";

    await postResponseModule.handlePostResponse(
      baseParams({ classroomConfirmedAt: new Date("2026-07-01T00:00:00Z") }),
    );

    assert.equal(mockClassroomConfirmation.mock.callCount(), 0);
    assert.equal(mockExtractMemories.mock.callCount(), 0);
    assert.equal(mockExtractGoals.mock.callCount(), 1);
    assert.equal(infoEvents("sage.post_response.skipped").length, 0);

    const summary = summaryEvent();
    assert.deepEqual(summary.steps, [
      "mood:ran",
      "goals:ran",
      "discovery:not_eligible",
      "career_plan:not_eligible",
      "classroom_confirmation:not_eligible",
      "memory:not_eligible",
    ]);
  });
});
