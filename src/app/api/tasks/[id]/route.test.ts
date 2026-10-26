import assert from "node:assert/strict";
import { before, beforeEach, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";

let session: Session | null = null;
const id = "cm00000000000000000000001";
const version = new Date("2026-09-10T12:00:00.000Z");
const row = { id, studentId: "student-a", createdById: "student-a", appointmentId: null, title: "Synthetic", description: null, dueAt: null, status: "open", priority: "normal", completedAt: null, createdAt: version, updatedAt: version };
mock.module("@/lib/auth", { namedExports: { getSession: async () => session } });
mock.module("@/lib/db", { namedExports: {
  prisma: {},
  withAppTransaction: async (work: (tx: unknown) => Promise<unknown>) => work({
    studentTask: { findFirst: async ({ where }: { where: { id: string; studentId: string } }) => (where.id === row.id && where.studentId === row.studentId ? row : null) },
  }),
} });
mock.module("@/lib/advising", { namedExports: { syncStudentAlerts: async () => {} } });
mock.module("@/lib/audit", { namedExports: { tryLogAuditEvent: async () => ({ audited: true }) } });
let item: typeof import("./route");
before(async () => { item = await import("./route"); });
beforeEach(() => { session = { id: "student-a", studentId: "student-a", role: "student", displayName: "Synthetic" }; });
const get = (target: string) => item.GET(new Request(`http://localhost/api/tasks/${target}`), { params: Promise.resolve({ id: target }) });

it("GET returns the owner's task", async () => {
  const response = await get(id);
  assert.equal(response.status, 200); assert.equal((await response.json()).task.id, id);
});
it("GET rejects a malformed id before reading", async () => {
  assert.equal((await get("not-a-cuid")).status, 400);
});
it("GET hides another student's task as 404", async () => {
  session = { id: "student-b", studentId: "student-b", role: "student", displayName: "Synthetic" };
  assert.equal((await get(id)).status, 404);
});
it("GET requires a session", async () => {
  session = null;
  assert.equal((await get(id)).status, 401);
});
