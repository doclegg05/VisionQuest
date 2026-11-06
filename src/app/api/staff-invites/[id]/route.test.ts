import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

let StaffInviteRefused: typeof import("@/lib/staff-invites").StaffInviteRefused;
type TestSession = { id: string; studentId: string; displayName: string; role: string };
let session: TestSession | null;
let revokeError: Error | null = null;
const revokeCalls: unknown[][] = [];

let DELETE: typeof import("./route").DELETE;

before(async () => {
  const realAuth = await import("@/lib/auth");
  mock.module("@/lib/auth", { exports: { ...realAuth, getSession: async () => session } });
  ({ StaffInviteRefused } = await import("@/lib/staff-invites"));
  const realInvites = await import("@/lib/staff-invites");
  mock.module("@/lib/staff-invites", {
    exports: {
      ...realInvites,
      revokeStaffInvite: async (...args: unknown[]) => {
        revokeCalls.push(args);
        if (revokeError) throw revokeError;
      },
    },
  });
  ({ DELETE } = await import("./route"));
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  session = { id: "a1", studentId: "a", displayName: "A", role: "admin" };
  revokeError = null;
  revokeCalls.length = 0;
});

describe("DELETE /api/staff-invites/[id]", () => {
  it("refuses a teacher with 403", async () => {
    session = { id: "t1", studentId: "t", displayName: "T", role: "teacher" };
    const res = await DELETE(mockRequest("/api/staff-invites/x", { method: "DELETE" }), params("ckxxxxxxxxxxxxxxxxxxxxxxx"));
    assert.equal(res.status, 403);
    assert.equal(revokeCalls.length, 0);
  });

  it("revokes and answers in the envelope", async () => {
    const res = await DELETE(mockRequest("/api/staff-invites/x", { method: "DELETE" }), params("ckxxxxxxxxxxxxxxxxxxxxxxx"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, data: { revoked: true } });
  });

  it("maps a refusal to its plain message", async () => {
    revokeError = new StaffInviteRefused("region_not_allowed");
    const res = await DELETE(mockRequest("/api/staff-invites/x", { method: "DELETE" }), params("ckxxxxxxxxxxxxxxxxxxxxxxx"));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "You can invite people only to your own region." });
  });

  it("rejects an id that is not a cuid with 400", async () => {
    const res = await DELETE(mockRequest("/api/staff-invites/x", { method: "DELETE" }), params("not a cuid"));
    assert.equal(res.status, 400);
  });
});
