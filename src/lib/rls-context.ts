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
