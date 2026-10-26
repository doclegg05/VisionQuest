/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession } from "@/lib/test-helpers";

/**
 * POST /api/settings/credly — per-account rate limit.
 *
 * 2026-09-06 hunt, follow-up (9): the READ side (GET /api/credly/badges) was
 * given a 30/minute per-account limit because it mints `credly:<username>`
 * cache entries against a 10,000-key ceiling that refuses writes rather than
 * evicting. The write that CHOOSES that username had no limit at all, so the
 * read limit bounded how often one account could ask about a username but not
 * how many distinct usernames it could nominate — and the value lands in a
 * `Student` row on every call, unbounded.
 *
 * Five changes per fifteen minutes. A student sets this once; the ceiling is
 * only reachable by a script.
 */

const session = mockStudentSession();

const LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;

const rateLimitCalls: { key: string; limit: number; windowMs: number }[] = [];
let windowCounts = new Map<string, number>();

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>) =>
      async (...args: Args) => {
        try {
          return await handler(session, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
    badRequest: (message: string) => makeHttpError(400, message),
    rateLimited: (message = "Too many requests") => makeHttpError(429, message),
  },
});

// A real fixed-window counter, so the ceiling under test is the one the route
// itself passes in rather than a number restated by the test.
mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: async (key: string, limit: number, windowMs: number) => {
      rateLimitCalls.push({ key, limit, windowMs });
      const used = (windowCounts.get(key) ?? 0) + 1;
      windowCounts.set(key, used);
      return { success: used <= limit, remaining: Math.max(0, limit - used), degraded: false };
    },
  },
});

const mockUpdate = mock.fn(async () => ({})) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: {
        findUnique: mock.fn(async () => ({ credlyUsername: null })) as any,
        update: mockUpdate,
      },
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  rateLimitCalls.length = 0;
  windowCounts = new Map();
  mockUpdate.mock.resetCalls();
});

function post(username: string): Promise<Response> {
  const req = new Request("http://localhost:3000/api/settings/credly", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credlyUsername: username }),
  });
  return route.POST(req as never);
}

describe("POST /api/settings/credly rate limit", () => {
  it("counts every save against a bucket keyed on the account", async () => {
    await post("alice-rivers");

    assert.equal(rateLimitCalls.length, 1, "the write must be counted");
    const [call] = rateLimitCalls;
    assert.ok(call.key.includes(session.id), `the bucket must name the account; got ${call.key}`);
    assert.equal(call.limit, LIMIT);
    assert.equal(call.windowMs, WINDOW_MS);
  });

  it("does not share a bucket with the read side", async () => {
    // GET /api/credly/badges counts under `credly:<studentId>` at 30/minute.
    // Sharing that bucket would let a badge page refresh spend the write
    // budget, and 30 writes a minute is not the ceiling this wants.
    await post("alice-rivers");
    assert.notEqual(rateLimitCalls[0].key, `credly:${session.id}`);
  });

  it("refuses the save past the limit with a 429 and does not write", async () => {
    for (let i = 0; i < LIMIT; i++) {
      const res = await post(`alice-${i}`);
      assert.equal(res.status, 200, `save ${i + 1} of ${LIMIT} should be admitted`);
    }
    assert.equal(mockUpdate.mock.callCount(), LIMIT);

    const res = await post("alice-overflow");
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 429);
    assert.match(body.error, /too many/i);
    assert.equal(mockUpdate.mock.callCount(), LIMIT, "the refused save must not reach the database");
  });

  it("refuses before parsing or validating the body", async () => {
    for (let i = 0; i < LIMIT; i++) await post(`alice-${i}`);

    // An invalid body past the limit answers 429, not 400: a caller must not
    // be able to probe validation behaviour for free once the bucket is spent.
    const res = await post("");
    assert.equal(res.status, 429);
  });

  it("leaves a save inside the limit working exactly as before", async () => {
    const res = await post("https://www.credly.com/users/alice-rivers/badges");
    const body = (await res.json()) as { credlyUsername: string };

    assert.equal(res.status, 200);
    assert.equal(body.credlyUsername, "alice-rivers", "URL extraction is unchanged");
    assert.equal(mockUpdate.mock.callCount(), 1);
  });
});
