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
 *
 * Where these rules stop holding:
 * - The cache is in-process memory (src/lib/cache.ts). It assumes one Render
 *   instance. A second instance would keep its own copies and never see the
 *   other's invalidations, so a write on one would leave the other serving the
 *   old value for up to the TTL. Scaling past one instance breaks invalidation
 *   and needs a shared cache, or these TTLs cut to what may lag, first.
 * - Only writes through the app's `prisma` client invalidate (plus the
 *   `prismaAdmin` writers that hand-invalidate). A seed script, a SQL editor
 *   session or any other process writing while the server runs leaves kept
 *   values in place for up to 10 minutes (every TTL here is 600 s).
 * - A deploy or restart empties the cache, so the first request after one
 *   reads everything fresh.
 */
import { cached, invalidate, invalidatePrefixSuffix } from "@/lib/cache";

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
  return keyForStudent(ownStudentId(session), layer);
}

const STUDENT_KEY_PREFIX = "chat:snapshot:";

function keyForStudent(studentId: string, layer: string): string {
  return `${STUDENT_KEY_PREFIX}${studentId}${layerSuffix(layer)}`;
}

function layerSuffix(layer: string): string {
  return `:dashboard:${layer}`;
}

/** The layer of a student's kept slow signals (./signals.ts). */
export const SLOW_SIGNALS_LAYER = "slow";

/**
 * Drops one student's kept slow signals and nothing else: not the shell, the
 * layout gates or Sage's chat layers. For writes made on nearly every chat
 * turn (a message, a conversation stage), where clearing all of the
 * student's chat context would undo Sage's cache.
 */
export function invalidateKeptSlowSignals(studentId: string): void {
  invalidate(keyForStudent(studentId, SLOW_SIGNALS_LAYER));
}

/**
 * Drops every student's kept slow signals and nothing else. For a per-turn
 * chat write that names no student: clearing all chat context instead would
 * drop every student's Sage layers on one message.
 */
export function invalidateAllKeptSlowSignals(): void {
  invalidatePrefixSuffix(STUDENT_KEY_PREFIX, layerSuffix(SLOW_SIGNALS_LAYER));
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
