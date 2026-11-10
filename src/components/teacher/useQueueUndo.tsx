"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { UndoToastView } from "@/components/ui/useUndo";
import {
  alertLineState,
  createQueueUndo,
  toastSnapshot,
  type AlertLineState,
  type QueueUndoMessage,
  type QueueUndoQuestion,
  type QueueUndoTarget,
  type UndoableAlertAction,
} from "./queue-undo";

/** How long "The alert is back in your queue." stays. It needs no action, so it limits nothing. */
const RESTORED_NOTICE_MS = 4000;

interface QueueUndoOptions {
  /** Must be stable across renders. */
  confirm: (question: QueueUndoQuestion) => Promise<boolean>;
  /** Must be stable across renders. Reloads the queue once the undo window closes. */
  refresh: () => Promise<unknown>;
}

export interface QueueUndoControls {
  act: (alert: QueueUndoTarget, action: UndoableAlertAction) => Promise<void>;
  lineState: (alertId: string) => AlertLineState;
  /** The latest failure, shown by the caller in a role="alert" message. */
  failure: QueueUndoMessage | null;
  /** The shared undo notice, the same one the vision board uses. */
  undoToast: React.ReactNode;
}

async function sendAlertRequest(alertId: string, action: string): Promise<void> {
  await api.patch(`/api/teacher/alerts/${encodeURIComponent(alertId)}`, { action });
}

function startTimer(run: () => void, ms: number): () => void {
  const timer = window.setTimeout(run, ms);
  return () => window.clearTimeout(timer);
}

/** Resolve and Dismiss with an 8 second Undo for the intervention queue. The flow itself is in queue-undo.ts. */
export function useQueueUndo({ confirm, refresh }: QueueUndoOptions): QueueUndoControls {
  // Both callbacks are stable (useConfirm's confirm and the panel's fetchQueue are useCallback), so the flow made
  // on first render can keep them. A new flow per render would drop an open undo window.
  const [flow] = useState(() => createQueueUndo({ send: sendAlertRequest, confirm, refresh, startTimer }));
  const snapshot = useSyncExternalStore(flow.subscribe, flow.current, flow.current);
  const toast = toastSnapshot(snapshot);
  const undoRef = useRef<HTMLButtonElement>(null);

  // Leaving the page ends the window. The action was already saved, so nothing is lost.
  useEffect(() => () => flow.dispose(), [flow]);

  useEffect(() => {
    if (snapshot.message?.tone !== "status") return;
    const timer = window.setTimeout(flow.clearMessage, RESTORED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [flow, snapshot.message]);

  // The pressed button was replaced by the done line, so put focus on Undo for keyboard and VoiceOver users.
  const pendingNoticeId = toast?.kind === "pending" ? toast.id : null;
  useEffect(() => {
    if (pendingNoticeId === null) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) undoRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingNoticeId]);

  const undo = useCallback(async () => {
    const { state } = flow.current();
    await flow.undo();
    if (state.kind !== "undoable" || flow.current().message?.tone !== "status") return;
    // Undo worked, so the alert's buttons are back. Return focus to the one that was pressed.
    requestAnimationFrame(() => document.getElementById(`queue-alert-${state.alertId}-${state.action}`)?.focus());
  }, [flow]);

  const lineState = useCallback((alertId: string) => alertLineState(snapshot, alertId), [snapshot]);

  return {
    act: flow.act,
    lineState,
    failure: snapshot.message?.tone === "alert" ? snapshot.message : null,
    undoToast: (
      <UndoToastView snapshot={toast} onUndo={() => void undo()} onDismiss={flow.finish} undoRef={undoRef} />
    ),
  };
}
