import assert from "node:assert/strict";
import { before, beforeEach, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { getRlsContext } from "@/lib/rls-context";

let session: Session | null = null;
let calls: string[] = [];
let unavailable = false;
const read = async (id: string) => {
  calls.push(id);
  assert.equal(getRlsContext()?.userId, session?.id);
  if (unavailable) throw new Error("Synthetic reader outage");
  return { fetchedAt: "2026-09-10T12:00:00.000Z" };
};
mock.module("@/lib/auth", { namedExports: { getSession: async () => session } });
mock.module("@/lib/db", { namedExports: { prisma: {}, withAppTransaction: async () => { throw new Error("Unexpected database access"); } } });
mock.module("@/lib/dashboard/readers", { namedExports: { readOverview: read, readActivity: read } });
mock.module("@/lib/dashboard/support", { namedExports: { readSupport: read } });
let routes: { GET: (request: Request) => Promise<Response> }[];
before(async () => { routes = await Promise.all([import("./overview/route"), import("./activity/route"), import("./support/route")]); });
beforeEach(() => { session = { id: "student-a", studentId: "student-a", role: "student", displayName: "Synthetic" }; calls = []; unavailable = false; });
it("dashboard readers authenticate and reject non-student roles before reading", async () => {
  for (const role of [null, "teacher", "admin", "coordinator"] as const) {
    session = role ? { id: "staff", studentId: "staff", role, displayName: "Synthetic" } : null;
    for (const route of routes) assert.equal((await route.GET(new Request("http://localhost/api/dashboard"))).status, role ? 403 : 401);
  }
  assert.deepEqual(calls, []);
});
it("dashboard regions derive ownership from session, seed RLS context, and disable shared caching", async () => {
  for (const route of routes) {
    const response = await route.GET(new Request("http://localhost/api/dashboard?studentId=other"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal((await response.json()).fetchedAt, "2026-09-10T12:00:00.000Z");
  }
  assert.deepEqual(calls, ["student-a", "student-a", "student-a"]);
});
it("unavailable dashboard readers return errors rather than fabricated zero records", async () => {
  unavailable = true;
  for (const route of routes) {
    const response = await route.GET(new Request("http://localhost/api/dashboard"));
    assert.equal(response.status, 500);
    assert.ok((await response.json()).error);
  }
});
