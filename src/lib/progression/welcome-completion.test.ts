/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// ---------------------------------------------------------------------------
// recordWelcomeCompleted — W2: a real ledger-write failure must propagate,
// not collapse into the same `false` the idempotent "already recorded" path
// returns. See src/lib/progression/events.ts's `rethrowOnFailure` option.
// ---------------------------------------------------------------------------

const mockAwardEvent = mock.fn() as any;

mock.module("./events", {
  namedExports: {
    awardEvent: mockAwardEvent,
    getRecentEvents: mock.fn(),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      progressionEvent: { findUnique: mock.fn() },
      goal: { count: mock.fn() },
      conversation: { count: mock.fn() },
      orientationProgress: { count: mock.fn() },
    },
  },
});

let welcomeCompletion: Awaited<typeof import("./welcome-completion")>;

before(async () => {
  welcomeCompletion = await import("./welcome-completion");
});

describe("recordWelcomeCompleted", () => {
  beforeEach(() => {
    mockAwardEvent.mock.resetCalls();
  });

  it("opts into rethrowOnFailure so a real ledger-write failure propagates instead of returning false", async () => {
    mockAwardEvent.mock.mockImplementation(async () => {
      throw new Error("ledger write failed");
    });

    await assert.rejects(
      () => welcomeCompletion.recordWelcomeCompleted("stu-1", "chat"),
      /ledger write failed/,
    );

    assert.equal(mockAwardEvent.mock.callCount(), 1);
    const args = mockAwardEvent.mock.calls[0].arguments[0];
    assert.equal(args.rethrowOnFailure, true, "must opt in — awardEvent's default swallows failures");
    assert.equal(args.studentId, "stu-1");
    assert.deepEqual(args.metadata, { path: "chat" });
  });

  it("returns false (no throw) on an idempotent repeat", async () => {
    mockAwardEvent.mock.mockImplementation(async () => false);

    const result = await welcomeCompletion.recordWelcomeCompleted("stu-1", "chat");

    assert.equal(result, false);
  });

  it("returns true on first-time success", async () => {
    mockAwardEvent.mock.mockImplementation(async () => true);

    const result = await welcomeCompletion.recordWelcomeCompleted("stu-1", "orientation");

    assert.equal(result, true);
  });
});
