import NodeCache from "node-cache";

/**
 * In-memory TTL cache for hot paths.
 *
 * Good for single-instance deployments (Render starter plan).
 * Replace with Redis if you scale to multiple instances.
 */
const appCache = new NodeCache({
  stdTTL: 60, // default 60s
  checkperiod: 120, // eviction check every 120s
  useClones: true, // safe: callers get copies, preventing cross-request mutation
  maxKeys: 10_000, // hard cap to prevent memory exhaustion
});

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
  const hit = appCache.get<T>(key);
  if (hit !== undefined) return hit;

  const value = await fetcher();
  appCache.set(key, value, ttlSeconds);
  return value;
}

/**
 * Invalidate a single cache key.
 */
export function invalidate(key: string): void {
  appCache.del(key);
}

/**
 * Invalidate all keys that start with a prefix.
 * Useful for busting all of a user's cached data on writes.
 */
export function invalidatePrefix(prefix: string): void {
  const keys = appCache.keys().filter((k) => k.startsWith(prefix));
  if (keys.length > 0) appCache.del(keys);
}
