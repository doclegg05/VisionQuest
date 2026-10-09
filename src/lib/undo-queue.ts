/** Timer functions, injectable so tests control the clock. */
export interface UndoTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

/** A removal the person can take back until its window closes. */
export interface UndoableAction {
  /** Toast text, for example "Goal removed." */
  label: string;
  /** Sends the real request. Runs once, after the window or on flush. */
  commit: () => Promise<void>;
  /** Puts the item back on screen. Runs on undo, or when commit fails. */
  restore: () => void;
  /** Called after restore when commit fails, so the caller can explain why. */
  onCommitError?: (error: unknown) => void;
}

export interface UndoQueue {
  push: (action: UndoableAction) => void;
  undo: () => void;
  flush: () => void;
  current: () => string | null;
  subscribe: (listener: () => void) => () => void;
}

export const UNDO_WINDOW_MS = 6000;

/**
 * One pending removal at a time. A new removal commits the previous one at
 * once, so nothing waits behind a toast the person can no longer see.
 */
export function createUndoQueue(timers: UndoTimers, windowMs: number = UNDO_WINDOW_MS): UndoQueue {
  let pending: { action: UndoableAction; handle: unknown } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function take(): UndoableAction | null {
    if (!pending) return null;
    timers.clear(pending.handle);
    const { action } = pending;
    pending = null;
    return action;
  }

  function run(action: UndoableAction): void {
    action.commit().catch((error: unknown) => {
      action.restore();
      action.onCommitError?.(error);
    });
  }

  function flush(): void {
    const action = take();
    if (!action) return;
    notify();
    run(action);
  }

  return {
    push(action) {
      flush();
      pending = { action, handle: timers.set(flush, windowMs) };
      notify();
    },
    undo() {
      const action = take();
      if (!action) return;
      notify();
      action.restore();
    },
    flush,
    current: () => pending?.action.label ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
