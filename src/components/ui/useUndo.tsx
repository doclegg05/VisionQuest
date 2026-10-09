"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createUndoQueue, type UndoableAction, type UndoQueue } from "@/lib/undo-queue";

const browserTimers = {
  set: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
  clear: (handle: unknown) => window.clearTimeout(handle as number),
};

const nothingPendingOnServer = () => null;

interface UndoToastViewProps {
  label: string | null;
  onUndo: () => void;
}

/**
 * The toast itself. The live region stays mounted so screen readers announce
 * each new label. Sits above the phone tab bar, clear of the desktop Sage button.
 */
export function UndoToastView({ label, onUndo }: UndoToastViewProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] z-50 flex justify-center md:inset-x-0 md:bottom-6"
    >
      {label && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-[var(--ink-strong)] py-1.5 pl-4 pr-1.5 text-sm font-medium text-[var(--surface-base)] shadow-[var(--shadow-card)]">
          <span>{label}</span>
          <button
            type="button"
            onClick={onUndo}
            className="inline-flex min-h-11 items-center rounded-xl px-4 font-semibold text-[var(--surface-base)] underline underline-offset-4 hover:bg-[var(--surface-base)]/10"
          >
            Undo
          </button>
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
 *   scheduleRemoval({ label: "Pin removed.", commit: () => deletePin(id), restore: () => showItem(id) });
 *   return (<>{...}{undoToast}</>);
 *
 * Anything pending is sent when the component unmounts or the page is hidden.
 * Give the commit's fetch `keepalive: true` so it survives a tab close.
 */
export function useUndo(): { scheduleRemoval: (action: UndoableAction) => void; undoToast: React.ReactNode } {
  const [queue] = useState<UndoQueue>(() => createUndoQueue(browserTimers));
  const label = useSyncExternalStore(queue.subscribe, queue.current, nothingPendingOnServer);

  useEffect(() => {
    window.addEventListener("pagehide", queue.flush);
    return () => {
      window.removeEventListener("pagehide", queue.flush);
      queue.flush();
    };
  }, [queue]);

  return {
    scheduleRemoval: queue.push,
    undoToast: <UndoToastView label={label} onUndo={queue.undo} />,
  };
}
