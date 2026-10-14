import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

const regionClasses = mock.fn(async (_id: string) => ["a", "b", "c", "untaught"]);
const instructor = (id: string) => ({ id, studentId: `public-${id}`, displayName: id, email: null });
const row = (id: string, classId: string) => ({ instructorId: id, classId, instructor: instructor(id) });
const instructors = mock.fn(async (_args: unknown) => [row("one", "a"), row("one", "b"), row("two", "b"), row("three", "c")]);
const active = mock.fn(async (_args: unknown) => [{ classId: "a", _count: 2 }, { classId: "b", _count: 1 }]);
const enrollments = mock.fn(async (_args: unknown) => [
  { classId: "a", studentId: "shared" },
  { classId: "b", studentId: "shared" },
  { classId: "a", studentId: "other" },
  { classId: "b", studentId: "inactive" },
]);
const alerts = mock.fn(async (_args: unknown) => [
  { studentId: "shared", detectedAt: new Date(0), resolvedAt: new Date(86_400_000) },
  { studentId: "other", detectedAt: new Date(0), resolvedAt: new Date(3 * 86_400_000) },
  { studentId: "inactive", detectedAt: new Date(0), resolvedAt: new Date(2 * 86_400_000) },
]);
const certs = mock.fn(async (_args: unknown) => [] as { studentId: string; _count: number }[]);
const assignments = mock.fn(async (_args: unknown) => [{ targetId: "a", _count: 2 }, { targetId: "b", _count: 1 }]);
const responses = mock.fn(async (_args: unknown) => [{ studentId: "shared", _count: 3 }, { studentId: "inactive", _count: 1 }]);
const queries = [instructors, active, enrollments, alerts, certs, assignments, responses];

mock.module("server-only", { defaultExport: {} });
mock.module("@/lib/region", { namedExports: { classIdsInRegion: regionClasses } });
mock.module("@/lib/db", { namedExports: { prisma: {
  spokesClassInstructor: { findMany: instructors },
  studentClassEnrollment: { groupBy: active, findMany: enrollments },
  studentAlert: { findMany: alerts },
  certification: { groupBy: certs },
  formAssignment: { groupBy: assignments },
  formResponse: { groupBy: responses },
} } });
let list: typeof import("./instructor-metrics").listInstructorMetricsForRegion;
before(async () => { list = (await import("./instructor-metrics")).listInstructorMetricsForRegion; });
beforeEach(() => {
  regionClasses.mock.resetCalls();
  for (const query of queries) query.mock.resetCalls();
  certs.mock.mockImplementationOnce(async () => [
    { studentId: "shared", _count: 2 }, { studentId: "other", _count: 1 },
  ], 0);
  certs.mock.mockImplementationOnce(async () => [
    { studentId: "shared", _count: 1 }, { studentId: "inactive", _count: 2 },
  ], 1);
});

test("batched metrics preserve overlap, inactive membership, rounding and null denominators", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 10) });
  const result = await list("region");
  assert.deepEqual(result, [
    { instructor: instructor("one"), activeStudents: 3, alertResponseDays: 2, certPassRate: 1, formCompletionRate: 1.333, classCount: 2 },
    { instructor: instructor("two"), activeStudents: 1, alertResponseDays: 1.5, certPassRate: 1.5, formCompletionRate: 4, classCount: 1 },
    { instructor: instructor("three"), activeStudents: 0, alertResponseDays: null, certPassRate: null, formCompletionRate: null, classCount: 1 },
  ]);
  assert.equal(queries.reduce((sum, fn) => sum + fn.mock.callCount(), 0), 8);
  assert.deepEqual(instructors.mock.calls[0].arguments[0], {
    where: { classId: { in: ["a", "b", "c", "untaught"] } },
    select: { instructorId: true, classId: true, instructor: { select: { id: true, studentId: true, displayName: true, email: true } } },
  });
  const classes = { in: ["a", "b", "c"] };
  const student = { classEnrollments: { some: { classId: classes } } };
  const since = new Date(Date.now() - 90 * 86_400_000);
  assert.deepEqual(active.mock.calls[0].arguments[0], {
    by: ["classId"], where: { classId: classes, status: "active", student: { isActive: true } }, _count: true,
  });
  assert.deepEqual(enrollments.mock.calls[0].arguments[0], {
    where: { classId: classes }, select: { classId: true, studentId: true },
  });
  assert.deepEqual(alerts.mock.calls[0].arguments[0], {
    where: { status: "resolved", resolvedAt: { not: null }, student },
    select: { studentId: true, detectedAt: true, resolvedAt: true },
  });
  assert.deepEqual(certs.mock.calls.map((call) => call.arguments[0]), [
    { by: ["studentId"], where: { startedAt: { gte: since }, student }, _count: true },
    { by: ["studentId"], where: { status: "completed", completedAt: { gte: since }, student }, _count: true },
  ]);
  assert.deepEqual(assignments.mock.calls[0].arguments[0], {
    by: ["targetId"], where: { scope: "class", targetId: classes, createdAt: { gte: since } }, _count: true,
  });
  assert.deepEqual(responses.mock.calls[0].arguments[0], {
    by: ["studentId"], where: { createdAt: { gte: since }, status: { in: ["submitted", "reviewed"] }, student }, _count: true,
  });
});

test("query count stays fixed for 100 instructors sharing classes", async () => {
  instructors.mock.mockImplementationOnce(async () => Array.from({ length: 100 }, (_, i) => row(`i${i}`, "a")));
  assert.equal((await list("region")).length, 100);
  assert.equal(queries.reduce((sum, fn) => sum + fn.mock.callCount(), 0), 8);
  assert.equal(regionClasses.mock.callCount(), 1);
});

test("empty region fails closed without metric queries", async () => {
  regionClasses.mock.mockImplementationOnce(async () => []);
  assert.deepEqual(await list("empty"), []);
  assert.equal(queries.reduce((sum, fn) => sum + fn.mock.callCount(), 0), 0);
});

test("region with no instructors skips all metric queries", async () => {
  instructors.mock.mockImplementationOnce(async () => []);
  assert.deepEqual(await list("region"), []);
  assert.equal(queries.reduce((sum, fn) => sum + fn.mock.callCount(), 0), 1);
});
