import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Budget-aware history trimming in getConversationContext:
// - under budget → untouched
// - over budget → oldest dropped first; summary + 2 newest always retained
// - exact boundary → untouched
// - the injected rolling summary counts toward the budget but never gets trimmed

const mockConversationFindUnique = mock.fn<(args: unknown) => Promise<unknown>>();
const mockMessageFindMany = mock.fn<(args: unknown) => Promise<unknown>>();
const mockMessageCount = mock.fn<(args: unknown) => Promise<number>>();
const mockLoggerInfo = mock.fn<(msg: string, meta?: unknown) => void>();
const mockLoggerWarn = mock.fn<(msg: string, meta?: unknown) => void>();

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      conversation: { findUnique: mockConversationFindUnique },
      message: { findMany: mockMessageFindMany, count: mockMessageCount },
    },
  },
});

mock.module("@/lib/ai", {
  namedExports: {
    resolveAiProvider: async () => {
      throw new Error("resolveAiProvider should not be called in these tests");
    },
  },
});

mock.module("@/lib/ai/audit", {
  namedExports: {
    getProviderClass: () => "local",
    logAiAuditEvent: async () => undefined,
    policyDecisionForProvider: () => "local_only",
  },
});

mock.module("@/lib/sage/system-prompts", {
  namedExports: {
    determineStage: () => "discovery",
  },
});

mock.module("@/lib/api-error", {
  namedExports: {
    notFound: (message: string) => new Error(message),
  },
});

mock.module("@/lib/goals", {
  namedExports: {
    GOAL_PLANNING_STATUSES: ["confirmed", "active"],
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      info: mockLoggerInfo,
      warn: mockLoggerWarn,
      error: mock.fn(),
      debug: mock.fn(),
    },
  },
});

let conversationModule: typeof import("./conversation");

before(async () => {
  conversationModule = await import("./conversation");
});

// estimateTokens is ceil(chars / 4): 400 chars → exactly 100 tokens.
const CHARS_PER_100_TOKENS = 400;

interface DbMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

/** Build chronological messages of 100 estimated tokens each. */
function buildMessages(count: number): DbMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `${index + 1}`.padEnd(CHARS_PER_100_TOKENS, "x"),
    createdAt: new Date(Date.UTC(2026, 6, 1, 12, index)),
  }));
}

/** Configure the prisma mocks. `chronological` is oldest → newest. */
function primeDb(options: {
  chronological: DbMessage[];
  summary?: string | null;
  summaryUpToMessageId?: string | null;
  totalCount?: number;
}): void {
  const descending = [...options.chronological].reverse();
  mockConversationFindUnique.mock.mockImplementation(async () => ({
    summary: options.summary ?? null,
    summaryUpToMessageId: options.summaryUpToMessageId ?? null,
  }));
  mockMessageFindMany.mock.mockImplementation(async () => [...descending]);
  mockMessageCount.mock.mockImplementation(
    async () => options.totalCount ?? options.chronological.length,
  );
}

// The synthetic summary message is `[Previous conversation summary: ${summary}]`,
// a 33-char wrapper. 367 summary chars → 400-char message → 100 tokens.
const SUMMARY_100_TOKENS = "s".repeat(CHARS_PER_100_TOKENS - 33);

describe("getConversationContext budget-aware trimming", () => {
  beforeEach(() => {
    mockConversationFindUnique.mock.resetCalls();
    mockMessageFindMany.mock.resetCalls();
    mockMessageCount.mock.resetCalls();
    mockLoggerInfo.mock.resetCalls();
    mockLoggerWarn.mock.resetCalls();
  });

  it("returns the full history untouched when under budget", async () => {
    const chronological = buildMessages(4); // 400 tokens
    primeDb({ chronological });

    const context = await conversationModule.getConversationContext(
      "conv-1",
      20,
      conversationModule.COMPACT_HISTORY_TOKEN_BUDGET,
    );

    assert.equal(context.messages.length, 4);
    assert.equal(context.droppedForBudget, 0);
    assert.equal(context.overBudget, false);
    assert.equal(context.summaryInjected, false);
    // Chronological order preserved, roles mapped to user/model.
    assert.equal(context.messages[0].content, chronological[0].content);
    assert.equal(context.messages[0].role, "user");
    assert.equal(context.messages[1].role, "model");
    assert.equal(mockLoggerInfo.mock.callCount(), 0);
    assert.equal(mockLoggerWarn.mock.callCount(), 0);
  });

  it("does not trim at the exact budget boundary", async () => {
    const chronological = buildMessages(3); // exactly 300 tokens
    primeDb({ chronological });

    const context = await conversationModule.getConversationContext(
      "conv-boundary",
      20,
      300,
    );

    assert.equal(context.messages.length, 3);
    assert.equal(context.droppedForBudget, 0);
    assert.equal(context.overBudget, false);
  });

  it("drops one message once the total is a single token over budget", async () => {
    const chronological = buildMessages(3); // 300 tokens
    primeDb({ chronological });

    const context = await conversationModule.getConversationContext(
      "conv-boundary-over",
      20,
      299,
    );

    assert.equal(context.droppedForBudget, 1);
    assert.deepEqual(
      context.messages.map((m) => m.content),
      [chronological[1].content, chronological[2].content],
    );
  });

  it("drops oldest messages first when over budget", async () => {
    const chronological = buildMessages(5); // 500 tokens
    primeDb({ chronological });

    const context = await conversationModule.getConversationContext(
      "conv-2",
      20,
      250,
    );

    // 500 → drop m1 (400) → drop m2 (300) → drop m3 (200 ≤ 250).
    assert.equal(context.droppedForBudget, 3);
    assert.equal(context.overBudget, false);
    assert.deepEqual(
      context.messages.map((m) => m.content),
      [chronological[3].content, chronological[4].content],
    );
  });

  it("counts the injected summary toward the budget", async () => {
    const chronological = buildMessages(4); // 400 tokens — fits a 450 budget alone
    primeDb({
      chronological,
      summary: SUMMARY_100_TOKENS,
      summaryUpToMessageId: "m0-older-than-window",
      totalCount: 40, // more messages exist → summary is injected
    });

    const context = await conversationModule.getConversationContext(
      "conv-3",
      4,
      450,
    );

    // 100 (summary) + 400 = 500 > 450 → the summary's tokens force one drop.
    assert.equal(context.summaryInjected, true);
    assert.equal(context.droppedForBudget, 1);
    assert.equal(context.overBudget, false);
    assert.match(context.messages[0].content, /^\[Previous conversation summary:/);
    assert.deepEqual(
      context.messages.slice(1).map((m) => m.content),
      [chronological[1].content, chronological[2].content, chronological[3].content],
    );
  });

  it("always retains the summary plus the 2 newest messages, flagging overBudget", async () => {
    const chronological = buildMessages(6);
    primeDb({
      chronological,
      summary: SUMMARY_100_TOKENS,
      summaryUpToMessageId: "m0-older-than-window",
      totalCount: 40,
    });

    const context = await conversationModule.getConversationContext(
      "conv-4",
      6,
      10, // impossible budget: even summary + 2 newest exceed it
    );

    assert.equal(context.droppedForBudget, 4);
    assert.equal(context.overBudget, true);
    assert.equal(context.summaryInjected, true);
    assert.equal(context.messages.length, 3); // summary + 2 newest
    assert.match(context.messages[0].content, /^\[Previous conversation summary:/);
    assert.deepEqual(
      context.messages.slice(1).map((m) => m.content),
      [chronological[4].content, chronological[5].content],
    );
    assert.equal(mockLoggerWarn.mock.callCount(), 1);
    assert.equal(mockLoggerWarn.mock.calls[0].arguments[0], "sage.history.over_budget");
  });

  it("flags overBudget without trimming when only 2 oversized messages exist", async () => {
    const chronological = buildMessages(2); // 200 tokens
    primeDb({ chronological });

    const context = await conversationModule.getConversationContext(
      "conv-5",
      20,
      50,
    );

    assert.equal(context.droppedForBudget, 0);
    assert.equal(context.overBudget, true);
    assert.equal(context.messages.length, 2);
    assert.equal(mockLoggerInfo.mock.callCount(), 0); // nothing was dropped
    assert.equal(mockLoggerWarn.mock.callCount(), 1);
  });

  it("logs how many dropped messages the rolling summary does not cover", async () => {
    const chronological = buildMessages(6); // 600 tokens
    primeDb({
      chronological,
      summary: SUMMARY_100_TOKENS,
      summaryUpToMessageId: "m2", // summary covers m1–m2 within the window
      totalCount: 40,
    });

    const context = await conversationModule.getConversationContext(
      "conv-6",
      6,
      400,
    );

    // 100 (summary) + 600 = 700 → drop m1 (600) → m2 (500) → m3 (400 ≤ 400).
    assert.equal(context.droppedForBudget, 3);
    assert.equal(mockLoggerInfo.mock.callCount(), 1);
    const [event, meta] = mockLoggerInfo.mock.calls[0].arguments as [
      string,
      Record<string, unknown>,
    ];
    assert.equal(event, "sage.history.trim");
    assert.equal(meta.droppedForBudget, 3);
    // m1 and m2 are compressed into the summary; only m3 is real loss.
    assert.equal(meta.droppedUncoveredBySummary, 1);
    assert.equal(meta.keptMessages, 3);
    assert.equal(meta.summaryInjected, true);
    assert.equal(meta.overBudget, false);
  });
});
