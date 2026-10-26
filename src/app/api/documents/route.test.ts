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
  return getWith({ search });
}

async function getWith(searchParams: Record<string, string>): Promise<string> {
  const res = await route.GET(mockRequest("/api/documents", { searchParams }) as any);
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

  // ── Review W4 (2026-09-06) ─────────────────────────────────────────────
  //
  // `search` was hashed; `platformId` and `certificationId` came straight
  // from `searchParams.get()` with no cap and went into the key verbatim.
  // Neither is validated against an allowlist the way `category` is, so
  // either one is the same cache-filling primitive the search hash closed:
  // the shared cache is capped at 10,000 keys and node-cache refuses to
  // store rather than evicting, so filling it stops every other `cached()`
  // caller — getSession() included — from storing anything. Verified before
  // the fix: a 5,000-character `platformId` produced a 5,000-character-longer
  // cache key.
  for (const field of ["platformId", "certificationId"] as const) {
    it(`does not let a caller grow the cache key through ${field}`, async () => {
      const short = await getWith({ [field]: "a" });
      cacheKeys.length = 0;
      const long = await getWith({ [field]: "x".repeat(5000) });

      assert.equal(
        long.length,
        short.length,
        `${field} must be a fixed-length digest, not caller text`,
      );
      assert.ok(long.length < 200, `cache key should stay small, got ${long.length} chars`);
    });

    it(`still gives distinct ${field} values distinct cache keys`, async () => {
      const keyA = await getWith({ [field]: "aztec" });
      cacheKeys.length = 0;
      const keyB = await getWith({ [field]: "northstar" });

      assert.notEqual(keyA, keyB, `distinct ${field} values must not collide in the cache`);
    });

    it(`never embeds the raw ${field} in the key`, async () => {
      const key = await getWith({ [field]: "sensitive-platform-name" });

      assert.ok(
        !key.includes("sensitive-platform-name"),
        `raw ${field} leaked into the cache key: ${key}`,
      );
    });
  }

  it("uses one digest width for every hashed segment", async () => {
    // 32 hex characters, the width src/lib/rate-limit-key.ts settled on for
    // the same job. One width means a reader does not have to work out which
    // segment is which by counting characters.
    const key = await getWith({
      search: "welcome",
      platformId: "aztec",
      certificationId: "ic3",
    });

    const digests = key.split(":").filter((part) => /^[0-9a-f]+$/.test(part) && part.length > 8);
    assert.equal(digests.length, 3, `expected three hashed segments, got key: ${key}`);
    for (const digest of digests) {
      assert.equal(digest.length, 32, `every hashed segment is 32 hex chars, got ${digest.length}`);
    }
  });
});
