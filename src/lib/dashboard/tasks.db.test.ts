import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";

// No runtime application imports before the opt-in and local-cluster guards.
const enabled = Boolean(process.env.DASHBOARD_RLS_DB_TEST);
describe("dashboard tasks — real local PostgreSQL/RLS", { skip: !enabled }, () => {
  let db: typeof import("@/lib/db");
  let service: typeof import("./tasks");
  let context: typeof import("@/lib/rls-context");
  let api: typeof import("@/lib/api-error");
  const a: Session = { id: "rls-a", studentId: "rls-a", role: "student", displayName: "Synthetic A" };
  const b: Session = { ...a, id: "rls-b", studentId: "rls-b" };
  const teacher: Session = { ...a, id: "rls-teacher", role: "teacher" };
  const version = "2026-01-01T00:00:00.000Z";
  const audit = mock.fn(async () => ({ audited: true }));
  const alerts = mock.fn(async () => undefined);
  const as = <T>(session: Session, work: () => T) => context.withRlsContext(api.rlsContextFor(session), work);
  const row = (id: string) => db.prismaAdmin.studentTask.findUniqueOrThrow({ where: { id } });
  const rejects = (promise: Promise<unknown>, status: number) => assert.rejects(promise, (e: unknown) => e instanceof api.ApiError && e.statusCode === status);

  before(async () => {
    const dir = process.env.DASHBOARD_RLS_CLUSTER!;
    assert.match(dir, /^\/tmp\/vq-task-rls-[A-Za-z0-9]+$/);
    assert.equal(readFileSync(`${dir}/marker`, "utf8"), process.env.DASHBOARD_RLS_DB_TEST);
    for (const [key, user] of [["DATABASE_URL", "vq_app"], ["ADMIN_DATABASE_URL", "postgres"]]) {
      const url = new URL(process.env[key]!);
      assert.equal(url.hostname, "localhost");
      assert.equal(url.username, user);
      assert.equal(url.pathname, "/dashboard_rls_disposable");
      assert.equal(url.port, "58371");
      assert.equal(realpathSync(url.searchParams.get("host")!), realpathSync(dir));
    }
    // Only post-commit integrations are mocked. Prisma, SQL, scope helper and transactions are real.
    mock.module("@/lib/advising", { namedExports: { syncStudentAlerts: alerts } });
    mock.module("@/lib/audit", { namedExports: { tryLogAuditEvent: audit } });
    db = await import("@/lib/db");
    context = await import("@/lib/rls-context");
    api = await import("@/lib/api-error");
    service = await import("./tasks");
    const marker = await db.prisma.$queryRawUnsafe<{ token: string }[]>("SELECT token FROM public.dashboard_rls_verification_marker");
    assert.equal(marker[0].token, process.env.DASHBOARD_RLS_DB_TEST);
    for (const session of [a, b, teacher]) await db.prismaAdmin.student.create({ data: { id: session.id, studentId: session.id, displayName: session.displayName, role: session.role } });
    await db.prismaAdmin.spokesClass.create({ data: { id: "rls-class", name: "Synthetic", code: "rls-class", instructors: { create: { instructorId: teacher.id } }, enrollments: { create: { studentId: a.id } } } });
  });
  after(async () => {
    if (db) await Promise.all([db.prisma.$disconnect(), db.prismaAdmin.$disconnect()]);
  });
  beforeEach(async () => {
    await db.prismaAdmin.studentTask.deleteMany();
    await db.prismaAdmin.studentTask.createMany({ data: [
      { id: "01-own", studentId: a.id, createdById: a.id, title: "Personal" },
      { id: "02-assigned", studentId: a.id, createdById: teacher.id, title: "Assigned" },
      { id: "99-other", studentId: b.id, createdById: b.id, title: "Other student" },
    ].map(task => ({ ...task, updatedAt: new Date(version) })) });
    audit.mock.resetCalls(); alerts.mock.resetCalls();
  });
  it("uses a non-owner, non-superuser, non-bypass role with authoritative RLS enabled", async () => {
    const roles = await db.prisma.$queryRawUnsafe<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean; owner: boolean; relrowsecurity: boolean }[]>(`SELECT current_user, r.rolsuper, r.rolbypassrls, c.relowner = r.oid AS owner, c.relrowsecurity FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname = current_user AND c.oid = 'visionquest."StudentTask"'::regclass`);
    assert.deepEqual(roles, [{ current_user: "vq_app", rolsuper: false, rolbypassrls: false, owner: false, relrowsecurity: true }]);
    assert.equal(await db.prisma.studentTask.count(), 0);
    await assert.rejects(db.withAppTransaction(tx => tx.studentTask.count()), /requires RLS context/);
    assert.equal(await as(a, () => db.withAppTransaction(tx => tx.studentTask.count())), 2);
    assert.equal(await as(b, () => db.withAppTransaction(tx => tx.studentTask.count())), 1);
    assert.equal(await db.prisma.studentTask.count(), 0, "transaction-local context must not leak");
  });
  it("enforces ownership in SQL even without service predicates", async () => {
    await as(a, async () => {
      assert.equal(await db.withAppTransaction(tx => tx.studentTask.findUnique({ where: { id: "99-other" } })), null);
      assert.equal((await db.withAppTransaction(tx => tx.studentTask.updateMany({ where: { id: "99-other" }, data: { title: "Attack" } }))).count, 0);
      assert.equal((await db.withAppTransaction(tx => tx.studentTask.deleteMany({ where: { id: "99-other" } }))).count, 0);
      await assert.rejects(db.withAppTransaction(tx => tx.studentTask.create({ data: { studentId: b.id, createdById: a.id, title: "Attack" } })), /row-level security/i);
      await assert.rejects(db.withAppTransaction(tx => tx.studentTask.updateMany({ where: { id: "01-own" }, data: { studentId: b.id } })), /row-level security/i);
      const query = (await import("./task-schemas")).taskQuerySchema.parse({});
      assert.equal((await service.readTasks(b.id, query)).total, 0);
      assert.equal((await service.readTasks(a.id, query)).total, 2);
      await rejects(service.updateTasks(a, [{ id: "99-other", patch: { status: "completed" } }]), 404);
    });
    assert.equal((await row("99-other")).title, "Other student");
  });
  it("supports personal create/edit/delete and protects assigned details at service level", async () => {
    await as(a, async () => {
      const created = await service.createPersonalTask(a, { title: "New", priority: "normal", description: "", dueAt: null });
      assert.equal(created.task.personal, true);
      const edited = await service.updateTasks(a, [{ id: created.task.id, patch: { title: "Edited", updatedAt: created.task.updatedAt } }]);
      await service.deletePersonalTask(a, created.task.id, edited.tasks[0].updatedAt);
      await rejects(service.updateTasks(a, [{ id: "02-assigned", patch: { title: "Attack", updatedAt: version } }]), 403);
      await rejects(service.deletePersonalTask(a, "02-assigned", version), 403);
      const result = await service.updateTasks(a, [{ id: "02-assigned", patch: { status: "completed", updatedAt: version } }]);
      assert.ok(result.tasks[0].completedAt);
    });
  });
  it("limits teachers to actual class enrollments under migrated policies", async () => {
    await as(teacher, async () => {
      const visible = await db.withAppTransaction(tx => tx.studentTask.findMany({ select: { id: true }, orderBy: { id: "asc" } }));
      assert.deepEqual(visible.map(t => t.id), ["01-own", "02-assigned"]);
      await service.updateTasks(teacher, [{ id: "01-own", patch: { title: "Teacher edit", updatedAt: version } }]);
      await service.createAssignedTask(teacher, a.id, { title: "New assignment", priority: "normal", description: "", dueAt: null });
      await rejects(service.updateTasks(teacher, [{ id: "99-other", patch: { status: "completed" } }]), 404);
      await rejects(service.createAssignedTask(teacher, b.id, { title: "Attack", priority: "normal", description: "", dueAt: null }), 403);
    });
  });
  it("rejects stale versions and allows exactly one concurrent writer", async () => {
    const results = await Promise.allSettled(["First", "Second"].map(title => as(a, () => service.updateTasks(a, [{ id: "01-own", patch: { title, updatedAt: version } }]))));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const loser = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(loser.reason instanceof api.ApiError);
    assert.equal(loser.reason.statusCode, 409);
    await rejects(as(a, () => service.deletePersonalTask(a, "01-own", version)), 409);
    assert.notEqual((await row("01-own")).updatedAt.toISOString(), version);
    assert.equal(audit.mock.callCount(), 1);
  });
  it("rolls back an earlier bulk write when a later row is RLS-invisible", async () => {
    await rejects(as(a, () => service.updateTasks(a, ["01-own", "99-other"].map(id => ({ id, patch: { status: "completed", updatedAt: version } })))), 404);
    const persisted = await row("01-own");
    assert.equal(persisted.status, "open"); assert.equal(persisted.completedAt, null);
    assert.equal(persisted.updatedAt.toISOString(), version);
    assert.equal(audit.mock.callCount(), 0); assert.equal(alerts.mock.callCount(), 0);
  });
  it("rolls back bulk writes on a later optimistic conflict", async () => {
    await rejects(as(a, () => service.updateTasks(a, [
      { id: "01-own", patch: { status: "completed", updatedAt: version } },
      { id: "02-assigned", patch: { status: "completed", updatedAt: "2025-01-01T00:00:00.000Z" } },
    ])), 409);
    assert.equal((await row("01-own")).updatedAt.toISOString(), version);
    assert.equal((await row("01-own")).status, "open");
    assert.equal(audit.mock.callCount(), 0);
  });
});
