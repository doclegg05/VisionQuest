/**
 * The flow behind an alert line's Resolved, Snooze and Dismiss on the intervention queue.
 *
 * Resolved and Dismiss are sent at once, then Undo is offered in that alert's own line. There is no timer: the offer
 * lasts until the instructor resolves or dismisses another alert, the queue reloads for any reason, or the panel
 * unmounts. One offer at a time. Undo sends the alert route's `reopen` action.
 *
 * Resolved and Dismiss do not reload the queue, so no row moves under the instructor's finger. The line stays as a
 * done line until the next reload. Snooze does reload, since the alert leaves the queue.
 *
 * A critical alert asks first for all three. Declining leaves any earlier Undo offer as it was.
 *
 * No DOM here, so the whole flow is unit tested; `useQueueUndo` wires it to React and moves focus where `focus` says.
 */

export type UndoableAlertAction = "resolve" | "dismiss";
export type QueueAlertRequest = UndoableAlertAction | "snooze";
export type QueueSendRequest = QueueAlertRequest | "reopen";

/** How long a snooze lasts. The panel sends it as `hours`. */
export const SNOOZE_HOURS = 24;

/** The status line that takes focus when an alert line leaves the screen. The panel renders it. */
export const QUEUE_STATUS_ID = "intervention-queue-status";

/** The parts of a queue alert the flow needs. The title and name are shown in a confirm, never logged. */
export interface QueueUndoTarget {
  id: string;
  severity: string;
  title: string;
  studentName: string;
}

export interface QueueUndoQuestion {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
}

/** The one alert Undo is offered for. */
export interface UndoOffer {
  alertId: string;
  action: UndoableAlertAction;
}

export type QueueUndoState =
  | { kind: "idle" }
  | { kind: "confirming"; alertId: string; action: QueueAlertRequest; previous: UndoOffer | null }
  | { kind: "sending"; alertId: string; action: QueueAlertRequest; previous: UndoOffer | null }
  | { kind: "undoable"; alertId: string; action: UndoableAlertAction }
  | { kind: "undoing"; alertId: string; action: UndoableAlertAction };

export interface QueueUndoMessage {
  id: number;
  /** "alert" is a failure and is read out at once; "status" is a quiet confirmation. */
  tone: "alert" | "status";
  text: string;
}

/** Where focus should go next. A new id means move it again, even to the same element. */
export interface QueueFocusRequest {
  id: number;
  elementId: string;
}

export interface QueueUndoSnapshot {
  state: QueueUndoState;
  message: QueueUndoMessage | null;
  /** Alerts saved as resolved or dismissed that the queue has not reloaded out yet. */
  done: Readonly<Record<string, UndoableAlertAction>>;
  focus: QueueFocusRequest | null;
}

export interface QueueUndoDeps {
  send: (alertId: string, request: QueueSendRequest) => Promise<void>;
  confirm: (question: QueueUndoQuestion) => Promise<boolean>;
  /** Reloads the queue. True when the load worked. */
  refresh: () => Promise<boolean>;
}

export interface QueueUndo {
  act: (alert: QueueUndoTarget, action: QueueAlertRequest) => Promise<void>;
  undo: () => Promise<void>;
  /** The queue reloaded with fresh rows: done lines and the offer clear. */
  reloaded: () => void;
  clearMessage: () => void;
  /** The panel unmounted. Nothing in flight may start anything or reload after this. */
  dispose: () => void;
  /** The panel mounted again. React's dev mode unmounts and remounts once, so dispose must not be final there. */
  connect: () => void;
  current: () => QueueUndoSnapshot;
  subscribe: (listener: () => void) => () => void;
}

export type AlertLineState =
  | { kind: "actions" }
  | { kind: "busy" }
  | { kind: "done"; action: UndoableAlertAction; undoable: boolean; undoing: boolean };

const DONE_LABEL: Record<UndoableAlertAction, string> = {
  resolve: "Marked resolved. It comes back if the problem is still there.",
  dismiss: "Dismissed. It will not come back.",
};

const ACTION_FAILED: Record<QueueAlertRequest, string> = {
  resolve: "Could not mark that alert resolved. It is still in your queue. Try again.",
  dismiss: "Could not dismiss that alert. It is still in your queue. Try again.",
  snooze: "Could not snooze that alert. It is still in your queue. Try again.",
};

const UNDO_FAILED = "Could not undo. Tap Undo to try again.";
export const UNDO_DONE_TEXT = "The alert is back in your queue.";
const SNOOZED_TEXT = `Snoozed for ${SNOOZE_HOURS} hours.`;

/** The confirm for a critical alert. It names the alert and the student, so the right one is acted on. */
export function confirmQuestionFor(alert: QueueUndoTarget, action: QueueAlertRequest): QueueUndoQuestion {
  const what = `"${alert.title}"`;
  const base = { cancelLabel: "Keep it", destructive: false };
  if (action === "resolve") {
    return {
      ...base,
      title: `Mark ${what} resolved for ${alert.studentName}?`,
      message: "It leaves your queue. It comes back if the problem is still there. You can undo it right after.",
      confirmLabel: "Mark resolved",
    };
  }
  if (action === "dismiss") {
    return {
      ...base,
      title: `Dismiss ${what} for ${alert.studentName}?`,
      message: "It leaves your queue. It stays hidden even if the problem continues. You can undo it right after.",
      confirmLabel: "Dismiss",
    };
  }
  return {
    ...base,
    title: `Snooze ${what} for ${alert.studentName}?`,
    message: `It leaves your queue for ${SNOOZE_HOURS} hours.`,
    confirmLabel: "Snooze",
  };
}

export function needsConfirm(alert: Pick<QueueUndoTarget, "severity">): boolean {
  return alert.severity === "critical";
}

export function doneLabel(action: UndoableAlertAction): string {
  return DONE_LABEL[action];
}

/** The element id of an alert line's control, so focus can be moved to it. */
export function alertControlId(alertId: string, control: QueueAlertRequest | "undo"): string {
  return `queue-alert-${alertId}-${control}`;
}

/** How one alert line should look for this snapshot. */
export function alertLineState(snapshot: QueueUndoSnapshot, alertId: string): AlertLineState {
  const { state } = snapshot;
  const done = snapshot.done[alertId];
  if (done) {
    const offeredHere = (state.kind === "undoable" || state.kind === "undoing") && state.alertId === alertId;
    return { kind: "done", action: done, undoable: offeredHere, undoing: offeredHere && state.kind === "undoing" };
  }
  if (state.kind !== "idle" && state.alertId === alertId) return { kind: "busy" };
  return { kind: "actions" };
}

const IDLE: QueueUndoState = { kind: "idle" };

/** The flow's private, changing parts. Only the functions below touch it. */
interface FlowCore {
  deps: QueueUndoDeps;
  snapshot: QueueUndoSnapshot;
  nextId: number;
  disposed: boolean;
  listeners: Set<() => void>;
}

function update(core: FlowCore, next: Partial<QueueUndoSnapshot>): void {
  if (core.disposed) return;
  core.snapshot = { ...core.snapshot, ...next };
  core.listeners.forEach((listener) => listener());
}

function note(core: FlowCore, tone: QueueUndoMessage["tone"], text: string): QueueUndoMessage {
  return { id: core.nextId++, tone, text };
}

function focusOn(core: FlowCore, elementId: string): QueueFocusRequest {
  return { id: core.nextId++, elementId };
}

function offerState(offer: UndoOffer | null): QueueUndoState {
  return offer ? { kind: "undoable", ...offer } : IDLE;
}

function reloaded(core: FlowCore): void {
  const { state } = core.snapshot;
  // An Undo still out keeps its line; its own answer settles it.
  if (state.kind === "undoing") {
    update(core, { done: { [state.alertId]: state.action } });
    return;
  }
  const nextState: QueueUndoState =
    state.kind === "confirming" || state.kind === "sending" ? { ...state, previous: null } : IDLE;
  update(core, { state: nextState, done: {} });
}

/** Reloads the queue. A failed or rejected load clears nothing. */
async function reload(core: FlowCore): Promise<void> {
  let loaded = false;
  try {
    loaded = await core.deps.refresh();
  } catch {
    loaded = false;
  }
  if (loaded && !core.disposed) reloaded(core);
}

/** Asks before acting on a critical alert. On a no, puts back what was there before. */
async function confirmCritical(
  core: FlowCore,
  alert: QueueUndoTarget,
  action: QueueAlertRequest,
  previous: UndoOffer | null,
): Promise<boolean> {
  update(core, { state: { kind: "confirming", alertId: alert.id, action, previous }, message: null });
  const yes = await core.deps.confirm(confirmQuestionFor(alert, action));
  if (core.disposed) return false;
  if (yes) return true;
  const { state } = core.snapshot;
  const restored = state.kind === "confirming" ? state.previous : null;
  update(core, { state: offerState(restored), focus: focusOn(core, alertControlId(alert.id, action)) });
  return false;
}

/** The offer a new action would end, or null when the flow is busy and the tap is ignored. */
function startingOffer(state: QueueUndoState): { previous: UndoOffer | null } | null {
  if (state.kind === "idle") return { previous: null };
  if (state.kind === "undoable") return { previous: { alertId: state.alertId, action: state.action } };
  return null;
}

async function act(core: FlowCore, alert: QueueUndoTarget, action: QueueAlertRequest): Promise<void> {
  if (core.disposed) return;
  // Checked before any await, so a second tap lands on the busy state and is ignored.
  const start = startingOffer(core.snapshot.state);
  if (!start) return;
  if (needsConfirm(alert) && !(await confirmCritical(core, alert, action, start.previous))) return;
  const before = core.snapshot.state;
  const previous = before.kind === "confirming" ? before.previous : start.previous;
  update(core, { state: { kind: "sending", alertId: alert.id, action, previous }, message: null });
  try {
    await core.deps.send(alert.id, action);
  } catch {
    actionFailed(core, alert.id, action);
    return;
  }
  if (core.disposed) return;
  if (action === "snooze") {
    await snoozed(core);
    return;
  }
  update(core, {
    state: { kind: "undoable", alertId: alert.id, action },
    done: { ...core.snapshot.done, [alert.id]: action },
    focus: focusOn(core, alertControlId(alert.id, "undo")),
  });
}

function actionFailed(core: FlowCore, alertId: string, action: QueueAlertRequest): void {
  const { state } = core.snapshot;
  // A second action that failed did not resolve anything, so the earlier offer comes back.
  const previous = state.kind === "sending" ? state.previous : null;
  update(core, {
    state: offerState(previous),
    message: note(core, "alert", ACTION_FAILED[action]),
    focus: focusOn(core, alertControlId(alertId, action)),
  });
}

async function snoozed(core: FlowCore): Promise<void> {
  const { state } = core.snapshot;
  const previous = state.kind === "sending" ? state.previous : null;
  update(core, {
    state: offerState(previous),
    message: note(core, "status", SNOOZED_TEXT),
    focus: focusOn(core, QUEUE_STATUS_ID),
  });
  await reload(core);
}

async function undo(core: FlowCore): Promise<void> {
  const { state } = core.snapshot;
  if (core.disposed || state.kind !== "undoable") return;
  update(core, { state: { ...state, kind: "undoing" }, message: null });
  try {
    await core.deps.send(state.alertId, "reopen");
  } catch {
    update(core, {
      state,
      done: { ...core.snapshot.done, [state.alertId]: state.action },
      message: note(core, "alert", UNDO_FAILED),
      focus: focusOn(core, alertControlId(state.alertId, "undo")),
    });
    return;
  }
  update(core, {
    state: IDLE,
    done: withoutKey(core.snapshot.done, state.alertId),
    message: note(core, "status", UNDO_DONE_TEXT),
    focus: focusOn(core, alertControlId(state.alertId, "resolve")),
  });
}

export function createQueueUndo(deps: QueueUndoDeps): QueueUndo {
  const core: FlowCore = {
    deps,
    snapshot: { state: IDLE, message: null, done: {}, focus: null },
    nextId: 1,
    disposed: false,
    listeners: new Set(),
  };
  return {
    act: (alert, action) => act(core, alert, action),
    undo: () => undo(core),
    reloaded: () => reloaded(core),
    clearMessage: () => update(core, { message: null }),
    dispose: () => {
      core.disposed = true;
    },
    connect: () => {
      core.disposed = false;
    },
    current: () => core.snapshot,
    subscribe(listener) {
      core.listeners.add(listener);
      return () => {
        core.listeners.delete(listener);
      };
    },
  };
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key));
}
