import { AsyncLocalStorage } from "node:async_hooks";

export interface RlsContext {
  userId: string;
  role: string;
  studentId: string;
  _rlsInjected?: boolean;
}

const storage = new AsyncLocalStorage<RlsContext>();

/**
 * Run a callback with RLS context available via `getRlsContext()`.
 * Supports nesting — inner contexts are independent and restore the
 * outer context when they exit.
 */
export function withRlsContext<T>(ctx: RlsContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Retrieve the current RLS context, or `undefined` if called outside
 * of a `withRlsContext` scope.
 */
export function getRlsContext(): RlsContext | undefined {
  return storage.getStore();
}

/**
 * Run `fn` as the student themself: `userId` and `studentId` are both the
 * student's id and the role is `student`, so every app-client query inside
 * resolves through the policies' own-row branch
 * (`"studentId" = current_setting('app.current_user_id')`).
 *
 * For code that has no request session: cron bodies under
 * `src/app/api/internal` and `src/app/api/cron`, and job handlers in
 * `src/lib/jobs-registry.ts`. Under `vq_app` an app-client query with no
 * context fails closed (reads return no rows, writes are rejected), and a
 * per-student catch turns that into a silent "0 of N". Precedent:
 * `runDailyBriefing` in `src/lib/sage/briefing.ts` and
 * `src/lib/sage/wager-diagnosis.ts`. Cross-student reads (a roster, all
 * active students) have no student branch and belong on `prismaAdmin`.
 */
export function withStudentRlsContext<T>(studentId: string, fn: () => T): T {
  return withRlsContext({ userId: studentId, role: "student", studentId }, fn);
}
