import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

let StaffInviteRefused: typeof import("@/lib/staff-invites").StaffInviteRefused;
const rateLimitCalls: Array<[string, number, number]> = [];
let rateLimitSuccess = true;
let acceptError: Error | null = null;
const cookieCalls: unknown[][] = [];
const acceptCalls: unknown[][] = [];

mock.module("@/lib/rate-limit", {
  exports: {
    rateLimit: async (key: string, limit: number, windowMs: number) => {
      rateLimitCalls.push([key, limit, windowMs]);
      return { success: rateLimitSuccess, remaining: 0, resetTime: Date.now() + windowMs, degraded: false };
    },
  },
});
mock.module("@/lib/db", {
  exports: {
    prisma: {},
    prismaAdmin: {
      student: {
        findUnique: async () => ({ id: "new1", role: "teacher", sessionVersion: 3 }),
      },
    },
  },
});

let POST: typeof import("./route").POST;

before(async () => {
  const realAuth = await import("@/lib/auth");
  mock.module("@/lib/auth", {
    exports: {
        ...realAuth,
      getSession: async () => null,
      setSessionCookie: async (...args: unknown[]) => {
        cookieCalls.push(args);
        return "jwt";
      },
    },
  });
  ({ StaffInviteRefused } = await import("@/lib/staff-invites"));
  const realInvites = await import("@/lib/staff-invites");
  mock.module("@/lib/staff-invites", {
    exports: {
      ...realInvites,
      acceptStaffInvite: async (...args: unknown[]) => {
        acceptCalls.push(args);
        if (acceptError) throw acceptError;
        return { staffId: "new1" };
      },
    },
  });
  ({ POST } = await import("./route"));
});


const BODY = {
  token: "abc",
  email: "new@example.org",
  displayName: "New Person",
  password: "a-long-enough-password",
};
function post(body: unknown = BODY) {
  return POST(mockRequest("/api/staff-invites/accept", { method: "POST", body, headers: { "x-forwarded-for": "9.9.9.9" } }));
}

beforeEach(() => {
  rateLimitCalls.length = 0;
  rateLimitSuccess = true;
  acceptError = null;
  cookieCalls.length = 0;
  acceptCalls.length = 0;
});

describe("POST /api/staff-invites/accept", () => {
  it("rate-limits by IP before it reads the body", async () => {
    rateLimitSuccess = false;
    const res = await post();
    assert.equal(res.status, 429);
    assert.equal(acceptCalls.length, 0);
    assert.match(rateLimitCalls[0][0], /^staff-invite-accept:/);
    assert.ok(rateLimitCalls[0][0].includes("9.9.9.9"));
  });

  it("signs the new account in and returns its role home", async () => {
    const res = await post();
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { success: true, data: { role: "teacher", redirectTo: "/teacher" } });
    assert.deepEqual(cookieCalls[0], ["new1", "teacher", 3]);
  });

  it("answers an expired invite with the plain message and sets no cookie", async () => {
    acceptError = new StaffInviteRefused("expired");
    const res = await post();
    assert.equal(res.status, 410);
    assert.match((await res.json()).error, /expired/);
    assert.equal(cookieCalls.length, 0);
  });

  it("rejects a short password with 400", async () => {
    assert.equal((await post({ ...BODY, password: "short" })).status, 400);
  });
});
