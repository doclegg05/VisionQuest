/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession } from "@/lib/test-helpers";

/**
 * GET /api/credly/badges — per-account rate limit.
 *
 * This route caches under `credly:<username>` for 600s, and the username is
 * whatever the student last saved via PUT /api/settings/credly. With no limit
 * on the route, one account could change its username and re-request in a
 * loop, minting an unbounded number of 10-minute cache entries against a
 * 10,000-key ceiling that refuses writes rather than evicting. The limit
 * bounds how fast that can happen; the `cached()` guard (src/lib/cache.ts)
 * bounds what a full cache costs.
 *
 * 30 requests per minute is generous for a page that fetches badges on load
 * and cheap for anyone driving it in a loop.
 */

const session = mockStudentSession();

const LIMIT = 30;
const WINDOW_MS = 60 * 1000;

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
      return { success: used <= limit, remaining: Math.max(0, limit - used) };
    },
  },
});

mock.module("@/lib/cache", {
  namedExports: {
    cached: async <T>(_key: string, _ttl: number, fetcher: () => Promise<T>): Promise<T> => fetcher(),
  },
});

const mockFindUnique = mock.fn(async () => ({
  credlyUsername: null,
  credlyBadgesCache: null,
  credlyBadgesCachedAt: null,
})) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: {
        get findUnique() {
          return mockFindUnique;
        },
        update: mock.fn(async () => ({})) as any,
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
  mockFindUnique.mock.resetCalls();
});

// The route handler takes no request argument — it reads only the session.
function get(): Promise<Response> {
  return route.GET();
}

describe("GET /api/credly/badges rate limit", () => {
  it("refuses the 31st request in a minute with 429", async () => {
    for (let i = 1; i <= LIMIT; i++) {
      const res = await get();
      assert.equal(res.status, 200, `request ${i} of ${LIMIT} should be allowed`);
    }

    const overLimit = await get();
    assert.equal(overLimit.status, 429, "the 31st request in the window must be refused");
  });

  it("scopes the limit per account at 30 per minute", async () => {
    await get();

    assert.equal(rateLimitCalls.length, 1, "the route must consult the limiter");
    const [call] = rateLimitCalls;
    assert.ok(
      call.key.includes(session.id),
      `limiter key must be per-account, got ${call.key}`,
    );
    assert.equal(call.limit, LIMIT);
    assert.equal(call.windowMs, WINDOW_MS);
  });

  it("checks the limit before touching the database", async () => {
    for (let i = 0; i < LIMIT; i++) await get();
    mockFindUnique.mock.resetCalls();

    const overLimit = await get();

    assert.equal(overLimit.status, 429);
    assert.equal(
      mockFindUnique.mock.callCount(),
      0,
      "a refused request must not run the student lookup",
    );
  });
});
