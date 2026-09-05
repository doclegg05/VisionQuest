/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers helpers with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

/**
 * The guessing budget for the phone-verification code.
 *
 * The code is six digits and lives for ten minutes. Without a limit on
 * ATTEMPTS that is a brute-force target: the send limiter counts codes sent,
 * so one code bought unlimited tries at it. These cases pin the budget and,
 * just as importantly, pin that a refusal happens BEFORE any comparison — a
 * limiter that runs after the check is a limiter an attacker has already got
 * their answer from.
 */

const session = mockStudentSession();

const mockGetSession = mock.fn() as any;
const mockRateLimit = mock.fn() as any;
const mockConfirm = mock.fn() as any;

// api-error stays REAL so withAuth's own 401 gate is exercised; only its
// getSession dependency is stubbed.
mock.module("@/lib/auth", { namedExports: { getSession: mockGetSession } });
mock.module("@/lib/rate-limit", { namedExports: { rateLimit: mockRateLimit } });
mock.module("@/lib/nudges/phone-verification", {
  namedExports: { confirmVerificationCode: mockConfirm },
});

let POST: typeof import("./route").POST;

before(async () => {
  ({ POST } = await import("./route"));
});

function confirmRequest(code: string) {
  return mockRequest("/api/notifications/preferences/verify-phone/confirm", {
    method: "POST",
    body: { code },
  });
}

/** Admits the first `limit` calls, then refuses — the real limiter's contract. */
function limiterAllowing(limit: number) {
  let seen = 0;
  return async () => {
    seen += 1;
    return { success: seen <= limit, remaining: Math.max(limit - seen, 0), resetTime: 0, degraded: false };
  };
}

describe("POST /api/notifications/preferences/verify-phone/confirm", () => {
  beforeEach(() => {
    mockGetSession.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockConfirm.mock.resetCalls();

    mockGetSession.mock.mockImplementation(async () => session);
    mockRateLimit.mock.mockImplementation(limiterAllowing(5));
    mockConfirm.mock.mockImplementation(async () => ({ ok: false, reason: "wrong_code" }));
  });

  it("refuses the sixth attempt in the window, without comparing the code", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await POST(confirmRequest("000000"));
      assert.equal(res.status, 400, `attempt ${attempt} should reach the comparison`);
    }
    assert.equal(mockConfirm.mock.callCount(), 5);

    const sixth = await POST(confirmRequest("000000"));
    assert.equal(sixth.status, 400);
    const body = (await sixth.json()) as { error?: string };
    assert.match(body.error ?? "", /Too many tries/);
    assert.equal(
      mockConfirm.mock.callCount(),
      5,
      "the refused attempt must never reach the code comparison",
    );
  });

  it("keys the limiter to the account, not the code", async () => {
    await POST(confirmRequest("123456"));
    const key = mockRateLimit.mock.calls[0].arguments[0] as string;
    assert.ok(key.includes(session.id), "a per-code key would be no limit at all");
    assert.match(key, /^sms-verify-confirm:/);
  });

  it("fails CLOSED when the limiter is degraded", async () => {
    // Everywhere else a degraded limiter admits the request, because locking a
    // shared classroom out of login is the worse failure. Here the thing being
    // bounded is guessing a secret, so the direction flips.
    mockRateLimit.mock.mockImplementation(async () => ({
      success: true,
      remaining: 5,
      resetTime: 0,
      degraded: true,
    }));

    const res = await POST(confirmRequest("123456"));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? "", /Too many tries/);
    assert.equal(mockConfirm.mock.callCount(), 0);
  });

  it("still confirms a correct code inside the budget", async () => {
    mockConfirm.mock.mockImplementation(async () => ({ ok: true }));
    const res = await POST(confirmRequest("123456"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { confirmed: true });
  });

  it("spends a guess on a malformed code too", async () => {
    // Otherwise the budget is trivially bypassed: send five junk codes to
    // reset nothing, and every real guess stays free.
    const res = await POST(confirmRequest("12"));
    assert.equal(res.status, 400);
    assert.equal(mockRateLimit.mock.callCount(), 1, "the limiter ran before the body was parsed");
  });
});
