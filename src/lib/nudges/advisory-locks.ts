/**
 * The two nudge advisory locks, in one place.
 *
 * They used to be two raw statements written out at their call sites, which is
 * how the same mistake came to exist in both at once: each interpolated its
 * class id as a bare JavaScript number, Prisma bound that as bigint, and
 * Postgres — which has exactly two overloads, `(bigint)` and `(int, int)` —
 * matched neither and raised 42883 on every call. The run lock's catch turned
 * that into `skipped: "run lock unavailable"` and `sendPolicySms`, being total,
 * turned it into `refused: send_error`, so the SMS nudge feature was entirely
 * dead while answering 200 and logging one line per sweep.
 *
 * One home means the `::int` casts are one decision rather than two, and it
 * gives the guard in `src/lib/rls.test.ts` something real to call: that test
 * executes THESE functions against the CI Postgres, so dropping a cast here
 * reds it. A test that re-typed the SQL instead would have gone on passing
 * while production was broken.
 *
 * Both locks are TRANSACTION-scoped, and must stay that way — see
 * ADVISORY_LOCK_CLASS in ./sms-policy-shared for why a session-scoped lock
 * leaks permanently through a connection pool.
 */
import type { Prisma } from "@prisma/client";

import { ADVISORY_LOCK_CLASS } from "./sms-policy-shared";

/**
 * Just the raw-query surface, so a caller can pass an interactive-transaction
 * client, a full `PrismaClient`, or a test double without a cast.
 */
export type RawCapableClient = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

/**
 * Try to take the deployment-wide sweep lock. `false` means another sweep
 * already holds it — the caller should stand down, not wait.
 *
 * Released by COMMIT or ROLLBACK of `tx`'s transaction; there is deliberately
 * no unlock function to call, because a separate unlock statement is what
 * leaked the session-scoped predecessor across the pool.
 */
export async function tryTakeRunLock(tx: RawCapableClient, key: string): Promise<boolean> {
  // `::int` is load-bearing: without it this resolves to (bigint, integer),
  // which does not exist. See the module header.
  const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_CLASS.nudgeRun}::int, hashtext(${key})) AS locked
  `;
  return rows[0]?.locked === true;
}

/**
 * Take the per-recipient send lock, waiting if another sender holds it.
 *
 * This one blocks rather than trying, because the daily-cap check that follows
 * it is a read-then-write: two concurrent senders that both skipped the lock
 * would both see the same count and both send, which is the race the cap
 * exists to prevent.
 */
export async function takeSendLock(tx: RawCapableClient, studentId: string): Promise<void> {
  // `::int` is load-bearing here too, for the same reason.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASS.smsSend}::int, hashtext(${studentId}))`;
}
