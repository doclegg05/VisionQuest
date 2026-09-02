/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// ---------------------------------------------------------------------------
// applyGoalTransition — the ONE goal status transition path shared by
// PATCH /api/goals/[id] and the Sage `update_goal_status` write tool
// (2026-09-01 review F22 / VQ-R-011 and F23 / VQ-R-005).
//
// Effects under test: the Goal write, `goals:<studentId>` cache invalidation,
// level-set progression, and BHAG-completed XP. Chat-context invalidation is
// write-through in src/lib/db.ts (Goal is a watched model), so it is not
// asserted here.
// ---------------------------------------------------------------------------

const mockGoalUpdate = mock.fn() as any;
const mockInvalidatePrefix = mock.fn() as any;
const mockEnsureGoalLevelProgression = mock.fn(async () => 0) as any;
const mockUpdateProgression = mock.fn(async () => ({})) as any;
const mockRecordBhagCompleted = mock.fn() as any;

mock.module("@/lib/db", { namedExports: { prisma: { goal: { update: mockGoalUpdate } } } });
mock.module("@/lib/cache", { namedExports: { invalidatePrefix: mockInvalidatePrefix } });
mock.module("@/lib/goal-progression", {
  namedExports: { ensureGoalLevelProgression: mockEnsureGoalLevelProgression },
});
mock.module("@/lib/progression/service", { namedExports: { updateProgression: mockUpdateProgression } });
mock.module("@/lib/progression/engine", { namedExports: { recordBhagCompleted: mockRecordBhagCompleted } });

let helper: typeof import("./transition-goal-status");

before(async () => {
  helper = await import("./transition-goal-status");
});

const STUDENT = { kind: "student", id: "stu-1" } as const;
const STAFF = { kind: "staff", id: "tch-1" } as const;

type Snapshot = import("./transition-goal-status").GoalTransitionSnapshot;

function goal(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: "goal-1",
    studentId: "stu-1",
    level: "weekly",
    status: "active",
    sourceMessageId: null,
    ...overrides,
  };
}

function resetAll() {
  mockGoalUpdate.mock.resetCalls();
  mockInvalidatePrefix.mock.resetCalls();
  mockEnsureGoalLevelProgression.mock.resetCalls();
  mockUpdateProgression.mock.resetCalls();
  mockRecordBhagCompleted.mock.resetCalls();
  mockGoalUpdate.mock.mockImplementation(async ({ where, data }: any) => ({ ...goal(), id: where.id, ...data }));
}

describe("goalActorFor", () => {
  it("maps a student session to a student actor and staff roles to a staff actor", () => {
    assert.deepEqual(helper.goalActorFor({ id: "stu-1", role: "student" }), STUDENT);
    assert.deepEqual(helper.goalActorFor({ id: "tch-1", role: "teacher" }), STAFF);
    assert.deepEqual(helper.goalActorFor({ id: "adm-1", role: "admin" }), { kind: "staff", id: "adm-1" });
  });
});

describe("applyGoalTransition — effects (F22)", () => {
  beforeEach(resetAll);

  it("writes the status, invalidates the goals cache, and records level progression", async () => {
    const result = await helper.applyGoalTransition({ actor: STUDENT, goal: goal(), request: { to: "completed" } });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.changed, true);
    assert.equal(mockGoalUpdate.mock.callCount(), 1);
    const call = mockGoalUpdate.mock.calls[0].arguments[0];
    assert.deepEqual(call.where, { id: "goal-1" });
    assert.equal(call.data.status, "completed");
    assert.deepEqual(mockInvalidatePrefix.mock.calls.map((c: any) => c.arguments[0]), ["goals:stu-1"]);
    assert.equal(mockEnsureGoalLevelProgression.mock.callCount(), 1);
    assert.deepEqual(mockEnsureGoalLevelProgression.mock.calls[0].arguments, ["stu-1", ["weekly"]]);
    assert.equal(mockUpdateProgression.mock.callCount(), 0, "non-BHAG completion awards no BHAG XP");
  });

  it("awards BHAG XP through updateProgression when a BHAG is completed", async () => {
    const bhag = goal({ level: "bhag", status: "confirmed" });
    mockGoalUpdate.mock.mockImplementation(async ({ data }: any) => ({ ...bhag, ...data }));

    const result = await helper.applyGoalTransition({ actor: STUDENT, goal: bhag, request: { to: "completed" } });

    assert.equal(result.ok, true);
    assert.equal(mockUpdateProgression.mock.callCount(), 1);
    assert.equal(mockUpdateProgression.mock.calls[0].arguments[0], "stu-1");
    // The mutate handed to updateProgression is the BHAG-completed engine step.
    const mutate = mockUpdateProgression.mock.calls[0].arguments[1];
    const stateStub = {};
    mutate(stateStub);
    assert.equal(mockRecordBhagCompleted.mock.callCount(), 1);
    assert.equal(mockRecordBhagCompleted.mock.calls[0].arguments[0], stateStub);
  });

  it("skips level progression when the new status does not count toward the plan", async () => {
    await helper.applyGoalTransition({ actor: STUDENT, goal: goal(), request: { to: "abandoned" } });

    assert.equal(mockGoalUpdate.mock.callCount(), 1);
    assert.equal(mockInvalidatePrefix.mock.callCount(), 1);
    assert.equal(mockEnsureGoalLevelProgression.mock.callCount(), 0);
  });

  it("writes nothing when the requested status is already the current one", async () => {
    const result = await helper.applyGoalTransition({ actor: STUDENT, goal: goal(), request: { to: "active" } });

    assert.deepEqual(result, { ok: true, changed: false });
    assert.equal(mockGoalUpdate.mock.callCount(), 0);
    assert.equal(mockInvalidatePrefix.mock.callCount(), 0);
    assert.equal(mockEnsureGoalLevelProgression.mock.callCount(), 0);
  });

  it("merges non-status fields into the same write", async () => {
    const reviewedAt = new Date("2026-09-01T12:00:00Z");
    await helper.applyGoalTransition({
      actor: STUDENT,
      goal: goal(),
      request: {},
      fields: { content: "New wording", lastReviewedAt: reviewedAt },
    });

    assert.equal(mockGoalUpdate.mock.callCount(), 1);
    const data = mockGoalUpdate.mock.calls[0].arguments[0].data;
    assert.equal(data.content, "New wording");
    assert.equal(data.lastReviewedAt, reviewedAt);
    assert.equal(data.status, undefined);
    assert.equal(mockInvalidatePrefix.mock.callCount(), 1);
  });

  it("uses the goal's studentId, not the actor's, for cache and progression side effects", async () => {
    await helper.applyGoalTransition({
      actor: STAFF,
      goal: goal({ studentId: "stu-2", status: "confirmed" }),
      request: { to: "completed" },
    });

    assert.deepEqual(mockInvalidatePrefix.mock.calls[0].arguments, ["goals:stu-2"]);
    assert.equal(mockEnsureGoalLevelProgression.mock.calls[0].arguments[0], "stu-2");
  });
});

describe("applyGoalTransition — confirmation rules", () => {
  beforeEach(resetAll);

  it("refuses a student confirming a Sage-proposed goal (existing 403 wording preserved)", async () => {
    const result = await helper.applyGoalTransition({
      actor: STUDENT,
      goal: goal({ status: "proposed", sourceMessageId: "msg-1" }),
      request: { confirm: true },
    });

    assert.deepEqual(result, {
      ok: false,
      kind: "forbidden",
      message: "Sage suggested this goal — ask your instructor to confirm it.",
    });
    assert.equal(mockGoalUpdate.mock.callCount(), 0);
  });

  it("treats status: 'confirmed' as a confirmation request", async () => {
    const result = await helper.applyGoalTransition({
      actor: STUDENT,
      goal: goal({ status: "proposed", sourceMessageId: "msg-1" }),
      request: { to: "confirmed" },
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.kind, "forbidden");
    assert.equal(mockGoalUpdate.mock.callCount(), 0);
  });

  it("lets a student confirm a goal they created themselves and stamps confirmedBy", async () => {
    const result = await helper.applyGoalTransition({ actor: STUDENT, goal: goal({ status: "active" }), request: { confirm: true } });

    assert.equal(result.ok, true);
    const data = mockGoalUpdate.mock.calls[0].arguments[0].data;
    assert.equal(data.status, "confirmed");
    assert.equal(data.confirmedBy, "stu-1");
    assert.ok(data.confirmedAt instanceof Date);
  });

  it("lets staff confirm a Sage-proposed goal and stamps the staff id", async () => {
    const result = await helper.applyGoalTransition({
      actor: STAFF,
      goal: goal({ status: "proposed", sourceMessageId: "msg-1" }),
      request: { confirm: true },
    });

    assert.equal(result.ok, true);
    const data = mockGoalUpdate.mock.calls[0].arguments[0].data;
    assert.equal(data.status, "confirmed");
    assert.equal(data.confirmedBy, "tch-1");
  });

  it("refuses confirmation from a status that is not confirmable", async () => {
    const result = await helper.applyGoalTransition({ actor: STAFF, goal: goal({ status: "completed" }), request: { confirm: true } });

    assert.deepEqual(result, { ok: false, kind: "invalid", message: "Cannot confirm a goal with status 'completed'." });
    assert.equal(mockGoalUpdate.mock.callCount(), 0);
  });
});
