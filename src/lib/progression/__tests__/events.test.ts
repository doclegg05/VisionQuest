/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// ---------------------------------------------------------------------------
// awardEvent — idempotency tests
//
// `awardEvent` keys idempotency on the unique constraint
//   (studentId, eventType, sourceType, sourceId)
// declared on ProgressionEvent. When Prisma raises P2002 on a duplicate
// insert, the function must return false and skip the state mutation.
//
// Covers Tests review #2 / #7 in the 2026-05-08 remediation pass.
// ---------------------------------------------------------------------------

const mockCreate = mock.fn() as any;
const mockDelete = mock.fn() as any;
const mockUpdateProgression = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      progressionEvent: {
        create: mockCreate,
        delete: mockDelete,
      },
    },
    prismaAdmin: {
      progressionEvent: {
        create: mockCreate,
        delete: mockDelete,
      },
    },
  },
});

mock.module("../service", {
  namedExports: {
    updateProgression: mockUpdateProgression,
  },
});

let events: Awaited<typeof import("../events")>;

before(async () => {
  events = await import("../events");
});

describe("awardEvent idempotency", () => {
  beforeEach(() => {
    mockCreate.mock.resetCalls();
    mockDelete.mock.resetCalls();
    mockUpdateProgression.mock.resetCalls();
    mockUpdateProgression.mock.mockImplementation(async () => undefined);
    mockDelete.mock.mockImplementation(async () => undefined);
  });

  it("the same (studentId, eventType, sourceType, sourceId) cannot award twice", async () => {
    let callCount = 0;
    mockCreate.mock.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return { id: "evt-1" };
      // Simulate Prisma's P2002 unique-constraint violation on the second
      // insert with the same key tuple.
      const err = Object.assign(new Error("Unique constraint violation"), {
        code: "P2002",
      });
      throw err;
    });
    const mutate = mock.fn();

    const first = await events.awardEvent({
      studentId: "stu-1",
      eventType: "chat_session",
      sourceType: "conversation",
      sourceId: "conv-1",
      xp: 10,
      mutate,
    });

    const second = await events.awardEvent({
      studentId: "stu-1",
      eventType: "chat_session",
      sourceType: "conversation",
      sourceId: "conv-1",
      xp: 10,
      mutate,
    });

    assert.equal(first, true, "first call should award");
    assert.equal(second, false, "duplicate call should no-op");
    // create was attempted both times (the unique key is enforced server-side).
    assert.equal(mockCreate.mock.callCount(), 2);
    // updateProgression should run exactly once — only on the successful insert.
    assert.equal(mockUpdateProgression.mock.callCount(), 1);
  });

  it("different sourceId values award independently", async () => {
    mockCreate.mock.mockImplementation(async () => ({ id: "evt-x" }));
    const mutate = mock.fn();

    const first = await events.awardEvent({
      studentId: "stu-1",
      eventType: "chat_session",
      sourceType: "conversation",
      sourceId: "conv-A",
      xp: 10,
      mutate,
    });

    const second = await events.awardEvent({
      studentId: "stu-1",
      eventType: "chat_session",
      sourceType: "conversation",
      sourceId: "conv-B",
      xp: 10,
      mutate,
    });

    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(mockCreate.mock.callCount(), 2);
    assert.equal(mockUpdateProgression.mock.callCount(), 2);
  });

  it("missing sourceId is silently allowed by the route — FLAGGED in PR body", async () => {
    // The function signature requires `sourceId: string` at TypeScript level
    // but does not validate it at runtime, so calling with an empty string
    // results in two events sharing the same `(studentId, eventType,
    // sourceType, "")` tuple. The DB unique constraint will catch the second
    // one, but at the route layer this means callers that forget to thread a
    // dedupe key get a single "first writer wins" award rather than an
    // explicit error. Documenting the current behavior here.
    let callCount = 0;
    mockCreate.mock.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return { id: "evt-empty-1" };
      const err = Object.assign(new Error("Unique constraint violation"), {
        code: "P2002",
      });
      throw err;
    });

    const first = await events.awardEvent({
      studentId: "stu-1",
      eventType: "chat_session",
      sourceType: "conversation",
      sourceId: "",
      xp: 10,
    });
    const second = await events.awardEvent({
      studentId: "stu-1",
      eventType: "chat_session",
      sourceType: "conversation",
      sourceId: "",
      xp: 10,
    });

    // First award succeeds; second collapses into a no-op via P2002.
    assert.equal(first, true);
    assert.equal(second, false);
  });

  it("returns false on non-P2002 Prisma errors and does NOT mutate progression", async () => {
    mockCreate.mock.mockImplementation(async () => {
      const err = Object.assign(new Error("some other DB error"), { code: "P9999" });
      throw err;
    });
    const mutate = mock.fn();

    const result = await events.awardEvent({
      studentId: "stu-1",
      eventType: "chat_session",
      sourceType: "conversation",
      sourceId: "conv-X",
      xp: 10,
      mutate,
    });

    assert.equal(result, false, "non-P2002 error should also return false");
    assert.equal(mockUpdateProgression.mock.callCount(), 0, "no state mutation on error");
  });

  it("rolls back the event row when updateProgression fails, so a retry re-applies", async () => {
    mockCreate.mock.mockImplementation(async () => ({ id: "evt-rollback" }));
    mockUpdateProgression.mock.mockImplementation(async () => {
      throw new Error("progression write hard-failed");
    });
    const mutate = mock.fn();

    await assert.rejects(
      () =>
        events.awardEvent({
          studentId: "stu-1",
          eventType: "cert_earned",
          sourceType: "certification",
          sourceId: "cert-1",
          xp: 100,
          mutate,
        }),
      /progression write hard-failed/,
    );

    // The just-created event row must be deleted so the unique constraint
    // doesn't block re-applying both the event and the mutation on retry.
    assert.equal(mockDelete.mock.callCount(), 1, "event row should be rolled back");
    assert.deepEqual(mockDelete.mock.calls[0].arguments[0], {
      where: { id: "evt-rollback" },
    });
  });
});
