"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import {
  alertLineState,
  createQueueUndo,
  QUEUE_STATUS_ID,
  SNOOZE_HOURS,
  type AlertLineState,
  type QueueAlertRequest,
  type QueueSendRequest,
  type QueueUndoMessage,
  type QueueUndoQuestion,
  type QueueUndoTarget,
} from "./queue-undo";

interface QueueUndoOptions {
  /** Must be stable across renders. */
  confirm: (question: QueueUndoQuestion) => Promise<boolean>;
  /** Must be stable across renders. Reloads the queue and returns null when the load failed. */
  refresh: () => Promise<unknown>;
}

export interface QueueUndoControls {
  act: (alert: QueueUndoTarget, action: QueueAlertRequest) => Promise<void>;
  undo: () => void;
  /** Call whenever the queue gets fresh rows, for any reason. Done lines and the Undo offer clear. */
  reloaded: () => void;
  lineState: (alertId: string) => AlertLineState;
  isDone: (alertId: string) => boolean;
  /** The latest failure, shown by the caller in a role="alert" message. */
  failure: QueueUndoMessage | null;
  /** The latest quiet confirmation, shown by the caller in its role="status" line. */
  status: QueueUndoMessage | null;
}

async function sendAlertRequest(alertId: string, action: QueueSendRequest): Promise<void> {
  const body = action === "snooze" ? { action, hours: SNOOZE_HOURS } : { action };
  await api.patch(`/api/teacher/alerts/${encodeURIComponent(alertId)}`, body);
}

/** Moves focus where the flow asked. If that element is gone, the status line takes it, never the page body. */
function moveFocus(elementId: string): void {
  const target = document.getElementById(elementId) ?? document.getElementById(QUEUE_STATUS_ID);
  target?.focus();
}

/** Resolved, Snooze and Dismiss for the intervention queue, with Undo in the alert's line. The flow is queue-undo.ts. */
export function useQueueUndo({ confirm, refresh }: QueueUndoOptions): QueueUndoControls {
  // Both callbacks are stable (useConfirm's confirm and the panel's fetchQueue are useCallback), so the flow made
  // on first render can keep them. A new flow per render would drop the Undo offer.
  const [flow] = useState(() =>
    createQueueUndo({
      send: sendAlertRequest,
      confirm,
      refresh: async () => (await refresh()) !== null,
    }),
  );
  const snapshot = useSyncExternalStore(flow.subscribe, flow.current, flow.current);

  // Unmounting ends the offer. Anything still in flight then changes nothing and reloads nothing.
  useEffect(() => {
    flow.connect();
    return () => flow.dispose();
  }, [flow]);

  const focusId = snapshot.focus?.id ?? null;
  const focusElementId = snapshot.focus?.elementId ?? null;
  useEffect(() => {
    if (focusId === null || focusElementId === null) return;
    // Wait one frame, so the line has rendered the control that should take focus.
    const frame = requestAnimationFrame(() => moveFocus(focusElementId));
    return () => cancelAnimationFrame(frame);
  }, [focusId, focusElementId]);

  const lineState = useCallback((alertId: string) => alertLineState(snapshot, alertId), [snapshot]);
  const isDone = useCallback((alertId: string) => alertId in snapshot.done, [snapshot]);
  const undo = useCallback(() => void flow.undo(), [flow]);

  return {
    act: flow.act,
    undo,
    reloaded: flow.reloaded,
    lineState,
    isDone,
    failure: snapshot.message?.tone === "alert" ? snapshot.message : null,
    status: snapshot.message?.tone === "status" ? snapshot.message : null,
  };
}
