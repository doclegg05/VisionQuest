import assert from "node:assert/strict";
import test from "node:test";
import { cached, invalidate, invalidatePrefix } from "./cache";

// Each test uses a unique key prefix to avoid cross-test cache pollution
// since the module holds a singleton NodeCache instance.

test("cached() calls the fetcher on the first call and returns its value", async () => {
  let callCount = 0;
  const fetcher = async () => {
    callCount++;
    return "initial-value";
  };

  const result = await cached("cache-test:first-call", 60, fetcher);

  assert.equal(result, "initial-value");
  assert.equal(callCount, 1);

  // Clean up so this key does not bleed into other tests
  invalidate("cache-test:first-call");
});

test("cached() returns the cached value on the second call without invoking the fetcher again", async () => {
  let callCount = 0;
  const fetcher = async () => {
    callCount++;
    return "cached-value";
  };

  const key = "cache-test:second-call";
  await cached(key, 60, fetcher);
  const result = await cached(key, 60, fetcher);

  assert.equal(result, "cached-value");
  assert.equal(callCount, 1);

  invalidate(key);
});

test("cached() calls the fetcher again after invalidate() removes the key", async () => {
  let callCount = 0;
  const fetcher = async () => {
    callCount++;
    return `value-${callCount}`;
  };

  const key = "cache-test:post-invalidate";

  const first = await cached(key, 60, fetcher);
  assert.equal(first, "value-1");

  invalidate(key);

  const second = await cached(key, 60, fetcher);
  assert.equal(second, "value-2");
  assert.equal(callCount, 2);

  invalidate(key);
});

test("fetcher is not called when the cache already holds a value", async () => {
  const key = "cache-test:no-fetcher-call";

  // Prime the cache with the first call
  await cached(key, 60, async () => "primed");

  let fetcherCalled = false;
  const result = await cached(key, 60, async () => {
    fetcherCalled = true;
    return "should-not-appear";
  });

  assert.equal(fetcherCalled, false);
  assert.equal(result, "primed");

  invalidate(key);
});

test("invalidatePrefix() removes all keys that start with the given prefix", async () => {
  const fetchCounts: Record<string, number> = { a: 0, b: 0, c: 0 };

  const prefix = "cache-test:prefix-group:";
  const keyA = `${prefix}a`;
  const keyB = `${prefix}b`;
  const keyC = "cache-test:other-group:c";

  await cached(keyA, 60, async () => { fetchCounts.a++; return "value-a"; });
  await cached(keyB, 60, async () => { fetchCounts.b++; return "value-b"; });
  await cached(keyC, 60, async () => { fetchCounts.c++; return "value-c"; });

  // All fetchers should have been called exactly once so far
  assert.equal(fetchCounts.a, 1);
  assert.equal(fetchCounts.b, 1);
  assert.equal(fetchCounts.c, 1);

  invalidatePrefix(prefix);

  // Keys A and B should be evicted; a new call must hit the fetcher
  await cached(keyA, 60, async () => { fetchCounts.a++; return "value-a-2"; });
  await cached(keyB, 60, async () => { fetchCounts.b++; return "value-b-2"; });
  // Key C used a different prefix and must still be cached
  await cached(keyC, 60, async () => { fetchCounts.c++; return "value-c-2"; });

  assert.equal(fetchCounts.a, 2, "keyA should have been re-fetched after prefix invalidation");
  assert.equal(fetchCounts.b, 2, "keyB should have been re-fetched after prefix invalidation");
  assert.equal(fetchCounts.c, 1, "keyC should still be cached and not re-fetched");

  invalidate(keyA);
  invalidate(keyB);
  invalidate(keyC);
});

test("invalidatePrefix() is a no-op when no keys match the prefix", () => {
  // Should not throw even when the cache has no matching keys
  assert.doesNotThrow(() => invalidatePrefix("cache-test:nonexistent-prefix:"));
});

test("cached() works with object values and returns cloned copies (useClones: true)", async () => {
  const key = "cache-test:object-value";
  const originalObject = { id: 1, name: "test" };

  await cached(key, 60, async () => originalObject);
  const result = await cached<{ id: number; name: string }>(key, 60, async () => ({ id: 99, name: "should-not-appear" }));

  // With useClones: true the cache returns a deep copy, not the same reference
  assert.deepEqual(result, originalObject);
  assert.notEqual(result, originalObject); // different reference

  invalidate(key);
});

test("cached() propagates fetcher errors without caching anything", async () => {
  const key = "cache-test:fetcher-throws";
  let callCount = 0;

  const throwingFetcher = async () => {
    callCount++;
    throw new Error("fetch failed");
  };

  await assert.rejects(() => cached(key, 60, throwingFetcher), /fetch failed/);

  // Because the fetch failed, the cache should be empty and a subsequent
  // call must invoke the fetcher again rather than returning a cached error
  await assert.rejects(() => cached(key, 60, throwingFetcher), /fetch failed/);

  assert.equal(callCount, 2);
});
