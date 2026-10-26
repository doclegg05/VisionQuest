/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Ticket D1 (2026-09-07): `fetchReadinessDataForStudents` is the batched
// sibling of `fetchStudentReadinessData` that the roster and class-progress
// panel now call instead of building their own readiness input. AC3's
// requirement is a query count that stays CONSTANT as the student count
// grows — one query per fact table, never one per student.
//
// One fixture dataset backs BOTH the batched (`findMany`/`groupBy`) and
// per-student (`findUnique`/`count`/`findFirst`) Prisma call shapes, so the
// "matches fetchStudentReadinessData" test below is a real cross-check
// against the same underlying rows, not two independently-typed mocks that
// could each look right while disagreeing with each other.

const ORIENTATION_TOTAL = 12;

const STUDENTS: Record<
  string,
  {
    progressionState: string | null;
    orientationDone: number;
    bhagCompleted: boolean;
    certificationsEarned: number;
    portfolioItemCount: number;
    hasResume: boolean;
    portfolioShared: boolean;
  }
> = {
  // Progression row present; every other fact live-only (empty stored state).
  s1: {
    progressionState: JSON.stringify({ certificationsEarned: 0, portfolioItemCount: 0 }),
    orientationDone: 6,
    bhagCompleted: false,
    certificationsEarned: 3,
    portfolioItemCount: 2,
    hasResume: true,
    portfolioShared: false,
  },
  // No Progression row at all — proves live facts still reach a student the
  // stored-state-only mapping would have scored as 0 across the board.
  s2: {
    progressionState: null,
    orientationDone: 0,
    bhagCompleted: true,
    certificationsEarned: 0,
    portfolioItemCount: 0,
    hasResume: false,
    portfolioShared: true,
  },
};

const progressionFindManyMock = mock.fn(async ({ where }: any) =>
  where.studentId.in
    .filter((id: string) => STUDENTS[id]?.progressionState != null)
    .map((id: string) => ({ studentId: id, state: STUDENTS[id].progressionState })),
) as any;
const progressionFindUniqueMock = mock.fn(async ({ where }: any) => {
  const student = STUDENTS[where.studentId];
  return student?.progressionState != null ? { state: student.progressionState } : null;
}) as any;

const orientationGroupByMock = mock.fn(async ({ where }: any) =>
  where.studentId.in
    .filter((id: string) => (STUDENTS[id]?.orientationDone ?? 0) > 0)
    .map((id: string) => ({ studentId: id, _count: STUDENTS[id].orientationDone })),
) as any;
const orientationCountMock = mock.fn(
  async ({ where }: any) => STUDENTS[where.studentId]?.orientationDone ?? 0,
) as any;
const orientationItemCountMock = mock.fn(async () => ORIENTATION_TOTAL) as any;

const goalFindManyMock = mock.fn(async ({ where }: any) =>
  where.studentId.in
    .filter((id: string) => STUDENTS[id]?.bhagCompleted)
    .map((id: string) => ({ studentId: id })),
) as any;
const goalFindFirstMock = mock.fn(async ({ where }: any) =>
  STUDENTS[where.studentId]?.bhagCompleted ? { id: "goal1" } : null,
) as any;

const certificationGroupByMock = mock.fn(async ({ where }: any) =>
  where.studentId.in
    .filter((id: string) => (STUDENTS[id]?.certificationsEarned ?? 0) > 0)
    .map((id: string) => ({ studentId: id, _count: STUDENTS[id].certificationsEarned })),
) as any;
const certificationCountMock = mock.fn(
  async ({ where }: any) => STUDENTS[where.studentId]?.certificationsEarned ?? 0,
) as any;

const portfolioItemGroupByMock = mock.fn(async ({ where }: any) =>
  where.studentId.in
    .filter((id: string) => (STUDENTS[id]?.portfolioItemCount ?? 0) > 0)
    .map((id: string) => ({ studentId: id, _count: STUDENTS[id].portfolioItemCount })),
) as any;
const portfolioItemCountMock = mock.fn(
  async ({ where }: any) => STUDENTS[where.studentId]?.portfolioItemCount ?? 0,
) as any;

const resumeDataFindManyMock = mock.fn(async ({ where }: any) =>
  where.studentId.in
    .filter((id: string) => STUDENTS[id]?.hasResume)
    .map((id: string) => ({ studentId: id })),
) as any;
const resumeDataFindUniqueMock = mock.fn(async ({ where }: any) =>
  STUDENTS[where.studentId]?.hasResume ? { id: "resume1" } : null,
) as any;

const publicCredentialPageFindManyMock = mock.fn(async ({ where }: any) =>
  where.studentId.in
    .filter((id: string) => STUDENTS[id]?.portfolioShared)
    .map((id: string) => ({ studentId: id })),
) as any;
const publicCredentialPageFindUniqueMock = mock.fn(async ({ where }: any) => ({
  isPublic: STUDENTS[where.studentId]?.portfolioShared ?? false,
})) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      progression: { findMany: progressionFindManyMock, findUnique: progressionFindUniqueMock },
      orientationProgress: { groupBy: orientationGroupByMock, count: orientationCountMock },
      orientationItem: { count: orientationItemCountMock },
      goal: { findMany: goalFindManyMock, findFirst: goalFindFirstMock },
      certification: { groupBy: certificationGroupByMock, count: certificationCountMock },
      portfolioItem: { groupBy: portfolioItemGroupByMock, count: portfolioItemCountMock },
      resumeData: { findMany: resumeDataFindManyMock, findUnique: resumeDataFindUniqueMock },
      publicCredentialPage: {
        findMany: publicCredentialPageFindManyMock,
        findUnique: publicCredentialPageFindUniqueMock,
      },
    },
  },
});

let fetchReadinessDataForStudents: typeof import("./fetch-readiness-data").fetchReadinessDataForStudents;
let fetchStudentReadinessData: typeof import("./fetch-readiness-data").fetchStudentReadinessData;
before(async () => {
  ({ fetchReadinessDataForStudents, fetchStudentReadinessData } = await import(
    "./fetch-readiness-data"
  ));
});

const batchedMocks = [
  progressionFindManyMock,
  orientationGroupByMock,
  orientationItemCountMock,
  goalFindManyMock,
  certificationGroupByMock,
  portfolioItemGroupByMock,
  resumeDataFindManyMock,
  publicCredentialPageFindManyMock,
];
const allMocks = [
  ...batchedMocks,
  progressionFindUniqueMock,
  orientationCountMock,
  goalFindFirstMock,
  certificationCountMock,
  portfolioItemCountMock,
  resumeDataFindUniqueMock,
  publicCredentialPageFindUniqueMock,
];

describe("fetchReadinessDataForStudents", () => {
  beforeEach(() => {
    for (const fn of allMocks) fn.mock.resetCalls();
  });

  it("issues exactly one query per fact table, no matter how many students are asked for", async () => {
    await fetchReadinessDataForStudents(["s1", "s2"]);
    for (const fn of batchedMocks) {
      assert.equal(fn.mock.callCount(), 1, "expected exactly one call per fact table");
    }

    for (const fn of batchedMocks) fn.mock.resetCalls();

    // 50 ids instead of 2 — the whole point of AC3 is that this does not
    // change the call count. An N+1 implementation would fail this line.
    const manyIds = Array.from({ length: 50 }, (_, i) => `student-${i}`);
    await fetchReadinessDataForStudents(manyIds);
    for (const fn of batchedMocks) {
      assert.equal(fn.mock.callCount(), 1, "expected exactly one call per fact table for 50 students");
    }
  });

  it("issues no queries at all for an empty id list", async () => {
    const result = await fetchReadinessDataForStudents([]);
    assert.equal(result.size, 0);
    for (const fn of batchedMocks) {
      assert.equal(fn.mock.callCount(), 0);
    }
  });

  it("scopes every per-student query to the requested ids via studentId: { in: ids }, and the global count with none", async () => {
    await fetchReadinessDataForStudents(["s1", "s2"]);

    assert.deepEqual(progressionFindManyMock.mock.calls[0].arguments[0].where, {
      studentId: { in: ["s1", "s2"] },
    });
    assert.deepEqual(orientationGroupByMock.mock.calls[0].arguments[0].where, {
      studentId: { in: ["s1", "s2"] },
      completed: true,
    });
    assert.deepEqual(goalFindManyMock.mock.calls[0].arguments[0].where, {
      studentId: { in: ["s1", "s2"] },
      level: "bhag",
      status: "completed",
    });
    assert.deepEqual(certificationGroupByMock.mock.calls[0].arguments[0].where, {
      studentId: { in: ["s1", "s2"] },
      status: "completed",
    });
    assert.deepEqual(portfolioItemGroupByMock.mock.calls[0].arguments[0].where, {
      studentId: { in: ["s1", "s2"] },
    });
    assert.deepEqual(resumeDataFindManyMock.mock.calls[0].arguments[0].where, {
      studentId: { in: ["s1", "s2"] },
    });
    assert.deepEqual(publicCredentialPageFindManyMock.mock.calls[0].arguments[0].where, {
      studentId: { in: ["s1", "s2"] },
      isPublic: true,
    });
    // orientationItem.count() is a program-wide total, not per-student —
    // deliberately no studentId filter.
    assert.equal(orientationItemCountMock.mock.callCount(), 1);
    assert.deepEqual(orientationItemCountMock.mock.calls[0].arguments, []);
  });

  it("returns one entry per requested id, reconciling live rows over the stored state (s1) and for a student with no Progression row at all (s2)", async () => {
    const result = await fetchReadinessDataForStudents(["s1", "s2"]);
    assert.equal(result.size, 2);

    const s1 = result.get("s1")!;
    assert.equal(s1.orientationProgress.completed, 6);
    assert.equal(s1.orientationProgress.total, ORIENTATION_TOTAL);
    assert.equal(s1.bhagCompleted, false);
    assert.ok(s1.readiness.score > 0);

    // s2: no progression row, no orientation, no certs/portfolio/resume, but
    // IS bhag-completed and portfolio-shared — proving those live facts
    // reach a student with no Progression row, rather than the implicit 0
    // the pre-Ticket-D1 class-progress loop produced by skipping them.
    const s2 = result.get("s2")!;
    assert.equal(s2.orientationProgress.completed, 0);
    assert.equal(s2.orientationProgress.total, ORIENTATION_TOTAL);
    assert.equal(s2.bhagCompleted, true);
    assert.equal(s2.readiness.breakdown.bhagAchieved.score, 20);
    assert.equal(s2.readiness.breakdown.portfolio.score, 4); // portfolioShared only, +4
  });

  it("matches fetchStudentReadinessData for the same student — the batched loader is not a second mapping", async () => {
    for (const id of ["s1", "s2"]) {
      const [batched, single] = await Promise.all([
        fetchReadinessDataForStudents([id]),
        fetchStudentReadinessData(id),
      ]);
      assert.deepEqual(batched.get(id), single, `${id} disagreed between batched and per-student`);
    }
  });
});
