import assert from "node:assert/strict";
import test from "node:test";
import NodeCache from "node-cache";
import {
  cached,
  invalidate,
  invalidateAllChatContext,
  invalidateChatContext,
  invalidatePrefix,
} from "./cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

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

test("concurrent cold reads execute one fetch and isolate mutable results", async () => {
  const key = "cache-test:concurrent";
  const gate = deferred<{ items: string[]; date: Date }>();
  let queries = 0;
  const reads = Array.from({ length: 50 }, () => cached(key, 60, () => {
    queries++;
    return gate.promise;
  }));
  await Promise.resolve();
  assert.equal(queries, 1);
  gate.resolve({ items: ["original"], date: new Date(0) });
  const values = await Promise.all(reads);
  values[0].items.push("changed");
  assert.deepEqual(values[1].items, ["original"]);
  assert.ok(values[1].date instanceof Date);
  assert.deepEqual((await cached(key, 60, async () => values[0])).items, ["original"]);
  invalidate(key);
});

for (const [label, key, clear] of [
  ["key", "cache-test:race:key", () => invalidate("cache-test:race:key")],
  ["prefix", "cache-test:race:prefix", () => invalidatePrefix("cache-test:race:")],
  ["student chat", "chat:snapshot:race-student", () => invalidateChatContext("race-student")],
  ["all chat", "chat:profile:race-student", () => invalidateAllChatContext()],
] as const) {
  for (const oldFirst of [true, false]) {
    test(`${label} invalidation fences pending fetches (old finishes first: ${oldFirst})`, async () => {
      const old = deferred<string>();
      const fresh = deferred<string>();
      const before = cached(key, 60, () => old.promise);
      await Promise.resolve();
      clear();
      let queries = 0;
      const fetchFresh = () => { queries++; return fresh.promise; };
      const after = cached(key, 60, fetchFresh);
      if (oldFirst) {
        old.resolve("stale");
        assert.equal(await before, "stale");
      }
      const joined = cached(key, 60, fetchFresh);
      fresh.resolve("fresh");
      assert.equal(await after, "fresh");
      assert.equal(await joined, "fresh");
      if (!oldFirst) {
        old.resolve("stale");
        assert.equal(await before, "stale");
      }
      assert.equal(await cached(key, 60, async () => "unexpected"), "fresh");
      assert.equal(queries, 1, "old cleanup must not detach the new pending fetch");
      invalidate(key);
    });
  }
}

test("shared rejection is cleared and synchronous failures can retry", async () => {
  const key = "cache-test:shared-error";
  const gate = deferred<string>();
  let queries = 0;
  const fetcher = () => { queries++; return gate.promise; };
  const results = Promise.allSettled([cached(key, 60, fetcher), cached(key, 60, fetcher)]);
  gate.reject(new Error("failed"));
  assert.ok((await results).every((result) => result.status === "rejected"));
  assert.equal(queries, 1);
  await assert.rejects(cached(key, 60, () => { throw new Error("sync"); }), /sync/);
  assert.equal(await cached(key, 60, async () => "recovered"), "recovered");
  invalidate(key);
});

test("full cache returns successful reads rather than throwing ECACHEFULL", async () => {
  const prefix = "cache-test:capacity:";
  try {
    for (let i = 0; i < 10_001; i++) {
      assert.equal(await cached(`${prefix}${i}`, 60, async () => i), i);
    }
    invalidate(`${prefix}0`);
    assert.equal(await cached(`${prefix}new`, 60, async () => "admitted"), "admitted");
    assert.equal(await cached(`${prefix}new`, 60, async () => "miss"), "admitted");
  } finally {
    invalidatePrefix(prefix);
  }
});

test("pending registry is bounded and overflow reads are not retained", async () => {
  const prefix = "cache-test:pending-capacity:";
  const gate = deferred<string>();
  const pending = Array.from({ length: 10_000 }, (_, i) => cached(`${prefix}${i}`, 60, () => gate.promise));
  let queries = 0;
  const overflow = () => { queries++; return Promise.resolve("uncached"); };
  try {
    assert.equal(await cached(`${prefix}overflow`, 60, overflow), "uncached");
    assert.equal(await cached(`${prefix}overflow`, 60, overflow), "uncached");
    assert.equal(queries, 2);
    gate.resolve("done");
    await Promise.all(pending);
    invalidatePrefix(prefix);
    await cached(`${prefix}overflow`, 60, overflow);
    await cached(`${prefix}overflow`, 60, overflow);
    assert.equal(queries, 3, "settled pending work must release capacity");
  } finally {
    gate.resolve("done");
    await Promise.all(pending);
    invalidatePrefix(prefix);
  }
});

test("an old rejection cannot detach newer pending work", async () => {
  const key = "cache-test:rejected-generation";
  const old = deferred<string>();
  const fresh = deferred<string>();
  const before = cached(key, 60, () => old.promise);
  const rejection = assert.rejects(before, /obsolete/);
  await Promise.resolve();
  invalidate(key);
  let queries = 0;
  const fetcher = () => { queries++; return fresh.promise; };
  const after = cached(key, 60, fetcher);
  old.reject(new Error("obsolete"));
  await rejection;
  const joined = cached(key, 60, fetcher);
  fresh.resolve("fresh");
  assert.deepEqual(await Promise.all([after, joined]), ["fresh", "fresh"]);
  assert.equal(queries, 1);
  invalidate(key);
});

test("TTL expires deterministically and null remains a cache hit", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const key = "cache-test:ttl";
  let queries = 0;
  const fetcher = async () => { queries++; return null; };
  try {
    assert.equal(await cached(key, 1, fetcher), null);
    assert.equal(await cached(key, 1, fetcher), null);
    assert.equal(queries, 1);
    t.mock.timers.tick(1_001);
    assert.equal(await cached(key, 1, fetcher), null);
    assert.equal(queries, 2);
  } finally {
    invalidate(key);
    t.mock.timers.reset();
  }
});

// ---------------------------------------------------------------------------
// invalidateChatContext / invalidateAllChatContext — write-through
// invalidation of every per-student chat context layer.
// ---------------------------------------------------------------------------

test("invalidateChatContext clears every chat layer for the student and nothing else", async () => {
  const sid = "cache-test-sid-a";
  const otherSid = "cache-test-sid-b";
  const studentKeys = [
    `chat:base-context:${sid}:conv-1:discovery:3`,
    `chat:base-context:${sid}:conv-2:daily:3`,
    `chat:snapshot:${sid}`,
    `chat:skill-gap:${sid}`,
    `chat:pathway:${sid}`,
    `chat:career-thread:${sid}`,
    `chat:profile:${sid}`,
  ];
  const survivorKeys = [
    `chat:base-context:${otherSid}:conv-9:discovery:3`,
    `chat:snapshot:${otherSid}`,
    // Rate-limit-shaped key (src/app/api/chat/send/route.ts) — no layer, must survive.
    `chat:${sid}`,
    `unrelated:${sid}`,
  ];
  for (const key of [...studentKeys, ...survivorKeys]) {
    await cached(key, 60, async () => "warm");
  }

  invalidateChatContext(sid);

  for (const key of studentKeys) {
    let recomputed = false;
    await cached(key, 60, async () => {
      recomputed = true;
      return "fresh";
    });
    assert.equal(recomputed, true, `expected ${key} to be invalidated`);
  }
  for (const key of survivorKeys) {
    let recomputed = false;
    await cached(key, 60, async () => {
      recomputed = true;
      return "?";
    });
    assert.equal(recomputed, false, `expected ${key} to survive`);
    invalidate(key);
  }
  for (const key of studentKeys) invalidate(key);
});

test("invalidateAllChatContext clears chat layers for every student but not layerless chat keys", async () => {
  const keys = [
    "chat:base-context:sid-x:conv:discovery:3",
    "chat:snapshot:sid-y",
    "chat:profile:sid-z",
  ];
  const rateLimitKey = "chat:sid-x";
  for (const key of [...keys, rateLimitKey]) {
    await cached(key, 60, async () => "warm");
  }

  invalidateAllChatContext();

  for (const key of keys) {
    let recomputed = false;
    await cached(key, 60, async () => {
      recomputed = true;
      return "fresh";
    });
    assert.equal(recomputed, true, `expected ${key} to be invalidated`);
    invalidate(key);
  }
  let rateLimitRecomputed = false;
  await cached(rateLimitKey, 60, async () => {
    rateLimitRecomputed = true;
    return "?";
  });
  assert.equal(rateLimitRecomputed, false, "layerless chat:<id> key must survive");
  invalidate(rateLimitKey);
});

// ---------------------------------------------------------------------------
// Cache overflow — a full cache must degrade to a miss, never to an error.
//
// node-cache is configured with `maxKeys: 10_000` and THROWS `ECACHEFULL`
// from set() once it is full instead of evicting. `cached()` used to call
// set() unguarded, so the throw propagated to whoever was awaiting it —
// including `getSession()` in src/lib/auth.ts, which caches every session
// lookup for 10s. Attacker-growable key sources exist (`credly:<username>`,
// with the username set by the caller, and the documents-list key), so the
// cache could be filled deliberately and every authenticated request would
// then 500.
//
// This block runs LAST in the file on purpose: it fills the module's
// singleton adapter and never empties it.
// ---------------------------------------------------------------------------

test("cache adapter and snapshot failures never fail a successful fetch", async (t) => {
  const key = "cache-test:adapter-failure";
  const failure = () => { throw new Error("cache unavailable"); };
  t.mock.method(NodeCache.prototype, "get", failure);
  t.mock.method(NodeCache.prototype, "set", failure);
  t.mock.method(NodeCache.prototype, "del", failure);
  t.mock.method(NodeCache.prototype, "keys", failure);
  const value = { ok: true };
  assert.deepEqual(await cached(key, 60, async () => value), value);
  assert.doesNotThrow(() => invalidate(key));
  assert.doesNotThrow(() => invalidatePrefix("cache-test:adapter-failure"));
});

const MAX_KEYS = 10_000;

async function fillCacheToCapacity(): Promise<void> {
  for (let i = 0; i < MAX_KEYS; i++) {
    await cached(`cache-test:fill:${i}`, 600, async () => i);
  }
}

test("cached() returns the fetched value when the cache is full instead of throwing", async () => {
  await fillCacheToCapacity();

  const value = await cached("cache-test:overflow:a", 10, async () => "fresh-value");

  assert.equal(
    value,
    "fresh-value",
    "a full cache must degrade to a miss and still return the fetched value",
  );
});

test("cached() treats a full cache as a permanent miss, re-invoking the fetcher", async () => {
  await fillCacheToCapacity();

  let callCount = 0;
  const fetcher = async () => {
    callCount++;
    return `value-${callCount}`;
  };

  const first = await cached("cache-test:overflow:b", 10, fetcher);
  const second = await cached("cache-test:overflow:b", 10, fetcher);

  assert.equal(first, "value-1");
  assert.equal(second, "value-2", "the un-stored key must be re-fetched, not error");
  assert.equal(callCount, 2);
});

test("invalidate() and invalidatePrefix() stay quiet when the cache is full", async () => {
  await fillCacheToCapacity();

  assert.doesNotThrow(() => invalidate("cache-test:overflow:never-stored"));
  assert.doesNotThrow(() => invalidatePrefix("cache-test:overflow:"));
  assert.doesNotThrow(() => invalidateChatContext("cache-test-overflow-sid"));
});
