import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

type TestSession = { id: string; studentId: string; displayName: string; role: string };
let session: TestSession | null;
const assigned: unknown[] = [];
const removed: unknown[] = [];
let refusal: Error | null = null;

const CUID_A = "ckaaaaaaaaaaaaaaaaaaaaaaa";
const CUID_B = "ckbbbbbbbbbbbbbbbbbbbbbbb";
const BODY = { instructorId: CUID_A, regionId: CUID_B };

let POST: typeof import("./route").POST;
let DELETE: typeof import("./route").DELETE;

before(async () => {
  const realAuth = await import("@/lib/auth");
  mock.module("@/lib/auth", { exports: { ...realAuth, getSession: async () => session } });
  mock.module("@/lib/org-placement", {
    exports: {
      assignInstructorRegion: async (_actor: unknown, input: unknown) => {
        if (refusal) throw refusal;
        assigned.push(input);
      },
      removeInstructorRegion: async (_actor: unknown, input: unknown) => {
        if (refusal) throw refusal;
        removed.push(input);
      },
    },
  });
  ({ POST, DELETE } = await import("./route"));
});

beforeEach(() => {
  session = { id: "c1", studentId: "c", displayName: "C", role: "coordinator" };
  assigned.length = 0;
  removed.length = 0;
  refusal = null;
});

describe("POST /api/admin/org-placement/region-instructors", () => {
  it("answers 401 with no session", async () => {
    session = null;
    const res = await POST(mockRequest("/x", { method: "POST", body: BODY }));
    assert.equal(res.status, 401);
  });

  it("refuses an instructor with 403", async () => {
    session = { id: "t1", studentId: "t", displayName: "T", role: "teacher" };
    const res = await POST(mockRequest("/x", { method: "POST", body: BODY }));
    assert.equal(res.status, 403);
    assert.equal(assigned.length, 0);
  });

  it("rejects ids that are not cuids", async () => {
    const res = await POST(mockRequest("/x", { method: "POST", body: { instructorId: "x", regionId: "y" } }));
    assert.equal(res.status, 400);
    assert.equal(assigned.length, 0);
  });

  it("lets a regional coordinator assign and answers in the envelope", async () => {
    const res = await POST(mockRequest("/x", { method: "POST", body: BODY }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, data: { assigned: true } });
    assert.deepEqual(assigned, [BODY]);
  });

  it("passes a refusal from the library through as 403", async () => {
    const { forbidden } = await import("@/lib/api-error");
    refusal = forbidden("That region is not yours to assign.");
    const res = await POST(mockRequest("/x", { method: "POST", body: BODY }));
    assert.equal(res.status, 403);
  });
});

describe("DELETE /api/admin/org-placement/region-instructors", () => {
  it("removes a region assignment", async () => {
    const res = await DELETE(mockRequest("/x", { method: "DELETE", body: BODY }));
    assert.equal(res.status, 200);
    assert.deepEqual(removed, [BODY]);
  });

  it("refuses a student with 403", async () => {
    session = { id: "s1", studentId: "s", displayName: "S", role: "student" };
    const res = await DELETE(mockRequest("/x", { method: "DELETE", body: BODY }));
    assert.equal(res.status, 403);
    assert.equal(removed.length, 0);
  });
});
