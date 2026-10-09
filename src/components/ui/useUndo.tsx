"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X } from "@phosphor-icons/react";
import { createUndoQueue, type UndoableAction, type UndoQueue, type UndoSnapshot } from "@/lib/undo-queue";

/** How long the "restored" confirmation stays. It needs no action, so this is not a time limit on anything. */
const RESTORED_NOTICE_MS = 4000;

const nothingOnServer = () => null;

interface UndoToastViewProps {
  snapshot: UndoSnapshot | null;
  onUndo: () => void;
  onDismiss: () => void;
  undoRef?: React.Ref<HTMLButtonElement>;
}

/**
 * The notice itself. The live region stays mounted so screen readers announce
 * each change, and the inner node is keyed by id so a repeated label is
 * announced again. It sits above the phone tab bar, clear of the desktop Sage
 * button. --accent-strong is re-pointed so the global focus ring stays
 * visible on the inverted background.
 */
export function UndoToastView({ snapshot, onUndo, onDismiss, undoRef }: UndoToastViewProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] z-50 flex justify-center md:inset-x-0 md:bottom-6"
    >
      {snapshot && (
        <div
          key={snapshot.id}
          data-notice-id={snapshot.id}
          className="pointer-events-auto flex items-center gap-1 rounded-2xl bg-[var(--ink-strong)] py-1.5 pl-4 pr-1.5 text-sm font-medium text-[var(--surface-base)] shadow-[var(--shadow-card)] [--accent-strong:var(--surface-base)]"
        >
          <span className={snapshot.kind === "restored" ? "py-2.5 pr-2.5" : "pr-1"}>{snapshot.label}</span>
          {snapshot.kind === "pending" && (
            <>
              <button
                ref={undoRef}
                type="button"
                onClick={onUndo}
                className="inline-flex min-h-11 items-center rounded-xl px-4 font-semibold text-[var(--surface-base)] underline underline-offset-4 hover:bg-[var(--surface-base)]/10"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss"
                className="inline-flex size-11 items-center justify-center rounded-xl text-[var(--surface-base)] hover:bg-[var(--surface-base)]/10"
              >
                <X size={18} weight="bold" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Remove now, send the request later, and let the person take it back.
 *
 * Usage:
 *   const { scheduleRemoval, undoToast } = useUndo();
 *   hideItem(id);
 *   scheduleRemoval({
 *     label: "Pin removed.", restoredLabel: "Pin restored.",
 *     commit: () => deletePin(id), restore: () => showItem(id),
 *     focusAfterRestore: () => document.getElementById(`pin-${id}-remove`),
 *   });
 *   return (<>{...}{undoToast}</>);
 *
 * There is no timer. The request is sent when the person dismisses the notice,
 * makes another removal, leaves the page, or hides the tab (iOS may discard a
 * hidden tab). Give the commit's fetch `keepalive: true` so it survives that.
 */
export function useUndo(): { scheduleRemoval: (action: UndoableAction) => void; undoToast: React.ReactNode } {
  const [queue] = useState<UndoQueue>(() => createUndoQueue());
  const snapshot = useSyncExternalStore(queue.subscribe, queue.current, nothingOnServer);
  const undoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") queue.flush();
    };
    window.addEventListener("pagehide", queue.flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", queue.flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      queue.flush();
    };
  }, [queue]);

  useEffect(() => {
    if (snapshot?.kind !== "restored") return;
    const timer = window.setTimeout(queue.clear, RESTORED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [queue, snapshot]);

  const scheduleRemoval = useCallback(
    (action: UndoableAction) => {
      queue.push(action);
      // The removed row usually took the focused control with it. Put focus on
      // Undo then, so keyboard and VoiceOver users can reach it at once.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body) undoRef.current?.focus();
      });
    },
    [queue],
  );

  const undo = useCallback(() => {
    const action = queue.undo();
    if (action?.focusAfterRestore) requestAnimationFrame(() => action.focusAfterRestore?.()?.focus());
  }, [queue]);

  return {
    scheduleRemoval,
    undoToast: <UndoToastView snapshot={snapshot} onUndo={undo} onDismiss={queue.flush} undoRef={undoRef} />,
  };
}
