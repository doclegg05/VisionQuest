/**
 * The undo flow for Resolved and Dismiss on the intervention queue.
 *
 * The action is sent at once, then Undo is offered for QUEUE_UNDO_WINDOW_MS. Undo sends the alert route's
 * `reopen` action. Sending first means a tab closed inside the window keeps what the instructor did: the change is
 * already saved, and only the chance to undo it is lost.
 *
 * While Undo is offered the alert line stays in place, marked done, and the queue is not reloaded, so the next row
 * does not move under the instructor's finger. The reload runs once the last open window closes.
 *
 * No DOM here, so the whole flow is unit tested; `useQueueUndo` wires it to React.
 */
import type { UndoSnapshot } from "@/lib/undo-queue";

export type UndoableAlertAction = "resolve" | "dismiss";
export type QueueUndoRequest = UndoableAlertAction | "reopen";

export const QUEUE_UNDO_WINDOW_MS = 8000;

/** The parts of a queue alert the flow needs. */
export interface QueueUndoTarget {
  id: string;
  severity: string;
}

export interface QueueUndoQuestion {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
}

export type QueueUndoState =
  | { kind: "idle" }
  | { kind: "confirming"; alertId: string; action: UndoableAlertAction }
  | { kind: "sending"; alertId: string; action: UndoableAlertAction }
  | { kind: "undoable"; alertId: string; action: UndoableAlertAction; noticeId: number }
  | { kind: "undoing"; alertId: string; action: UndoableAlertAction; noticeId: number };

export interface QueueUndoMessage {
  id: number;
  /** "alert" is a failure and is read out at once; "status" is a quiet confirmation. */
  tone: "alert" | "status";
  text: string;
}

export interface QueueUndoSnapshot {
  state: QueueUndoState;
  message: QueueUndoMessage | null;
  /** Alerts saved as resolved or dismissed that the queue has not reloaded out yet. */
  done: Readonly<Record<string, UndoableAlertAction>>;
}

export interface QueueUndoDeps {
  send: (alertId: string, request: QueueUndoRequest) => Promise<void>;
  confirm: (question: QueueUndoQuestion) => Promise<boolean>;
  /** Reloads the queue. */
  refresh: () => Promise<unknown>;
  /** Runs `run` after `ms` and returns a function that cancels it. */
  startTimer: (run: () => void, ms: number) => () => void;
}

export interface QueueUndo {
  act: (alert: QueueUndoTarget, action: UndoableAlertAction) => Promise<void>;
  undo: () => Promise<void>;
  /** Ends the undo window now: the timer ran out, or the instructor closed the notice. */
  finish: () => void;
  clearMessage: () => void;
  dispose: () => void;
  current: () => QueueUndoSnapshot;
  subscribe: (listener: () => void) => () => void;
}

export type AlertLineState =
  | { kind: "actions" }
  | { kind: "busy" }
  | { kind: "done"; action: UndoableAlertAction };

const DONE_LABEL: Record<UndoableAlertAction, string> = {
  resolve: "Marked resolved.",
  dismiss: "Dismissed.",
};

const ACTION_FAILED: Record<UndoableAlertAction, string> = {
  resolve: "Could not mark that alert resolved. It is still in your queue. Try again.",
  dismiss: "Could not dismiss that alert. It is still in your queue. Try again.",
};

const UNDO_FAILED: Record<UndoableAlertAction, string> = {
  resolve: "Could not undo. The alert is still marked resolved. Try again from the student's page.",
  dismiss: "Could not undo. The alert is still dismissed. Try again from the student's page.",
};

export const UNDO_DONE_TEXT = "The alert is back in your queue.";

const QUESTIONS: Record<UndoableAlertAction, QueueUndoQuestion> = {
  resolve: {
    title: "Mark this alert as resolved?",
    message: "It will leave your queue. You can undo it for a few seconds after.",
    confirmLabel: "Mark resolved",
    cancelLabel: "Keep it",
    destructive: false,
  },
  dismiss: {
    title: "Dismiss this alert?",
    message: "It will leave your queue and will not come back on its own. You can undo it for a few seconds after.",
    confirmLabel: "Dismiss",
    cancelLabel: "Keep it",
    destructive: false,
  },
};

export function confirmQuestionFor(action: UndoableAlertAction): QueueUndoQuestion {
  return QUESTIONS[action];
}

export function needsConfirm(alert: QueueUndoTarget): boolean {
  return alert.severity === "critical";
}

export function doneLabel(action: UndoableAlertAction): string {
  return DONE_LABEL[action];
}

/** How one alert line should look for this snapshot. */
export function alertLineState(snapshot: QueueUndoSnapshot, alertId: string): AlertLineState {
  const done = snapshot.done[alertId];
  if (done) return { kind: "done", action: done };
  const { state } = snapshot;
  if (state.kind !== "idle" && state.alertId === alertId) return { kind: "busy" };
  return { kind: "actions" };
}

/** What the shared undo notice shows: Undo while the window is open, then a short confirmation. */
export function toastSnapshot(snapshot: QueueUndoSnapshot): UndoSnapshot | null {
  const { state, message } = snapshot;
  if (state.kind === "undoable" || state.kind === "undoing") {
    return { id: state.noticeId, kind: "pending", label: DONE_LABEL[state.action] };
  }
  if (message?.tone === "status") return { id: message.id, kind: "restored", label: message.text };
  return null;
}

const IDLE: QueueUndoState = { kind: "idle" };

/** The flow's private, changing parts. Only the functions below touch it. */
interface FlowCore {
  deps: QueueUndoDeps;
  windowMs: number;
  snapshot: QueueUndoSnapshot;
  cancelTimer: (() => void) | null;
  nextId: number;
  listeners: Set<() => void>;
}

function update(core: FlowCore, next: Partial<QueueUndoSnapshot>): void {
  core.snapshot = { ...core.snapshot, ...next };
  core.listeners.forEach((listener) => listener());
}

function note(core: FlowCore, tone: QueueUndoMessage["tone"], text: string): QueueUndoMessage {
  return { id: core.nextId++, tone, text };
}

function stopTimer(core: FlowCore): void {
  core.cancelTimer?.();
  core.cancelTimer = null;
}

/** Reloads the queue so saved alerts leave it, then forgets only the alerts this reload covered. */
async function settle(core: FlowCore): Promise<void> {
  const covered = Object.keys(core.snapshot.done);
  if (covered.length === 0) return;
  try {
    await core.deps.refresh();
  } finally {
    update(core, { done: withoutKeys(core.snapshot.done, covered) });
  }
}

function finish(core: FlowCore): void {
  if (core.snapshot.state.kind !== "undoable") return;
  stopTimer(core);
  update(core, { state: IDLE });
  void settle(core);
}

/** Asks before acting on a critical alert. Returns false when the instructor says no. */
async function confirmCritical(
  core: FlowCore,
  alert: QueueUndoTarget,
  action: UndoableAlertAction,
): Promise<boolean> {
  update(core, { state: { kind: "confirming", alertId: alert.id, action }, message: null });
  if (await core.deps.confirm(confirmQuestionFor(action))) return true;
  update(core, { state: IDLE });
  void settle(core);
  return false;
}

async function act(core: FlowCore, alert: QueueUndoTarget, action: UndoableAlertAction): Promise<void> {
  const { state } = core.snapshot;
  if (state.kind === "confirming" || state.kind === "sending" || state.kind === "undoing") return;
  // One window at a time. The earlier alert stays marked done, so its row still does not move yet.
  if (state.kind === "undoable") stopTimer(core);
  // Checked before any await, so a second tap lands on the busy state and is ignored.
  if (needsConfirm(alert) && !(await confirmCritical(core, alert, action))) return;
  update(core, { state: { kind: "sending", alertId: alert.id, action }, message: null });
  try {
    await core.deps.send(alert.id, action);
  } catch {
    update(core, { state: IDLE, message: note(core, "alert", ACTION_FAILED[action]) });
    void settle(core);
    return;
  }
  update(core, {
    state: { kind: "undoable", alertId: alert.id, action, noticeId: core.nextId++ },
    done: { ...core.snapshot.done, [alert.id]: action },
  });
  core.cancelTimer = core.deps.startTimer(() => finish(core), core.windowMs);
}

async function undo(core: FlowCore): Promise<void> {
  const { state } = core.snapshot;
  if (state.kind !== "undoable") return;
  stopTimer(core);
  update(core, { state: { ...state, kind: "undoing" } });
  try {
    await core.deps.send(state.alertId, "reopen");
  } catch {
    update(core, { state: IDLE, message: note(core, "alert", UNDO_FAILED[state.action]) });
    void settle(core);
    return;
  }
  update(core, {
    state: IDLE,
    done: withoutKeys(core.snapshot.done, [state.alertId]),
    message: note(core, "status", UNDO_DONE_TEXT),
  });
  void settle(core);
}

export function createQueueUndo(deps: QueueUndoDeps, windowMs: number = QUEUE_UNDO_WINDOW_MS): QueueUndo {
  const core: FlowCore = {
    deps,
    windowMs,
    snapshot: { state: IDLE, message: null, done: {} },
    cancelTimer: null,
    nextId: 1,
    listeners: new Set(),
  };
  return {
    act: (alert, action) => act(core, alert, action),
    undo: () => undo(core),
    finish: () => finish(core),
    clearMessage: () => update(core, { message: null }),
    dispose: () => stopTimer(core),
    current: () => core.snapshot,
    subscribe(listener) {
      core.listeners.add(listener);
      return () => {
        core.listeners.delete(listener);
      };
    },
  };
}

function withoutKeys<T>(record: Readonly<Record<string, T>>, keys: readonly string[]): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}
