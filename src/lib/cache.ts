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
