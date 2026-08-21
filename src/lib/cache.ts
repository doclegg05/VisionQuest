import NodeCache from "node-cache";

// ---------------------------------------------------------------------------
// Cache adapter interface
//
// The app uses InMemoryCacheAdapter by default (single-instance Render).
// When REDIS_URL is set, swap to RedisCacheAdapter for multi-instance support.
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

class InMemoryCacheAdapter implements CacheAdapter {
  private cache: NodeCache;

  constructor() {
    this.cache = new NodeCache({
      stdTTL: 60,
      checkperiod: 120,
      useClones: true,
      maxKeys: 10_000,
    });
  }

  get<T>(key: string): T | undefined {
    return this.cache.get<T>(key);
  }

  set(key: string, value: unknown, ttlSeconds: number): void {
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

// ---------------------------------------------------------------------------
// Public API — unchanged signatures, backed by adapter
// ---------------------------------------------------------------------------

/**
 * Get a cached value, or compute + store it on miss.
 *
 * Usage:
 *   const goals = await cached(`goals:${userId}`, 30, () => prisma.goal.findMany(...));
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = adapter.get<T>(key);
  if (hit !== undefined) return hit;

  const value = await fetcher();
  adapter.set(key, value, ttlSeconds);
  return value;
}

/**
 * Invalidate a single cache key.
 */
export function invalidate(key: string): void {
  adapter.del(key);
}

/**
 * Invalidate all keys that start with a prefix.
 * Useful for busting all of a user's cached data on writes.
 */
export function invalidatePrefix(prefix: string): void {
  adapter.delPrefix(prefix);
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
    adapter.delPrefix(`${prefix}${studentId}`);
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
    adapter.delPrefix(prefix);
  }
}
