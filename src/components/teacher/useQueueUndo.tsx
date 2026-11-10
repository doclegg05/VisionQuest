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
  type QueueReloadHooks,
  type QueueSendRequest,
  type QueueUndoMessage,
  type QueueUndoQuestion,
  type QueueUndoTarget,
} from "./queue-undo";

interface QueueUndoOptions<Rows> {
  /** Must be stable across renders. */
  confirm: (question: QueueUndoQuestion) => Promise<boolean>;
  /**
   * Must be stable across renders. Loads the queue through `runQueueLoad`, handing it `reload`, so the load tells
   * the flow when it began and when its rows are on screen.
   */
  load: (reload: QueueReloadHooks) => Promise<Rows>;
}

export interface QueueUndoControls<Rows> {
  /** Starts Resolved, Snooze or Dismiss. False when a request is already out and the tap was ignored. */
  act: (alert: QueueUndoTarget, action: QueueAlertRequest) => boolean;
  undo: () => void;
  /** Loads the queue with the caller's `load`. Every reload of the queue goes through this. */
  refresh: () => Promise<Rows>;
  /** The Refresh list button. Reloads, then moves focus to the status line if the button left the screen. */
  refreshList: () => void;
  /** The class changed: every done line and the Undo offer end. */
  clear: () => void;
  lineState: (alertId: string) => AlertLineState;
  isDone: (alertId: string) => boolean;
  /** True while any alert is held as done, so the caller can offer a reload to clear it. */
  hasDone: boolean;
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
export function useQueueUndo<Rows>({ confirm, load }: QueueUndoOptions<Rows>): QueueUndoControls<Rows> {
  // Both callbacks are stable (useConfirm's confirm and the panel's fetchQueue are useCallback), so the flow made
  // on first render can keep them. A new flow per render would drop the Undo offer.
  const [flow] = useState(() => createQueueUndo({ send: sendAlertRequest, confirm, refresh: load }));
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
  const act = useCallback(
    (alert: QueueUndoTarget, action: QueueAlertRequest) => {
      if (!flow.canAct()) return false;
      void flow.act(alert, action);
      return true;
    },
    [flow],
  );
  const refresh = useCallback(() => load(flow), [load, flow]);
  const refreshList = useCallback(() => void flow.refreshList(), [flow]);
  const clear = useCallback(() => flow.reloaded(), [flow]);

  return {
    act,
    undo,
    refresh,
    refreshList,
    clear,
    lineState,
    isDone,
    hasDone: Object.keys(snapshot.done).length > 0,
    failure: snapshot.message?.tone === "alert" ? snapshot.message : null,
    status: snapshot.message?.tone === "status" ? snapshot.message : null,
  };
}
