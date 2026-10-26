import assert from "node:assert/strict";
import { before, beforeEach, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { getRlsContext } from "@/lib/rls-context";

let session: Session | null = null;
let calls = 0;
let taskOwner = "student-a";
const id = "cm00000000000000000000001";
const version = new Date("2026-09-10T12:00:00.000Z");
const task = () => ({ id, studentId: taskOwner, createdById: taskOwner, appointmentId: null, title: "Synthetic", description: null, dueAt: null, status: "open", priority: "normal", completedAt: null, createdAt: version, updatedAt: version });
mock.module("@/lib/auth", { namedExports: { getSession: async () => session } });
mock.module("@/lib/db", { namedExports: {
  prisma: {},
  withAppTransaction: async (work: (tx: unknown) => Promise<unknown>) => {
    calls++;
    assert.equal(getRlsContext()?.userId, session?.id, "withAuth must seed the restricted-role context");
    return work({ studentTask: { count: async () => 1, findMany: async () => [task()], findUnique: async () => task(), updateMany: async () => ({ count: 1 }), findUniqueOrThrow: async () => task(), create: async () => task() } });
  },
} });
mock.module("@/lib/advising", { namedExports: { syncStudentAlerts: async () => {} } });
mock.module("@/lib/audit", { namedExports: { tryLogAuditEvent: async () => ({ audited: true }) } });
let routes: typeof import("./route");
let item: typeof import("./[id]/route");
let bulk: typeof import("./bulk-status/route");
before(async () => { routes = await import("./route"); item = await import("./[id]/route"); bulk = await import("./bulk-status/route"); });
beforeEach(() => { session = { id: "student-a", studentId: "student-a", role: "student", displayName: "Synthetic" }; calls = 0; taskOwner = "student-a"; });
const request = (path = "", body?: unknown, method = "POST") => new Request(`http://localhost/api/tasks${path}`, body === undefined ? undefined : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
it("all task methods reject an unauthenticated request before database access", async () => {
  session = null;
  for (const response of [await routes.GET(request()), await routes.POST(request("", { title: "x" })), await item.PATCH(request(`/${id}`, { status: "completed" }, "PATCH"), { params: Promise.resolve({ id }) }), await item.DELETE(request(`/${id}`, { updatedAt: version.toISOString() }, "DELETE"), { params: Promise.resolve({ id }) }), await bulk.PATCH(request("/bulk-status", { status: "open", tasks: [] }, "PATCH"))]) assert.equal(response.status, 401);
  assert.equal(calls, 0);
});
it("student listing is no-store and authenticates before the transaction", async () => {
  const response = await routes.GET(request("?page=1&pageSize=10"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json(); assert.equal(body.total, 1); assert.equal(body.tasks[0].personal, true); assert.equal(calls, 1);
});
it("rejects staff self-listing, ownership injection, duplicate paging and malformed JSON", async () => {
  session!.role = "teacher"; assert.equal((await routes.GET(request())).status, 403); session!.role = "student";
  assert.equal((await routes.GET(request("?studentId=other"))).status, 400);
  assert.equal((await routes.GET(request("?page=1&page=2"))).status, 400);
  assert.equal((await routes.POST(request("", { title: "x", createdById: "teacher" }))).status, 400);
  assert.equal((await routes.POST(new Request("http://localhost/api/tasks", { method: "POST", body: "{" }))).status, 400);
  assert.equal(calls, 0);
});
it("preserves the legacy status PATCH envelope and rejects cross-student writes", async () => {
  const response = await item.PATCH(request(`/${id}`, { status: "completed" }, "PATCH"), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).task.id, id);
  taskOwner = "other";
  const forbidden = await item.PATCH(request(`/${id}`, { status: "completed" }, "PATCH"), { params: Promise.resolve({ id }) });
  assert.equal(forbidden.status, 403);
});
it("rejects bulk requests with no concurrency tokens before any writes", async () => {
  const response = await bulk.PATCH(request("/bulk-status", { status: "completed", tasks: [{ id }] }, "PATCH"));
  assert.equal(response.status, 400); assert.equal(calls, 0);
});
