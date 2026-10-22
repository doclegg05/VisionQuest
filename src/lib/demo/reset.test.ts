import assert from "node:assert/strict";
import { it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { resetDemoRoster } from "./reset";

function fixture(options: { realInstructor?: boolean; foreignClass?: boolean; mixedRoster?: boolean } = {}) {
  const writes: unknown[] = [];
  const students = [{ id: "demo-student", studentId: "demo-starter-1" }];
  const tx = {
    $executeRaw: async () => 1,
    student: {
      findUnique: async () => ({ id: "demo-teacher", role: "teacher", demoAccount: options.realInstructor ? null : "instructor" }),
      findMany: async (query: unknown) => { writes.push({ read: query }); return students; },
      updateMany: async (query: unknown) => { writes.push(query); return { count: 1 }; },
      update: async (query: unknown) => { writes.push(query); return {}; },
    },
    spokesClass: { findUnique: async () => ({ id: "demo-class", createdById: options.foreignClass ? "other" : "demo-teacher" }) },
    studentClassEnrollment: {
      count: async () => options.mixedRoster ? 1 : 0,
      updateMany: async (query: unknown) => { writes.push(query); return { count: 1 }; },
    },
  };
  const client = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient;
  return { client, writes };
}

it("previews without modifying rows", async () => {
  const { client, writes } = fixture();
  assert.deepEqual(await resetDemoRoster(client, { apply: false }), { students: 1, applied: false });
  assert.equal(writes.length, 1);
});
it("archives only marked demo students and their demo-class enrollments, preserving records", async () => {
  const { client, writes } = fixture();
  assert.deepEqual(await resetDemoRoster(client, { apply: true }), { students: 1, applied: true });
  assert.deepEqual(writes[1], {
    where: { classId: "demo-class", studentId: { in: ["demo-student"] }, student: { demoAccount: "student" } },
    data: { status: "archived", archivedAt: (writes[1] as { data: { archivedAt: Date } }).data.archivedAt, archiveReason: "Owner reset of fictional demo roster" },
  });
  assert.deepEqual(writes[2], {
    where: { id: { in: ["demo-student"] }, role: "student", demoAccount: "student" },
    data: { isActive: false, sessionVersion: { increment: 1 } },
  });
  assert.ok(JSON.stringify(writes).includes('"isActive":false'));
  assert.ok(JSON.stringify(writes).includes('"sessionVersion":{"increment":1}'));
  assert.ok(JSON.stringify(writes).includes('"status":"archived"'));
  assert.ok(JSON.stringify(writes).includes('"studentId":"demo-archived-demo-student"'));
});
for (const option of ["realInstructor", "foreignClass", "mixedRoster"] as const) {
  it(`refuses ${option} before changing any row`, async () => {
    const { client, writes } = fixture({ [option]: true });
    await assert.rejects(resetDemoRoster(client, { apply: true }));
    assert.equal(writes.filter((entry) => !(entry as { read?: unknown }).read).length, 0);
  });
}
