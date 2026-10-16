import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Discovery-stage failure handling, end to end through the REAL extractor
// (src/lib/sage/discovery-extractor.ts), the REAL retryWithBackoff and the
// REAL recordFailedExtraction. Only the model provider, the database client
// and the CareerDiscovery persistence helper are stubbed, so these tests see
// exactly what production does with a failed or empty extraction.
//
// post-response.test.ts mocks the extractor and the retry wrapper, so it
// cannot observe this seam; this file exists because the bug lived in it.
// Red-baseline: against the pre-fix extractor (which caught its own failures
// and resolved an all-empty result) every test here except the positive
// control fails: the empties were upserted and nothing was dead-lettered.

const mockGenerateStructuredResponse = mock.fn<(...args: unknown[]) => Promise<string>>(
  async () => "{}",
);
const mockUpsertDiscoveryFromExtraction = mock.fn<(...args: unknown[]) => Promise<void>>(
  async () => undefined,
);
const mockFailedExtractionCreate = mock.fn<(args: unknown) => Promise<unknown>>(async () => ({}));
const mockConversationUpdate = mock.fn<(args: unknown) => Promise<unknown>>(async () => ({}));
const mockAwardEvent = mock.fn<(args: unknown) => Promise<void>>(async () => undefined);
const mockLoggerError = mock.fn<(msg: string, meta?: Record<string, unknown>) => void>();

mock.module("@/lib/db", {
  exports: {
    prisma: { conversation: { update: mockConversationUpdate } },
    prismaAdmin: { failedExtraction: { create: mockFailedExtractionCreate } },
  },
});

mock.module("@/lib/ai", {
  exports: {
    resolveAiProvider: async () => ({
      name: "ollama",
      generateStructuredResponse: mockGenerateStructuredResponse,
    }),
  },
});

mock.module("@/lib/ai/audit", {
  exports: {
    getProviderClass: () => "local",
    logAiAuditEvent: async () => undefined,
    policyDecisionForProvider: () => "local_only",
  },
});

mock.module("@/lib/llm-usage", {
  exports: { withUsageLogging: (provider: unknown) => provider },
});

mock.module("@/lib/career-discovery", {
  exports: { upsertDiscoveryFromExtraction: mockUpsertDiscoveryFromExtraction },
});

mock.module("@/lib/goals", {
  exports: { GOAL_PLANNING_STATUSES: ["confirmed", "active"], isGoalLevel: () => true },
});
mock.module("@/lib/sage/goal-extractor", { exports: { extractGoals: async () => ({}) } });
mock.module("@/lib/sage/propose-goal", { exports: { proposeGoal: async () => ({}) } });
mock.module("@/lib/sage/record-insight", { exports: { recordInsight: async () => ({}) } });
mock.module("@/lib/sage/propose-goal-wager", {
  exports: { maybeCreateGoalProposalWager: async () => undefined },
});
mock.module("@/lib/sage/mood-extractor", {
  exports: { extractMoodFromConversation: async () => undefined },
});
mock.module("@/lib/sage/system-prompts", { exports: { determineStage: () => "planning" } });
mock.module("@/lib/sage/classroom-confirmation", {
  exports: { detectAndRecordClassroomConfirmation: async () => undefined },
});
mock.module("@/lib/sage/memory/extract", {
  exports: { extractAndStoreMemories: async () => undefined },
});
mock.module("@/lib/rate-limit", {
  exports: { rateLimitDaily: async () => ({ success: true, remaining: 10, resetTime: 0 }) },
});
mock.module("@/lib/sage/readability", {
  exports: {
    assessReadability: () => ({ scorable: false, withinTarget: true, grade: 0, ease: 0, words: 0 }),
    PLAIN_LANGUAGE_MAX_GRADE: 8,
  },
});
mock.module("@/lib/progression/engine", {
  exports: { recordWeeklyReview: () => undefined, recordMonthlyReview: () => undefined },
});
mock.module("@/lib/progression/events", { exports: { awardEvent: mockAwardEvent } });
mock.module("@/lib/logger", {
  exports: {
    logger: { info: mock.fn(), warn: mock.fn(), error: mockLoggerError, debug: mock.fn() },
  },
});
mock.module("./conversation", {
  exports: { generateConversationTitle: async () => undefined },
});

let postResponseModule: typeof import("./post-response");

before(async () => {
  postResponseModule = await import("./post-response");
});

function discoveryTurn() {
  return postResponseModule.handlePostResponse({
    conversationId: "conv-1",
    conversationTitle: null,
    conversationStage: "discovery",
    fullResponse: "What kind of work feels good to you?",
    sourceMessageId: "msg-1",
    studentId: "student-1",
    allMessages: [{ role: "user" as const, content: "I like fixing cars." }],
    userMessage: "I like fixing cars.",
    programType: "spokes",
    // Keeps the classroom detector out of this turn; it is not under test.
    classroomConfirmedAt: new Date("2026-07-01T00:00:00Z"),
  });
}

function deadLetterRows(): Record<string, unknown>[] {
  return mockFailedExtractionCreate.mock.calls.map(
    (call) => (call.arguments[0] as { data: Record<string, unknown> }).data,
  );
}

/** What the prompt tells the model to return when it has nothing yet. */
const PROMPT_SHAPED_EMPTY = JSON.stringify({
  interests: [],
  strengths: [],
  subjects: [],
  problems: [],
  values: [],
  circumstances: [],
  cluster_scores: { "office-admin": 0, "tech-digital": 0 },
  summary: "",
  riasec_scores: {
    realistic: 0,
    investigative: 0,
    artistic: 0,
    social: 0,
    enterprising: 0,
    conventional: 0,
  },
  national_career_clusters: [],
  transferable_skills: [],
  work_values: [],
  assessment_summary: "",
  stage_complete: false,
  xp_events: [],
});

describe("handlePostResponse — discovery extraction failures", () => {
  beforeEach(() => {
    for (const fn of [
      mockGenerateStructuredResponse,
      mockUpsertDiscoveryFromExtraction,
      mockFailedExtractionCreate,
      mockConversationUpdate,
      mockAwardEvent,
      mockLoggerError,
    ]) {
      fn.mock.resetCalls();
    }
    process.env.SAGE_MEMORY_ENABLED = "false";
    delete process.env.SAGE_POST_RESPONSE_MAX_CALLS;
  });

  const failures: { name: string; behave: () => Promise<string>; error: RegExp }[] = [
    {
      name: "the provider throws",
      behave: async () => {
        throw new Error("provider unavailable");
      },
      error: /provider unavailable/,
    },
    {
      name: "the provider returns text that is not JSON",
      behave: async () => "Sure! Here are the signals: interests",
      error: /SyntaxError/,
    },
  ];

  for (const { name, behave, error } of failures) {
    it(`retries and dead-letters, and never overwrites the stored profile, when ${name}`, async () => {
      mockGenerateStructuredResponse.mock.mockImplementation(behave);

      await discoveryTurn();

      assert.equal(
        mockUpsertDiscoveryFromExtraction.mock.callCount(),
        0,
        "a failed extraction must not reach the CareerDiscovery write",
      );
      assert.equal(mockGenerateStructuredResponse.mock.callCount(), 3, "expected three attempts");
      assert.equal(mockConversationUpdate.mock.callCount(), 0);
      assert.equal(mockAwardEvent.mock.callCount(), 0);

      const rows = deadLetterRows();
      assert.equal(rows.length, 1, "expected one FailedExtraction row");
      assert.equal(rows[0].extractorKey, "discovery_extraction_exhausted");
      assert.equal(rows[0].studentId, "student-1");
      assert.equal(rows[0].conversationId, "conv-1");
      assert.equal(rows[0].attempts, 3);
      assert.match(String(rows[0].error), error);
      assert.match(String(rows[0].payload), /I like fixing cars/);
    });
  }

  for (const [name, raw] of [
    ["an empty object", "{}"],
    ["the prompt's own nothing-yet shape", PROMPT_SHAPED_EMPTY],
  ] as const) {
    it(`does not overwrite the stored profile when the model returns ${name}`, async () => {
      mockGenerateStructuredResponse.mock.mockImplementation(async () => raw);

      await discoveryTurn();

      assert.equal(
        mockUpsertDiscoveryFromExtraction.mock.callCount(),
        0,
        "an empty extraction must not reach the CareerDiscovery write",
      );
      assert.equal(mockGenerateStructuredResponse.mock.callCount(), 1, "a valid reply is not retried");
      assert.equal(deadLetterRows().length, 0, "an empty reply is not a failure");
    });
  }

  it("still writes an extraction that carries a signal (positive control)", async () => {
    mockGenerateStructuredResponse.mock.mockImplementation(async () =>
      JSON.stringify({ ...JSON.parse(PROMPT_SHAPED_EMPTY), interests: ["fixing cars"] }),
    );

    await discoveryTurn();

    assert.equal(mockUpsertDiscoveryFromExtraction.mock.callCount(), 1);
    const [studentId, data] = mockUpsertDiscoveryFromExtraction.mock.calls[0].arguments as [
      string,
      Record<string, unknown>,
    ];
    assert.equal(studentId, "student-1");
    assert.equal(data.interests, JSON.stringify(["fixing cars"]));
    assert.equal(deadLetterRows().length, 0);
  });
});
