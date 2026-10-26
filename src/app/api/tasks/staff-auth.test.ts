import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";
import type { Session } from "@/lib/api-error";
import { getRlsContext } from "@/lib/rls-context";

let session: Session | null = null;
const create = mock.fn(async (actor: Session, studentId: string) => {
  assert.equal(getRlsContext()?.userId, actor.id);
  assert.equal(studentId, "synthetic-student");
  return { task: { title: "Synthetic task", dueAt: null } };
});
const notify = mock.fn(async () => {});
mock.module("@/lib/auth", { namedExports: { getSession: async () => session } });
mock.module("@/lib/dashboard/tasks", { namedExports: { createAssignedTask: create } });
mock.module("@/lib/notifications", { namedExports: { sendNotification: notify } });
let route: typeof import("../teacher/students/[id]/tasks/route");
before(async () => { route = await import("../teacher/students/[id]/tasks/route"); });
beforeEach(() => { create.mock.resetCalls(); notify.mock.resetCalls(); });
function assign() {
  return route.POST(new Request("http://localhost/api/teacher/students/synthetic-student/tasks", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Synthetic task" }),
  }), { params: Promise.resolve({ id: "synthetic-student" }) });
}

test("assignment rejects anonymous, student, coordinator, and unknown roles before service or notification", async () => {
  for (const role of [null, "student", "coordinator", "unknown"]) {
    session = role ? { id: "synthetic-actor", studentId: "synthetic-actor", displayName: "Synthetic", role } : null;
    assert.equal((await assign()).status, role ? 403 : 401);
  }
  assert.equal(create.mock.callCount(), 0);
  assert.equal(notify.mock.callCount(), 0);
});

test("assignment passes authenticated teacher/admin and RLS identity to scoped service", async () => {
  for (const role of ["teacher", "admin"]) {
    session = { id: "synthetic-actor", studentId: "synthetic-actor", displayName: "Synthetic", role };
    assert.equal((await assign()).status, 200);
  }
  assert.equal(create.mock.callCount(), 2);
  assert.equal(notify.mock.callCount(), 2);
});
