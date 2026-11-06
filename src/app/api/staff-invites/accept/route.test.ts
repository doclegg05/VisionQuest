import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

let StaffInviteRefused: typeof import("@/lib/staff-invites").StaffInviteRefused;
const rateLimitCalls: Array<[string, number, number]> = [];
/** Keys whose limiter refuses. Empty means every limiter allows. */
let refusingKeys: RegExp | null = null;
let acceptError: Error | null = null;
const cookieCalls: unknown[][] = [];
const acceptCalls: unknown[][] = [];

mock.module("@/lib/rate-limit", {
  exports: {
    rateLimit: async (key: string, limit: number, windowMs: number) => {
      rateLimitCalls.push([key, limit, windowMs]);
      const success = !(refusingKeys && refusingKeys.test(key));
      return { success, remaining: 0, resetTime: Date.now() + windowMs, degraded: false };
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
  refusingKeys = null;
  acceptError = null;
  cookieCalls.length = 0;
  acceptCalls.length = 0;
});

describe("POST /api/staff-invites/accept", () => {
  it("matches register-teacher: 5 per IP and a route-wide 20, each per 15 minutes", async () => {
    await post();
    assert.deepEqual(rateLimitCalls, [
      ["staff-invite-accept:9.9.9.9", 5, 15 * 60 * 1000],
      ["staff-invite-accept:global", 20, 15 * 60 * 1000],
    ]);
  });

  it("rate-limits by IP before it reads the body", async () => {
    refusingKeys = /^staff-invite-accept:9\.9\.9\.9$/;
    const res = await post();
    assert.equal(res.status, 429);
    assert.equal(acceptCalls.length, 0);
  });

  it("refuses at the route-wide ceiling with the same answer as the IP limiter", async () => {
    refusingKeys = /^staff-invite-accept:9\.9\.9\.9$/;
    const byIp = await post();
    refusingKeys = /^staff-invite-accept:global$/;
    const byGlobal = await post();
    assert.equal(byGlobal.status, 429);
    assert.deepEqual(await byGlobal.json(), await byIp.json());
    assert.equal(acceptCalls.length, 0);
  });

  it("passes the email code through to the accept", async () => {
    await post({ ...BODY, code: "123456" });
    assert.deepEqual(acceptCalls[0][0], { ...BODY, code: "123456" });
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

  it("answers a wrong code with the plain message", async () => {
    acceptError = new StaffInviteRefused("code_invalid");
    const res = await post({ ...BODY, code: "000000" });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "That code is not right. Check the email and try again." });
    assert.equal(cookieCalls.length, 0);
  });

  it("rejects a short password with 400", async () => {
    assert.equal((await post({ ...BODY, password: "short" })).status, 400);
  });
});
