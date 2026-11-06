import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

type TestSession = { id: string; studentId: string; displayName: string; role: string };
let session: TestSession | null;
const calls: string[] = [];

let GET: typeof import("./route").GET;

before(async () => {
  const realAuth = await import("@/lib/auth");
  mock.module("@/lib/auth", { exports: { ...realAuth, getSession: async () => session } });
  const realApi = await import("@/lib/api-error");
  mock.module("@/lib/org-placement", {
    exports: {
      listUnregionedClasses: async (actor: TestSession) => {
        calls.push("classes");
        if (actor.role === "coordinator") throw realApi.forbidden();
        return [{ id: "k1", name: "Night", instructorCount: 1, activeStudents: 4 }];
      },
      listUnplacedStaff: async (actor: TestSession) => {
        calls.push("staff");
        if (actor.role === "coordinator") throw realApi.forbidden();
        return [{ id: "t1", displayName: "Tess", role: "teacher", createdAt: new Date("2026-01-01") }];
      },
      listApplicantsWaiting: async (actor: TestSession) => {
        calls.push("applicants");
        if (actor.role === "coordinator") throw realApi.forbidden();
        return [{ id: "s1", displayName: "Sam", county: "Kanawha", createdAt: new Date("2026-01-02") }];
      },
    },
  });
  ({ GET } = await import("./route"));
});

beforeEach(() => {
  session = { id: "a1", studentId: "a", displayName: "A", role: "admin" };
  calls.length = 0;
});

describe("GET /api/admin/org-placement", () => {
  it("answers 401 with no session", async () => {
    session = null;
    assert.equal((await GET()).status, 401);
  });

  it("refuses an instructor with 403 and reads nothing", async () => {
    session = { id: "t1", studentId: "t", displayName: "T", role: "teacher" };
    assert.equal((await GET()).status, 403);
    assert.deepEqual(calls, []);
  });

  it("refuses a regional coordinator with 403", async () => {
    session = { id: "c1", studentId: "c", displayName: "C", role: "coordinator" };
    assert.equal((await GET()).status, 403);
  });

  for (const role of ["admin", "program_coordinator"]) {
    it(`gives ${role} both lists in the success envelope`, async () => {
      session = { id: "x1", studentId: "x", displayName: "X", role };
      const res = await GET();
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.unplacedStaff[0].displayName, "Tess");
      assert.equal(json.data.applicants[0].county, "Kanawha");
      assert.equal(json.data.unregionedClasses[0].name, "Night");
    });
  }
});
