/**
 * Process-cache rules for the student dashboard's reads (F2, the read diet).
 *
 * Every entry here obeys four rules, and this module is where they live:
 * 1. A per-student key holds the student's id, and only that student's own
 *    session fills it (`ownStudentId`): a teacher computing on a student's
 *    behalf never reads or fills one.
 * 2. Nothing empty is kept (`cachedWhen`): in production a query that lost its
 *    RLS context returns no rows, and a kept zero would pin "Finish your
 *    orientation" on a student for the whole TTL. An errored read is never
 *    kept either, because `cached()` only stores a value its fetcher returned.
 * 3. Alerts, tasks, saved jobs, applications and appointments are never cached;
 *    nothing invalidates them. Those reads stay in src/lib/dashboard/live.ts.
 * 4. The keys sit under the chat snapshot layer (`chat:snapshot:`), so every
 *    invalidation that already clears a student's chat snapshot clears these:
 *    the write-through on the app client (src/lib/chat-context-write-through.ts),
 *    and every `prismaAdmin` writer that hand-invalidates, which
 *    src/lib/db.admin-write-through.test.ts enforces. student-cache.test.ts
 *    pins that coupling to the prefixes in src/lib/cache.ts.
 */
import { cached } from "@/lib/cache";

/** The session fields the cache rules read. */
export interface CacheSession {
  readonly id: string;
  readonly role: string;
}

export class NotOwnStudentError extends Error {
  constructor() {
    super("Dashboard caches are filled only from a student's own session.");
    this.name = "NotOwnStudentError";
  }
}

/** The student id a cache key may hold, or a throw for any staff session. */
export function ownStudentId(session: CacheSession): string {
  if (session.role !== "student") throw new NotOwnStudentError();
  return session.id;
}

/** A per-student key. `invalidateChatContext(studentId)` clears it. */
export function studentCacheKey(session: CacheSession, layer: string): string {
  return `chat:snapshot:${ownStudentId(session)}:dashboard:${layer}`;
}

/**
 * A key for a row every role reads the same (an RLS policy of USING (true)).
 * `invalidateAllChatContext()` clears it, which the write-through calls for
 * every OrientationItem and CertTemplate write.
 */
export function globalCacheKey(name: string): string {
  return `chat:snapshot:~global:dashboard:${name}`;
}

class NotKept extends Error {}

/**
 * `cached()`, except a value `keep` rejects is returned and not stored, so the
 * next caller reads again. A caller that shared the in-flight read of such a
 * value reads again itself.
 */
export async function cachedWhen<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  keep: (value: T) => boolean,
): Promise<T> {
  // An array, not a nullable variable: the fetcher closure writes it, which
  // control-flow narrowing cannot see.
  const unkept: T[] = [];
  try {
    return await cached(key, ttlSeconds, async () => {
      const value = await fetcher();
      if (keep(value)) return value;
      unkept.push(value);
      throw new NotKept();
    });
  } catch (error) {
    if (!(error instanceof NotKept)) throw error;
    return unkept.length > 0 ? unkept[0] : fetcher();
  }
}
