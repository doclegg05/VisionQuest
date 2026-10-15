/** A removal the person can take back until they dismiss the notice. */
export interface UndoableAction {
  /** Notice text, for example "Goal removed." */
  label: string;
  /** Announced after Undo. Defaults to "Restored." */
  restoredLabel?: string;
  /** Sends the real request. Runs once: on dismiss, on the next removal, or when the page is left. */
  commit: () => Promise<void>;
  /** Puts the item back on screen. Runs on undo, or when commit fails. */
  restore: () => void;
  /** Called after restore when commit fails, so the caller can explain why. */
  onCommitError?: (error: unknown) => void;
  /** The element to focus once the item is back, so keyboard users keep their place. */
  focusAfterRestore?: () => HTMLElement | null;
}

/** What the notice shows. A new id on every change, so a repeated label is announced again. */
export interface UndoSnapshot {
  id: number;
  kind: "pending" | "restored";
  label: string;
}

export interface UndoQueue {
  push: (action: UndoableAction) => void;
  /** Restores the pending item and returns it, or null when nothing is pending. */
  undo: () => UndoableAction | null;
  /** Sends the pending removal now. */
  flush: () => void;
  /** Hides a restored notice. */
  clear: () => void;
  current: () => UndoSnapshot | null;
  subscribe: (listener: () => void) => () => void;
}

/**
 * One pending removal at a time, with no timer: a time limit on Undo shuts out
 * people who need longer to reach it (WCAG 2.2.1). A new removal sends the
 * previous one at once, so nothing waits behind a notice that is gone.
 */
export function createUndoQueue(): UndoQueue {
  let pending: UndoableAction | null = null;
  let snapshot: UndoSnapshot | null = null;
  let nextId = 1;
  const listeners = new Set<() => void>();

  function show(next: Omit<UndoSnapshot, "id"> | null): void {
    snapshot = next ? { ...next, id: nextId++ } : null;
    listeners.forEach((listener) => listener());
  }

  function run(action: UndoableAction): void {
    // Promise.resolve().then also catches a commit that throws synchronously.
    Promise.resolve()
      .then(() => action.commit())
      .catch((error: unknown) => {
        action.restore();
        action.onCommitError?.(error);
      });
  }

  function flush(): void {
    const action = pending;
    if (!action) return;
    pending = null;
    show(null);
    run(action);
  }

  return {
    push(action) {
      flush();
      pending = action;
      show({ kind: "pending", label: action.label });
    },
    undo() {
      const action = pending;
      if (!action) return null;
      pending = null;
      action.restore();
      show({ kind: "restored", label: action.restoredLabel ?? "Restored." });
      return action;
    },
    flush,
    clear() {
      if (snapshot?.kind === "restored") show(null);
    },
    current: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
