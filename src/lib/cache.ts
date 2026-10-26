import NodeCache from "node-cache";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Cache adapter interface
//
// The app uses InMemoryCacheAdapter by default (single-instance Render).
// Multi-instance support requires implementing a shared adapter (see below).
// ---------------------------------------------------------------------------

interface CacheAdapter {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown, ttlSeconds: number): void;
  del(key: string): void;
  delPrefix(prefix: string): void;
}

// ---------------------------------------------------------------------------
// In-memory adapter (default) — uses node-cache
// ---------------------------------------------------------------------------

const MAX_KEYS = 10_000;

class InMemoryCacheAdapter implements CacheAdapter {
  private cache: NodeCache;

  constructor() {
    this.cache = new NodeCache({
      stdTTL: 60,
      checkperiod: 120,
      useClones: true,
      maxKeys: MAX_KEYS,
    });
  }

  get<T>(key: string): T | undefined {
    return this.cache.get<T>(key);
  }

  set(key: string, value: unknown, ttlSeconds: number): void {
    // Cache admission is optional: a full cache must not fail a successful read.
    // node-cache checks capacity even for replacements, so remove those first.
    this.cache.del(key);
    if (this.cache.getStats().keys >= MAX_KEYS) return;
    this.cache.set(key, value, ttlSeconds);
  }

  del(key: string): void {
    this.cache.del(key);
  }

  delPrefix(prefix: string): void {
    const keys = this.cache.keys().filter((k) => k.startsWith(prefix));
    if (keys.length > 0) this.cache.del(keys);
  }
}

// ---------------------------------------------------------------------------
// Redis adapter stub — activate by setting REDIS_URL environment variable
//
// To implement: npm install ioredis, replace the stub methods below.
// The function signatures are identical to InMemoryCacheAdapter.
// ---------------------------------------------------------------------------

// Uncomment and implement when scaling to multiple instances:
//
// import Redis from "ioredis";
//
// class RedisCacheAdapter implements CacheAdapter {
//   private client: Redis;
//   constructor(url: string) { this.client = new Redis(url); }
//   get<T>(key: string): T | undefined { /* redis GET + JSON.parse */ }
//   set(key: string, value: unknown, ttlSeconds: number): void { /* redis SET EX */ }
//   del(key: string): void { /* redis DEL */ }
//   delPrefix(prefix: string): void { /* redis SCAN + DEL */ }
// }

// ---------------------------------------------------------------------------
// Singleton adapter
// ---------------------------------------------------------------------------

const adapter: CacheAdapter = new InMemoryCacheAdapter();
// Promise identity acts as the generation token; invalidation detaches old work.
// No permanent per-key generation counters (which would grow without bound).
const inFlight = new Map<string, Promise<() => unknown>>();

// ---------------------------------------------------------------------------
// Public API — unchanged signatures, backed by adapter
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cache failures degrade to misses, never to errors.
//
// node-cache is configured with `maxKeys: 10_000` and THROWS `ECACHEFULL` from
// set() once full — it does not evict. `cached()` used to call set() unguarded,
// so that throw propagated to whoever was awaiting it. getSession() caches
// every session lookup here for 10s, so a full cache turned every
// authenticated request into a 500, and the cache is fillable from outside:
// `credly:<username>` takes a caller-set username with a 600s TTL, and the
// documents-list key carries caller-supplied search text.
//
// A cache is an optimisation. Failing to store a value must cost a re-fetch,
// never a request. Every adapter call a request path can reach is therefore
// guarded, and failures are logged at warn level with the key OMITTED — cache
// keys carry student ids (`session:<id>:<sv>`, `chat:profile:<sid>`), which
// are PII in logs per .claude/rules/security.md.
// ---------------------------------------------------------------------------

/** Log at most one cache-failure line per minute, so a full cache cannot
 *  itself become a log flood on top of the degradation it already causes. */
const CACHE_WARN_INTERVAL_MS = 60_000;
let lastCacheWarnAt = 0;
let suppressedCacheWarnings = 0;

function noteCacheFailure(operation: string, error: unknown): void {
  const now = Date.now();
  if (now - lastCacheWarnAt < CACHE_WARN_INTERVAL_MS) {
    suppressedCacheWarnings++;
    return;
  }
  const suppressed = suppressedCacheWarnings;
  lastCacheWarnAt = now;
  suppressedCacheWarnings = 0;
  logger.warn("cache_operation_failed", {
    operation,
    // ECACHEFULL is the expected value here; anything else is worth seeing.
    reason: error instanceof Error ? error.name : "unknown",
    suppressedSinceLastLog: suppressed,
  });
}

/**
 * Get a cached value, or compute + store it on miss.
 *
 * A store failure is swallowed: the freshly fetched value is still returned,
 * and the key simply stays uncached (so the next call re-fetches). See the
 * block comment above for why this must never throw.
 *
 * Usage:
 *   const goals = await cached(`goals:${userId}`, 30, () => prisma.goal.findMany(...));
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  let hit: T | undefined;
  try {
    hit = adapter.get<T>(key);
  } catch (error) {
    noteCacheFailure("get", error);
  }
  if (hit !== undefined) return hit;

  let pending = inFlight.get(key);
  if (!pending) {
    // Bound retained pending work too. Overflow reads bypass caching entirely.
    if (inFlight.size >= MAX_KEYS) return fetcher();
    pending = Promise.resolve().then(async () => {
      const value = await fetcher();
      if (inFlight.get(key) === pending) {
        try {
          adapter.set(key, value, ttlSeconds);
        } catch (error) {
          noteCacheFailure("set", error);
        }
      }
      // Give coalesced callers independent copies using the same cloning
      // semantics as cache hits, even if invalidation or capacity skips storage.
      try {
        const snapshot = new NodeCache({ checkperiod: 0, useClones: true });
        snapshot.set("value", value);
        return () => {
          try {
            return snapshot.get<T>("value");
          } catch (error) {
            noteCacheFailure("snapshotGet", error);
            return value;
          }
        };
      } catch (error) {
        noteCacheFailure("snapshotSet", error);
        return () => value;
      }
    }).finally(() => {
      // An obsolete completion must not remove a newer generation's promise.
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });
    inFlight.set(key, pending);
  }
  const readSnapshot = await pending;
  return readSnapshot() as T;
}

/**
 * Invalidate a single cache key. Never throws — a failed invalidation is
 * logged and the stale entry is left to expire on its TTL.
 */
export function invalidate(key: string): void {
  inFlight.delete(key);
  try {
    adapter.del(key);
  } catch (error) {
    noteCacheFailure("del", error);
  }
}

/**
 * Invalidate all keys that start with a prefix.
 * Useful for busting all of a user's cached data on writes.
 */
export function invalidatePrefix(prefix: string): void {
  for (const key of inFlight.keys()) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
  try {
    adapter.delPrefix(prefix);
  } catch (error) {
    noteCacheFailure("delPrefix", error);
  }
}

// ---------------------------------------------------------------------------
// Chat context write-through invalidation
//
// Every cached layer of Sage's per-student chat context, keyed as
// `chat:<layer>:<studentId>[...]`. When a native write changes state one of
// these layers reads, the layer must be dropped so Sage's NEXT reply sees the
// change instead of waiting out the TTL (proven by
// scripts/sage-freshness-eval.mjs Group B).
//
// Layer registry — one entry per `cached("chat:...")` call site:
//   chat:base-context:<sid>:<conv>:<stage>:<n>  src/lib/chat/context.ts
//   chat:skill-gap:<sid>                        src/lib/chat/context.ts
//   chat:pathway:<sid>                          src/lib/chat/context.ts
//   chat:career-thread:<sid>                    src/lib/chat/context.ts
//   chat:snapshot:<sid>                         src/lib/sage/situational-snapshot.ts
//   chat:profile:<sid>                          src/lib/sage/memory/profile.ts
//
// NOT in the registry: `chat:<sid>` (the chat rate-limit key in
// /api/chat/send) — it has no layer segment and must survive invalidation.
// ---------------------------------------------------------------------------

const CHAT_CONTEXT_LAYER_PREFIXES = [
  "chat:base-context:",
  "chat:skill-gap:",
  "chat:pathway:",
  "chat:career-thread:",
  "chat:snapshot:",
  "chat:profile:",
] as const;

/**
 * Drop every cached chat-context layer for one student (prefix-delete, so the
 * per-conversation base-context variants all go too).
 */
export function invalidateChatContext(studentId: string): void {
  for (const prefix of CHAT_CONTEXT_LAYER_PREFIXES) {
    invalidatePrefix(`${prefix}${studentId}`);
  }
}

/**
 * Drop every student's cached chat-context layers. Fallback for writes whose
 * student cannot be determined (global rows like OrientationItem, or bulk
 * writes keyed by something other than studentId) — over-invalidation is a
 * few re-queries; under-invalidation is Sage contradicting a change it should
 * know about.
 */
export function invalidateAllChatContext(): void {
  for (const prefix of CHAT_CONTEXT_LAYER_PREFIXES) {
    invalidatePrefix(prefix);
  }
}
