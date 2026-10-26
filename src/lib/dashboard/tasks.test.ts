import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Prisma, StudentTask } from "@prisma/client";
import type { Session } from "@/lib/api-error";
import { bulkTaskSchema, createTaskSchema, taskQuerySchema, updateTaskSchema } from "./task-schemas";

const session: Session = { id: "student-a", studentId: "student-a", role: "student", displayName: "Synthetic" };
const version = "2026-09-10T12:00:00.000Z";
const id1 = "cm00000000000000000000001";
const id2 = "cm00000000000000000000002";
function task(id = id1, overrides: Partial<StudentTask> = {}): StudentTask {
  return { id, studentId: session.id, createdById: session.id, appointmentId: null, title: "Practice interview", description: null, dueAt: null, status: "open", priority: "normal", completedAt: null, createdAt: new Date(version), updatedAt: new Date(version), ...overrides };
}
let rows: StudentTask[] = [];
let staffAllowed = true;
let conflictOnWrite = false;
let failSync = false;
let auditOk = true;
let lastListArgs: unknown;
const audit = mock.fn(async (_input?: unknown) => ({ audited: auditOk }));
const sync = mock.fn(async () => { if (failSync) throw new Error("sync unavailable"); });
const tx = {
  student: { findFirst: mock.fn(async () => staffAllowed ? { id: session.id } : null) },
  appointment: { findFirst: async () => null },
  studentTask: {
    findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
    findFirst: async ({ where }: { where: { id: string; studentId: string } }) => rows.find((r) => r.id === where.id && r.studentId === where.studentId) ?? null,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id)!,
    count: async () => rows.length,
    findMany: async (args: { skip: number; take: number }) => { lastListArgs = args; return rows.slice(args.skip, args.skip + args.take); },
    create: async ({ data }: { data: Partial<StudentTask> }) => { const row = task(id2, data); rows.push(row); return row; },
    updateMany: async ({ where, data }: { where: { id: string; updatedAt: Date }; data: Partial<StudentTask> }) => {
      const row = rows.find((r) => r.id === where.id && r.updatedAt.getTime() === where.updatedAt.getTime());
      if (!row || conflictOnWrite) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    },
    deleteMany: async ({ where }: { where: { id: string } }) => { rows = rows.filter((r) => r.id !== where.id); return { count: 1 }; },
  },
};
mock.module("@/lib/db", { namedExports: {
  prisma: {},
  withAppTransaction: async (work: (client: Prisma.TransactionClient) => Promise<unknown>) => {
    const snapshot = structuredClone(rows);
    try { return await work(tx as unknown as Prisma.TransactionClient); }
    catch (error) { rows = snapshot; throw error; }
  },
} });
mock.module("@/lib/auth", { namedExports: { getSession: async () => session } });
mock.module("@/lib/advising", { namedExports: { syncStudentAlerts: sync } });
mock.module("@/lib/audit", { namedExports: { tryLogAuditEvent: audit } });
let service: typeof import("./tasks");
before(async () => { service = await import("./tasks"); });
beforeEach(() => { rows = [task(), task(id2)]; staffAllowed = true; conflictOnWrite = false; failSync = false; auditOk = true; audit.mock.resetCalls(); sync.mock.resetCalls(); });

describe("task input boundaries", () => {
  it("rejects unknown ownership, oversized text, impossible dates and invalid enums", () => {
    for (const body of [{ title: "x", studentId: "other" }, { title: "x".repeat(161) }, { title: "x", dueAt: "2026-02-30" }, { title: "x", status: "verified" }, { title: "x", priority: "urgent" }, { title: "x", description: "x".repeat(2001) }]) assert.equal(createTaskSchema.safeParse(body).success, false);
    assert.equal(updateTaskSchema.safeParse({ status: "verified" }).success, false);
    assert.equal(updateTaskSchema.safeParse({}).success, false);
    assert.deepEqual(updateTaskSchema.parse({ status: "completed" }), { status: "completed" });
  });
  it("bounds pagination, filters, sort and bulk atomic units", () => {
    for (const query of [{ page: 0 }, { page: 1.2 }, { pageSize: 26 }, { sort: "studentId" }, { direction: "sideways" }, { status: "verified" }, { extra: "x" }]) assert.equal(taskQuerySchema.safeParse(query).success, false);
    assert.equal(taskQuerySchema.parse({ page: "2", pageSize: "10" }).page, 2);
    assert.equal(bulkTaskSchema.safeParse({ status: "completed", tasks: Array.from({ length: 26 }, () => ({ id: id1, updatedAt: version })) }).success, false);
    assert.equal(bulkTaskSchema.safeParse({ status: "open", tasks: [{ id: id1, updatedAt: version }, { id: id1, updatedAt: version }] }).success, false);
  });
});
function auditCalls() { return audit.mock.calls.map((c) => c.arguments[0] as Record<string, unknown>); }
describe("task audit rows", () => {
  it("files every row under the student with a readable summary and the task id in metadata", async () => {
    await service.createPersonalTask(session, createTaskSchema.parse({ title: "Call the shelter" }));
    await service.updateTasks(session, [{ id: id1, patch: { status: "completed" } }]);
    await service.deletePersonalTask(session, id2, version);
    const [created, updated, deleted] = auditCalls();
    for (const row of [created, updated, deleted]) {
      assert.equal(row.targetType, "student"); assert.equal(row.targetId, session.id);
      assert.notEqual(row.summary, row.action);
    }
    assert.equal(created.action, "task.created"); assert.equal(created.summary, 'Created task "Call the shelter".');
    assert.equal(updated.action, "task.updated"); assert.equal(updated.summary, 'Updated task "Practice interview" to completed.');
    assert.equal(deleted.action, "task.deleted"); assert.equal(deleted.summary, 'Deleted task "Practice interview".');
    assert.equal((updated.metadata as { taskId: string }).taskId, id1);
  });
  it("writes one row per task on a bulk status change", async () => {
    await service.updateTasks(session, rows.map(({ id }) => ({ id, patch: { status: "completed", updatedAt: version } })));
    const bulk = auditCalls();
    assert.equal(bulk.length, 2);
    assert.deepEqual(bulk.map((r) => (r.metadata as { taskId: string }).taskId).sort(), [id1, id2]);
    assert.ok(bulk.every((r) => r.targetType === "student" && /^Updated task ".+" to completed\.$/.test(String(r.summary))));
  });
  it("uses main's follow-up wording when staff assign a task", async () => {
    await service.createAssignedTask({ ...session, id: "teacher-1", role: "teacher" }, session.id, createTaskSchema.parse({ title: "Bring ID" }));
    const [row] = auditCalls();
    assert.equal(row.targetType, "student"); assert.equal(row.targetId, session.id);
    assert.equal(row.summary, 'Created follow-up task "Bring ID".');
  });
});
describe("owned task mutations", () => {
  it("derives personal authorship from session and audits after commit", async () => {
    const result = await service.createPersonalTask(session, createTaskSchema.parse({ title: "  New task  ", dueAt: "2026-10-01" }));
    assert.equal(result.task.title, "New task"); assert.equal(rows.at(-1)?.createdById, session.id);
    assert.equal(result.task.dueAt, "2026-10-01T12:00:00.000Z");
    assert.equal(audit.mock.callCount(), 1); assert.equal(sync.mock.callCount(), 1);
  });
  it("rejects cross-student access and coordinator access", async () => {
    rows[0].studentId = "other";
    await assert.rejects(service.updateTasks(session, [{ id: id1, patch: { status: "completed" } }]), /Forbidden/);
    await assert.rejects(service.updateTasks({ ...session, role: "coordinator" }, [{ id: id2, patch: { status: "completed" } }]), /Forbidden/);
    assert.equal(audit.mock.callCount(), 0);
  });
  it("allows assignment status changes, never student detail edits or deletion", async () => {
    rows[0].createdById = "teacher";
    await assert.rejects(service.updateTasks(session, [{ id: id1, patch: { title: "Rewrite", updatedAt: version } }]), /instructor/);
    await assert.rejects(service.deletePersonalTask(session, id1, version), /instructor/);
    const result = await service.updateTasks(session, [{ id: id1, patch: { status: "completed" } }]);
    assert.equal(result.tasks[0].status, "completed"); assert.ok(result.tasks[0].completedAt);
    // The transaction stub has no certification delegate: task mutations cannot sign requirements.
  });
  it("checks staff scope inside the transaction", async () => {
    staffAllowed = false;
    await assert.rejects(service.updateTasks({ ...session, role: "teacher" }, [{ id: id1, patch: { status: "completed" } }]), /access/);
    await assert.rejects(service.createAssignedTask({ ...session, role: "teacher" }, session.id, createTaskSchema.parse({ title: "Assigned" })), /access/);
    assert.equal(audit.mock.callCount(), 0);
  });
  it("requires a version for detail edits and rejects stale versions and write races", async () => {
    await assert.rejects(service.updateTasks(session, [{ id: id1, patch: { title: "Edit" } }]), /Refresh/);
    await assert.rejects(service.updateTasks(session, [{ id: id1, patch: { status: "completed", updatedAt: "2026-09-09T12:00:00.000Z" } }]), /changed/);
    conflictOnWrite = true;
    await assert.rejects(service.updateTasks(session, [{ id: id1, patch: { status: "completed", updatedAt: version } }]), /changed/);
    assert.equal(audit.mock.callCount(), 0);
  });
  it("rolls back the entire bulk if a later task is not owned", async () => {
    rows[1].studentId = "other";
    await assert.rejects(service.updateTasks(session, rows.map(({ id }) => ({ id, patch: { status: "completed", updatedAt: version } }))), /Forbidden/);
    assert.equal(rows[0].status, "open"); assert.equal(audit.mock.callCount(), 0); assert.equal(sync.mock.callCount(), 0);
  });
  it("preserves completion date on idempotent completion and clears it on reopen", async () => {
    rows[0].status = "completed"; rows[0].completedAt = new Date(version);
    const completed = await service.updateTasks(session, [{ id: id1, patch: { status: "completed" } }]);
    assert.equal(completed.tasks[0].completedAt, version);
    const reopened = await service.updateTasks(session, [{ id: id1, patch: { status: "open" } }]);
    assert.equal(reopened.tasks[0].completedAt, null);
  });
  it("reports post-commit audit and alert failures without lying about saved work", async () => {
    auditOk = false; failSync = true;
    const result = await service.updateTasks(session, [{ id: id1, patch: { status: "completed" } }]);
    assert.equal(result.audited, false); assert.equal(result.alertsSynced, false); assert.equal(rows[0].status, "completed");
  });
  it("deletes only personal tasks with a matching version", async () => {
    await assert.rejects(service.deletePersonalTask(session, id1, "2025-01-01T00:00:00.000Z"), /changed/);
    await service.deletePersonalTask(session, id1, version);
    assert.equal(rows.length, 1); assert.equal(audit.mock.callCount(), 1);
  });
  it("lists with ownership, stable ordering, filters and explicit pagination", async () => {
    const result = await service.readTasks(session.id, taskQuerySchema.parse({ page: 2, pageSize: 1, search: "Practice", status: "open" }));
    assert.equal(result.tasks[0].id, id2); assert.equal(result.total, 2);
    assert.deepEqual(lastListArgs, { where: { studentId: session.id, status: "open", OR: [{ title: { contains: "Practice", mode: "insensitive" } }, { description: { contains: "Practice", mode: "insensitive" } }] }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], skip: 1, take: 1 });
  });
});
describe("single task read", () => {
  it("readTask returns the owner's task", async () => {
    const result = await service.readTask(session, id1);
    assert.equal(result.id, id1); assert.equal(result.updatedAt, version);
  });
  it("readTask hides another student's task as not found", async () => {
    rows[0].studentId = "other";
    await assert.rejects(service.readTask(session, id1), (error: { statusCode?: number }) => error.statusCode === 404);
  });
  it("readTask rejects staff sessions", async () => {
    await assert.rejects(service.readTask({ ...session, role: "teacher" }, id1), (error: { statusCode?: number }) => error.statusCode === 403);
  });
});
