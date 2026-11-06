import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { createFakeDb } from "@/lib/staff-invite-test-db";
import { mockRequest } from "@/lib/test-helpers";

// POST /api/staff-invites/accept/code answers the same for every token, so it
// cannot be used to learn which tokens are real. The invite modules run for
// real over the in-memory database; the rate limiter is a spy.

const fake = createFakeDb();
const sent: Array<{ to: string; text: string }> = [];
const rateLimitCalls: Array<[string, number, number]> = [];
let refusingKeys: RegExp | null = null;
let emailConfigured = true;

mock.module("@/lib/db", { exports: { prisma: fake.client, prismaAdmin: fake.client } });
mock.module("@/lib/email", {
  exports: {
    isEmailDeliveryConfigured: () => emailConfigured,
    sendEmail: async (payload: { to: string; text: string }) => {
      sent.push(payload);
    },
  },
});
mock.module("@/lib/rate-limit", {
  exports: {
    rateLimit: async (key: string, limit: number, windowMs: number) => {
      rateLimitCalls.push([key, limit, windowMs]);
      const success = !(refusingKeys && refusingKeys.test(key));
      return { success, remaining: 0, resetTime: Date.now() + windowMs, degraded: false };
    },
  },
});

let POST: typeof import("./route").POST;
let sendStaffInvite: typeof import("@/lib/staff-invite-email").sendStaffInvite;

before(async () => {
  ({ POST } = await import("./route"));
  ({ sendStaffInvite } = await import("@/lib/staff-invite-email"));
});

const REGION_A = "cmregionaaaaaaaaaaaaaaaaa";
const ADMIN = { id: "a1", studentId: "admin", displayName: "Admin", role: "admin" };

function post(body: unknown) {
  return POST(
    mockRequest("/api/staff-invites/accept/code", { method: "POST", body, headers: { "x-forwarded-for": "9.9.9.9" } }),
  );
}

async function emailedToken(): Promise<string> {
  await sendStaffInvite(ADMIN, { email: "pat@example.org", role: "teacher", regionId: REGION_A }, (t) => `/invite/${t}`);
  const token = sent.at(-1)?.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(token);
  return token;
}

beforeEach(() => {
  fake.reset();
  fake.seed("region", { id: REGION_A, name: "North", status: "active" });
  fake.seed("student", { id: ADMIN.id, studentId: ADMIN.studentId, email: null, role: "admin", isActive: true });
  sent.length = 0;
  rateLimitCalls.length = 0;
  refusingKeys = null;
  emailConfigured = true;
});

describe("POST /api/staff-invites/accept/code", () => {
  it("emails a code for a real emailed invite", async () => {
    const token = await emailedToken();
    const res = await post({ token });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, data: { sent: true } });
    assert.match(sent.at(-1)?.text ?? "", /\b\d{6}\b/);
    assert.equal(sent.at(-1)?.to, "pat@example.org");
  });

  it("answers an unknown token exactly as it answers a real one, and sends nothing", async () => {
    const token = await emailedToken();
    const real = await post({ token });
    const before = sent.length;
    const fakeToken = await post({ token: "not-a-real-token" });
    assert.equal(fakeToken.status, real.status);
    assert.deepEqual(await fakeToken.json(), await real.json());
    assert.equal(sent.length, before);
  });

  it("answers a locked invite exactly as it answers an unknown token, and sends nothing (R23)", async () => {
    const token = await emailedToken();
    fake.patch("staffInvite", String(fake.state.staffInvite.rows[0].id), { codeAttempts: 5 });
    const before = sent.length;
    const locked = await post({ token });
    const unknown = await post({ token: "not-a-real-token" });
    assert.equal(locked.status, unknown.status);
    assert.deepEqual(await locked.json(), await unknown.json());
    assert.equal(sent.length, before);
  });

  it("matches register-teacher: 5 per IP and a route-wide 20, each per 15 minutes", async () => {
    await post({ token: "x" });
    assert.deepEqual(rateLimitCalls, [
      ["staff-invite-code:9.9.9.9", 5, 15 * 60 * 1000],
      ["staff-invite-code:global", 20, 15 * 60 * 1000],
    ]);
  });

  it("refuses with 429 at either limiter and sends nothing", async () => {
    const token = await emailedToken();
    const before = sent.length;
    for (const key of [/^staff-invite-code:9\.9\.9\.9$/, /^staff-invite-code:global$/]) {
      refusingKeys = key;
      const res = await post({ token });
      assert.equal(res.status, 429);
      assert.deepEqual(await res.json(), { error: "Too many attempts. Please try again later." });
    }
    assert.equal(sent.length, before);
  });

  it("rejects a body with no token with 400", async () => {
    assert.equal((await post({})).status, 400);
  });
});
