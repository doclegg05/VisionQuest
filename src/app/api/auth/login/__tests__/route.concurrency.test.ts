/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@prisma/client";
import { mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Login route — concurrent requests from one IP
//
// Regression guard for the 2026-08-20 bug: several students signing in at the
// same second from a shared classroom or library IP all contended on the same
// RateLimitEntry row, Postgres aborted the losing transactions, and the route
// answered HTTP 500 instead of signing them in or rate-limiting them cleanly.
//
// Unlike route.test.ts, this file does NOT mock `@/lib/rate-limit` — the
// limiter is the code under test. It mocks the store underneath it instead.
//
// What the fake store can and cannot prove: it models a counter that raises
// transient errors, which pins the route's contract (never a 500, whatever
// the store does). It cannot model Serializable write conflicts or Prisma
// pool exhaustion — the real Postgres behavior lives in
// src/lib/rate-limit.db.test.ts.
// ---------------------------------------------------------------------------

/** Mirrors the per-IP limit in ../route.ts. */
const IP_LIMIT = 10;
/** Mirrors the per-user limit in ../route.ts. */
const USER_LIMIT = 5;
/** Concurrent sign-in attempts — comfortably above both limits. */
const BURST = 25;

const STUDENT = {
  id: "stu-concurrent",
  studentId: "alice",
  displayName: "Alice",
  email: "alice@example.com",
  role: "student",
  passwordHash: "scrypt$abc$def",
  isActive: true,
  sessionVersion: 0,
  mfaEnabled: false,
  authProvider: null,
};

function prismaError(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "test" });
}

/**
 * Counter store standing in for the RateLimitEntry table. Bound values arrive
 * in the order the limiter's SQL interpolates them: key, nextReset, now.
 */
const rows = new Map<string, { count: number; resetTime: Date }>();
/** Errors raised before any work, shifted one per statement. */
let queuedFailures: Error[] = [];

const fakeStore = {
  student: {
    findUnique: async () => STUDENT,
    update: async () => undefined,
  },
  $queryRaw: async (_sql: TemplateStringsArray, ...values: unknown[]) => {
    const queued = queuedFailures.shift();
    if (queued) throw queued;

    const [key, nextReset, now] = values as [string, Date, Date];
    const existing = rows.get(key);
    const row =
      !existing || existing.resetTime.getTime() <= now.getTime()
        ? { count: 1, resetTime: nextReset }
        : { count: existing.count + 1, resetTime: existing.resetTime };
    rows.set(key, row);
    return [row];
  },
};

mock.module("@/lib/db", {
  namedExports: { prismaAdmin: fakeStore, prisma: fakeStore },
});

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => null,
    verifyPasswordSafeWithStatus: () => ({ valid: true, needsRehash: false }),
    hashPassword: () => ({ hash: "scrypt$newhash$value", salt: "salt" }),
    normalizeStudentId: (raw: string) => raw.trim().toLowerCase(),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    setSessionCookie: async () => "fake-jwt-token",
    signMfaSessionToken: (id: string) => `mfa-token-for-${id}`,
    setMfaSessionCookie: async () => undefined,
  },
});

mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: async () => undefined },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    requestId: () => "test-request-id",
  },
});

let loginRoute: Awaited<typeof import("../route")>;

before(async () => {
  loginRoute = await import("../route");
});

/** Fire `count` sign-in attempts from one IP at the same moment. */
async function burst(count: number, ip = "203.0.113.7"): Promise<number[]> {
  const responses = await Promise.all(
    Array.from({ length: count }, () =>
      loginRoute.POST(
        mockRequest("/api/auth/login", {
          method: "POST",
          body: { studentId: "alice", password: "correct-horse" },
          headers: { "x-forwarded-for": ip },
        }) as any,
      ),
    ),
  );
  return responses.map((r) => r.status);
}

describe("POST /api/auth/login — concurrent attempts from one IP", () => {
  beforeEach(() => {
    rows.clear();
    queuedFailures = [];
  });

  it("answers every concurrent attempt with a sign-in or a clean 429, never a 500", async () => {
    const statuses = await burst(BURST);

    assert.equal(
      statuses.filter((s) => s >= 500).length,
      0,
      `no attempt may fail with a server error; got ${JSON.stringify(statuses)}`,
    );
    assert.ok(
      statuses.every((s) => s === 200 || s === 429),
      `every attempt is a sign-in or a rate-limit refusal; got ${JSON.stringify(statuses)}`,
    );
  });

  it("admits exactly as many concurrent attempts as the limits allow", async () => {
    const statuses = await burst(BURST);

    // The per-IP limiter admits IP_LIMIT of the burst; those then meet the
    // per-user limiter, which admits USER_LIMIT. Lost increments would let
    // more through — that is the brute-force protection this counts on.
    assert.equal(statuses.filter((s) => s === 200).length, Math.min(IP_LIMIT, USER_LIMIT));
    assert.equal(statuses.filter((s) => s === 429).length, BURST - Math.min(IP_LIMIT, USER_LIMIT));
  });

  it("survives a store that raises transient contention errors", async () => {
    queuedFailures = Array.from({ length: BURST }, () =>
      prismaError("P2034", "Transaction failed due to a write conflict or a deadlock."),
    );

    const statuses = await burst(BURST);

    assert.equal(
      statuses.filter((s) => s >= 500).length,
      0,
      `contention must be retried or failed over, never surfaced as 500; got ${JSON.stringify(statuses)}`,
    );
  });

  it("signs students in rather than 500ing when the counter store is down", async () => {
    // Fail-open, deliberately: a broken counter must not lock a classroom out
    // of the portal. See the policy note in src/lib/rate-limit.ts.
    queuedFailures = Array.from({ length: BURST * 10 }, () =>
      prismaError("P2024", "Timed out fetching a new connection from the connection pool."),
    );

    const statuses = await burst(BURST);

    assert.equal(statuses.filter((s) => s >= 500).length, 0, "a store outage is not a 500");
    assert.ok(
      statuses.every((s) => s === 200),
      `fail-open admits every attempt; got ${JSON.stringify(statuses)}`,
    );
  });
});
