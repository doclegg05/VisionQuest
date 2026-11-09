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

// Mirrors the real `cached()`: a fetcher that throws propagates and stores nothing.
const memo = new Map<string, unknown>();
mock.module("@/lib/cache", {
  namedExports: {
    cached: async <T>(key: string, _ttl: number, fetcher: () => Promise<T>): Promise<T> => {
      if (memo.has(key)) return memo.get(key) as T;
      const value = await fetcher();
      memo.set(key, value);
      return value;
    },
  },
});

const mockUpdate = mock.fn(async () => ({})) as any;
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
        update: mockUpdate,
      },
    },
  },
});

const realFetch = globalThis.fetch;
let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  rateLimitCalls.length = 0;
  windowCounts = new Map();
  mockFindUnique.mock.resetCalls();
  mockUpdate.mock.resetCalls();
  memo.clear();
  globalThis.fetch = realFetch;
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

const STORED = [
  { id: "b1", name: "IC3", description: "", imageUrl: "", issuedAt: "2026-01-01", issuerName: "Certiport", badgeUrl: "https://www.credly.com/badges/b1" },
];

function student(overrides: Record<string, unknown> = {}) {
  mockFindUnique.mock.mockImplementation(async () => ({
    credlyUsername: "alice",
    credlyBadgesCache: null,
    credlyBadgesCachedAt: null,
    ...overrides,
  }));
}

function storedFor(username: string, badges: unknown[] = STORED): string {
  return JSON.stringify({ username, badges });
}

function stubFetch(impl: () => Promise<Response>) {
  const fn = mock.fn(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const okJson = (data: unknown) => async () => Response.json(data);
const credlyBody = { data: [{ id: "b9", badge_template: { name: "MOS" } }] };

describe("GET /api/credly/badges upstream failures", () => {
  const failures: [string, () => Promise<Response>][] = [
    ["a non-OK status", async () => new Response("down", { status: 503 })],
    ["a network error", async () => { throw new TypeError("fetch failed"); }],
    ["an unparseable body", async () => new Response("<html>oops", { status: 200 })],
    ["a body with no data array", async () => Response.json({ nope: true })],
  ];

  for (const [label, impl] of failures) {
    it(`reports unavailable, not an empty list, on ${label}`, async () => {
      student();
      stubFetch(impl);
      const res = await get();
      const body = (await res.json()) as { badges: unknown[]; unavailable?: boolean; error?: string };
      assert.equal(res.status, 502);
      assert.equal(body.unavailable, true);
      assert.ok(body.error && body.error.length > 0);
      assert.deepEqual(body.badges, []);
    });
  }

  it("does not cache a failure as an empty result", async () => {
    student();
    stubFetch(async () => new Response("down", { status: 503 }));
    await get();
    assert.equal(memo.size, 0, "a failed lookup must not be stored");

    stubFetch(okJson(credlyBody));
    const res = await get();
    const body = (await res.json()) as { badges: { id: string }[] };
    assert.equal(res.status, 200);
    assert.equal(body.badges[0].id, "b9");
  });

  it("serves last-good badges for this username when the lookup fails", async () => {
    student({ credlyBadgesCache: storedFor("alice"), credlyBadgesCachedAt: new Date(0) });
    stubFetch(async () => new Response("down", { status: 503 }));
    const res = await get();
    const body = (await res.json()) as { badges: unknown[]; stale?: boolean };
    assert.equal(res.status, 200);
    assert.deepEqual(body.badges, STORED);
    assert.equal(body.stale, true);
  });

  it("still returns an empty list when Credly answers OK with no badges", async () => {
    student();
    stubFetch(okJson({ data: [] }));
    const res = await get();
    const body = (await res.json()) as { badges: unknown[]; unavailable?: boolean };
    assert.equal(res.status, 200);
    assert.deepEqual(body.badges, []);
    assert.notEqual(body.unavailable, true);
  });
});

describe("GET /api/credly/badges stored badges are bound to the username", () => {
  it("serves fresh stored badges saved for the same username without fetching", async () => {
    student({ credlyBadgesCache: storedFor("Alice"), credlyBadgesCachedAt: new Date() });
    const fetchMock = stubFetch(okJson(credlyBody));
    const res = await get();
    const body = (await res.json()) as { badges: unknown[]; cached?: boolean };
    assert.deepEqual(body.badges, STORED);
    assert.equal(body.cached, true);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("never serves badges stored for a different username", async () => {
    student({ credlyBadgesCache: storedFor("bob"), credlyBadgesCachedAt: new Date() });
    const fetchMock = stubFetch(okJson(credlyBody));
    const res = await get();
    const body = (await res.json()) as { badges: { id: string }[] };
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(body.badges[0].id, "b9");
  });

  it("does not use another account's badges as the outage fallback", async () => {
    student({ credlyBadgesCache: storedFor("bob"), credlyBadgesCachedAt: new Date() });
    stubFetch(async () => new Response("down", { status: 503 }));
    const res = await get();
    const body = (await res.json()) as { badges: unknown[]; unavailable?: boolean };
    assert.equal(res.status, 502);
    assert.equal(body.unavailable, true);
    assert.deepEqual(body.badges, []);
  });

  it("ignores an old unbound cache with no username", async () => {
    student({ credlyBadgesCache: JSON.stringify(STORED), credlyBadgesCachedAt: new Date() });
    const fetchMock = stubFetch(okJson(credlyBody));
    await get();
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it("stores fetched badges together with the username", async () => {
    student();
    stubFetch(okJson(credlyBody));
    await get();
    await new Promise((r) => setImmediate(r));
    assert.equal(mockUpdate.mock.callCount(), 1);
    const data = (mockUpdate.mock.calls[0].arguments[0] as { data: { credlyBadgesCache: string } }).data;
    const stored = JSON.parse(data.credlyBadgesCache) as { username: string; badges: unknown[] };
    assert.equal(stored.username, "alice");
    assert.equal(stored.badges.length, 1);
  });
});
