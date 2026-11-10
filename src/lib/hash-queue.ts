/**
 * Password-hash work runs a few at a time, and the rest waits its turn.
 *
 * Hashing happens on Node's thread pool (src/lib/auth.ts), so it no longer
 * stops the one event loop every request shares. That pool has four threads
 * by default, and file reads, DNS lookups and response compression use it
 * too. One scrypt call at the app's parameters also holds about 32 MB while
 * it runs. A classroom of 30 signing in together must therefore not start 30
 * hashes at once: they queue here, in the order they arrived.
 *
 * The queue holds only waiting callers. It has no length limit and never
 * refuses work, so a sign-in is slower under load and never answered
 * differently. What bounds the load is the sign-in rate limits, which count
 * an attempt before its hash is asked for (src/app/api/auth/login/route.ts).
 */

/**
 * How many hashes run at once. Two of the pool's four threads stay free for
 * everything else, and scrypt holds at most about 64 MB. The service runs on
 * a small instance (`plan: starter` in render.yaml), so more at once would
 * not finish sooner. Raise this only for a measured need, and do not raise
 * the thread pool to make room for it.
 */
export const MAX_CONCURRENT_HASHES = 2;

/** Runs `job` when a slot is free, and answers what the job answers. */
export type HashJobRunner = <T>(job: () => Promise<T>) => Promise<T>;

/**
 * A runner that lets `limit` jobs run at once. Each runner has its own slots
 * and its own queue; the app uses the one `runHashJob` below.
 */
export function createHashJobRunner(limit: number): HashJobRunner {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("A hash queue must allow at least 1 job at a time");
  }
  let running = 0;
  const waiting: Array<() => void> = [];

  return async function runHashJob<T>(job: () => Promise<T>): Promise<T> {
    if (running < limit) {
      running += 1;
    } else {
      // The job that finishes next hands its slot straight to this caller.
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await job();
    } finally {
      const next = waiting.shift();
      // A handed-over slot stays counted, so a caller that arrives between
      // this job ending and the next one starting cannot take it first.
      if (next) next();
      else running -= 1;
    }
  };
}

/** The one queue every password and security-answer hash goes through. */
export const runHashJob: HashJobRunner = createHashJobRunner(MAX_CONCURRENT_HASHES);
