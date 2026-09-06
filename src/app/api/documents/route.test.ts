/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

/**
 * GET /api/documents — cache-key shape.
 *
 * The list payload is cached for 120s under a key built from the query
 * parameters, one of which (`search`) is caller-supplied free text. The shared
 * cache is capped at 10,000 keys, so a key that grows with attacker input is a
 * cache-filling primitive: enough distinct searches evict nothing (node-cache
 * refuses to store rather than evicting) and every other `cached()` caller,
 * getSession() included, stops being able to store anything.
 *
 * The search term is therefore hashed into the key: distinct searches still
 * get distinct cache entries, but the key has a fixed length no caller can
 * grow.
 */

const session = mockStudentSession();

const cacheKeys: string[] = [];

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
    isStaffRole: (role: string) => role === "teacher" || role === "admin",
  },
});

mock.module("@/lib/cache", {
  namedExports: {
    cached: async <T>(key: string, _ttl: number, fetcher: () => Promise<T>): Promise<T> => {
      cacheKeys.push(key);
      return fetcher();
    },
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: async () => ({ success: true, remaining: 100 }),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      programDocument: {
        findMany: mock.fn(async () => []) as any,
        count: mock.fn(async () => 0) as any,
      },
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  cacheKeys.length = 0;
});

async function get(search: string): Promise<string> {
  const res = await route.GET(mockRequest("/api/documents", { searchParams: { search } }) as any);
  assert.equal(res.status, 200);
  assert.equal(cacheKeys.length, 1, "expected exactly one cached() call per request");
  return cacheKeys[0];
}

describe("GET /api/documents cache key", () => {
  it("gives different search terms different cache keys", async () => {
    const keyA = await get("welcome packet");
    cacheKeys.length = 0;
    const keyB = await get("orientation packet");

    assert.notEqual(keyA, keyB, "distinct searches must not collide in the cache");
  });

  it("gives the same search term the same cache key", async () => {
    const first = await get("welcome packet");
    cacheKeys.length = 0;
    const second = await get("welcome packet");

    assert.equal(first, second, "the same query must reuse its cache entry");
  });

  it("does not let a caller grow the cache key", async () => {
    const short = await get("a");
    cacheKeys.length = 0;
    const long = await get("x".repeat(5000));

    assert.equal(
      long.length,
      short.length,
      "the search segment must be a fixed-length digest, not caller text",
    );
    assert.ok(long.length < 200, `cache key should stay small, got ${long.length} chars`);
  });

  it("never embeds the raw search text in the key", async () => {
    const key = await get("Sensitive Search Term");

    assert.ok(
      !key.toLowerCase().includes("sensitive"),
      `raw search text leaked into the cache key: ${key}`,
    );
  });
});
