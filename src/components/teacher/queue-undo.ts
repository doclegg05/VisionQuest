/**
 * The flow behind an alert line's Resolved, Snooze and Dismiss on the intervention queue.
 *
 * Resolved and Dismiss are sent at once, then Undo is offered in that alert's own line. There is no timer: the offer
 * lasts until the instructor resolves or dismisses another alert, a reload that began after it was saved lands, the
 * class changes, or the panel unmounts. One offer at a time. Undo sends the alert route's `reopen` action.
 *
 * Resolved and Dismiss do not reload the queue, so no row moves under the instructor's finger. The line stays as a
 * done line until a reload clears it. Snooze does reload, since the alert leaves the queue, and its line shows as
 * done until that reload lands.
 *
 * Reloads are slow on poor Wi-Fi, so one can begin before an action and land after it, still listing the alert as
 * open. Each saved action is therefore stamped with a sequence number, each load takes a token from `beginReload`
 * before its request leaves, and `reloaded(token)` clears only what was saved at or before that token. The rule never
 * looks at which alerts the load listed.
 *
 * Undo sends back the status and timestamp its save wrote (`UndoExpectation`), so the route reopens the alert only if
 * nobody has changed it since. If somebody has, the route answers 409, `send` throws `AlertChangedError`, and the flow
 * says so and reloads the queue. Resolved, Dismiss and Snooze get the same answer when the alert is no longer open.
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

/** What a Resolved or Dismiss save wrote. Undo sends it, and the route reopens only an alert that still holds it. */
export interface UndoExpectation {
  status: "resolved" | "dismissed";
  at: string;
}

/** Thrown by `send` when the route answers 409: another instructor changed the alert since this queue loaded. */
export class AlertChangedError extends Error {
  constructor() {
    super("The alert changed since the queue loaded.");
    this.name = "AlertChangedError";
  }
}

export const ALERT_CHANGED_TEXT = "Someone else changed this alert. The list now shows the latest.";

/** The expected state in the route's answer to a Resolved or Dismiss, or null if it holds none. */
export function undoExpectationFrom(action: QueueAlertRequest, body: unknown): UndoExpectation | null {
  if (action === "snooze" || typeof body !== "object" || body === null) return null;
  const answer = body as Record<string, unknown>;
  const status = action === "resolve" ? "resolved" : "dismissed";
  const at = action === "resolve" ? answer.resolvedAt : answer.dismissedAt;
  if (answer.status !== status || typeof at !== "string") return null;
  return { status, at };
}

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

/** The one alert Undo is offered for. `seq` is the stamp its save got, the same one as its done line. */
export interface UndoOffer {
  alertId: string;
  action: UndoableAlertAction;
  seq: number;
  expected: UndoExpectation;
}

export type QueueUndoState =
  | { kind: "idle" }
  | { kind: "confirming"; alertId: string; action: QueueAlertRequest; previous: UndoOffer | null }
  | { kind: "sending"; alertId: string; action: QueueAlertRequest; previous: UndoOffer | null }
  | ({ kind: "undoable" } & UndoOffer)
  /** `rowGone`: a reload that began after the save landed while this Undo was out, so the rows no longer list it. */
  | ({ kind: "undoing"; rowGone: boolean } & UndoOffer);

/** A saved action whose line shows as done. `seq` orders it against reloads: see `beginReload`. */
export interface DoneEntry {
  action: QueueAlertRequest;
  seq: number;
}

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
  /** Alerts saved as resolved, dismissed or snoozed that no reload has cleared yet, by alert id. */
  done: Readonly<Record<string, DoneEntry>>;
  focus: QueueFocusRequest | null;
}

/** The flow's side of a queue load. Every load of the queue uses both, through `runQueueLoad`. */
export interface QueueReloadHooks {
  /** Call before the load's request leaves. Returns the token to hand back to `reloaded`. */
  beginReload: () => number;
  /**
   * The load that took `token` has put its rows on screen. Clears the done lines and the offer saved at or before
   * the token; anything saved while the load was out stays. With no token everything clears, as a class change needs.
   */
  reloaded: (token?: number) => void;
}

export interface QueueUndoDeps {
  /**
   * Sends one request. For Resolved and Dismiss it returns what the save wrote; Undo passes that back as `expected`.
   * Throws `AlertChangedError` on a 409, anything else on another failure.
   */
  send: (alertId: string, request: QueueSendRequest, expected?: UndoExpectation) => Promise<UndoExpectation | null>;
  confirm: (question: QueueUndoQuestion) => Promise<boolean>;
  /** Reloads the queue. The load reports back through `reload`, so nothing here reads what it returns. */
  refresh: (reload: QueueReloadHooks) => Promise<unknown>;
}

export interface QueueUndo extends QueueReloadHooks {
  act: (alert: QueueUndoTarget, action: QueueAlertRequest) => Promise<void>;
  undo: () => Promise<void>;
  /**
   * The Refresh list button: reloads the queue. The button shows only while a done line is held, so when the load
   * clears the last one the button leaves the screen, and focus goes to the status line instead of the page.
   */
  refreshList: () => Promise<void>;
  /** True when a tap on Resolved, Snooze or Dismiss would be taken. False while a request or a confirm is out. */
  canAct: () => boolean;
  clearMessage: () => void;
  /** The panel unmounted. Nothing in flight may start anything, change anything or reload after this. */
  dispose: () => void;
  /**
   * The panel mounted again. React's dev mode unmounts and remounts once, so dispose must not be final there. A
   * request that was out at dispose never reports back, so its state goes back to idle here. Done lines stay.
   */
  connect: () => void;
  current: () => QueueUndoSnapshot;
  subscribe: (listener: () => void) => () => void;
}

export type AlertLineState =
  | { kind: "actions" }
  /** A request or a confirm is out, for this alert or another. The pills show as unavailable. */
  | { kind: "busy" }
  | { kind: "done"; action: UndoableAlertAction; undoable: boolean; undoing: boolean }
  /** A snooze has no Undo. */
  | { kind: "done"; action: "snooze"; undoable: false; undoing: false };

const DONE_LABEL: Record<QueueAlertRequest, string> = {
  resolve: "Marked resolved. It comes back if the problem is still there.",
  dismiss: "Dismissed. It will not come back.",
  snooze: `Snoozed for ${SNOOZE_HOURS} hours.`,
};

const ACTION_FAILED: Record<QueueAlertRequest, string> = {
  resolve: "Could not mark that alert resolved. It is still in your queue. Try again.",
  dismiss: "Could not dismiss that alert. It is still in your queue. Try again.",
  snooze: "Could not snooze that alert. It is still in your queue. Try again.",
};

const UNDO_FAILED = "Could not undo. Try Undo again.";
/** Undo failed and its line left with a reload, so there is no Undo button to point at. */
const UNDO_FAILED_ROW_GONE: Record<UndoableAlertAction, string> = {
  resolve: "Could not undo. The alert is still resolved. Refresh the list.",
  dismiss: "Could not undo. The alert is still dismissed. Refresh the list.",
};
export const UNDO_DONE_TEXT = "The alert is back in your queue.";
const UNDO_UNTIL = "You can undo it until you resolve or dismiss another alert.";

/** The confirm for a critical alert. It names the alert and the student, so the right one is acted on. */
export function confirmQuestionFor(alert: QueueUndoTarget, action: QueueAlertRequest): QueueUndoQuestion {
  const what = `"${alert.title}"`;
  const base = { cancelLabel: "Keep it", destructive: false };
  if (action === "resolve") {
    return {
      ...base,
      title: `Mark ${what} resolved for ${alert.studentName}?`,
      message: `It leaves your queue. It comes back if the problem is still there. ${UNDO_UNTIL}`,
      confirmLabel: "Mark resolved",
    };
  }
  if (action === "dismiss") {
    return {
      ...base,
      title: `Dismiss ${what} for ${alert.studentName}?`,
      message: `It leaves your queue. It stays hidden even if the problem continues. ${UNDO_UNTIL}`,
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

export function doneLabel(action: QueueAlertRequest): string {
  return DONE_LABEL[action];
}

/** The element id of an alert line's control, so focus can be moved to it. */
export function alertControlId(alertId: string, control: QueueAlertRequest | "undo"): string {
  return `queue-alert-${alertId}-${control}`;
}

/** A request or a confirm is out. Until it ends, a tap on any alert's pills is ignored. */
function isBusy(state: QueueUndoState): boolean {
  return state.kind === "confirming" || state.kind === "sending" || state.kind === "undoing";
}

/**
 * How one alert line should look for this snapshot. A line that is not done shows busy while any request is out, so
 * no pill looks live while a tap on it would be ignored.
 */
export function alertLineState(snapshot: QueueUndoSnapshot, alertId: string): AlertLineState {
  const { state } = snapshot;
  const done = snapshot.done[alertId];
  if (!done) return isBusy(state) ? { kind: "busy" } : { kind: "actions" };
  if (done.action === "snooze") return { kind: "done", action: "snooze", undoable: false, undoing: false };
  const offeredHere = (state.kind === "undoable" || state.kind === "undoing") && state.alertId === alertId;
  return { kind: "done", action: done.action, undoable: offeredHere, undoing: offeredHere && state.kind === "undoing" };
}

const IDLE: QueueUndoState = { kind: "idle" };

/** The flow's private, changing parts. Only the functions below touch it. */
interface FlowCore {
  deps: QueueUndoDeps;
  snapshot: QueueUndoSnapshot;
  nextId: number;
  /** The stamp of the newest saved action. A load's token is this value at the time the load began. */
  seq: number;
  disposed: boolean;
  /** Goes up at every dispose, so a request that was out then can tell, even after a remount. */
  mounts: number;
  listeners: Set<() => void>;
  reload: QueueReloadHooks;
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

/**
 * A check for whether the panel is still the one that was mounted when this was called. A remount does not bring an
 * old request back: its answer is dropped for good.
 */
function watch(core: FlowCore): () => boolean {
  const mounts = core.mounts;
  return () => core.mounts === mounts;
}

/** The state after a load that could see everything saved at or before `token`. */
function stateAfterReload(state: QueueUndoState, token: number): QueueUndoState {
  switch (state.kind) {
    case "idle":
      return state;
    case "undoable":
      return state.seq <= token ? IDLE : state;
    case "undoing":
      // An Undo still out keeps its line; its own answer settles it.
      return state.seq <= token && !state.rowGone ? { ...state, rowGone: true } : state;
    case "confirming":
    case "sending":
      return state.previous !== null && state.previous.seq <= token ? { ...state, previous: null } : state;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function reloaded(core: FlowCore, token: number): void {
  const { state, done } = core.snapshot;
  const undoOut = state.kind === "undoing" ? state.alertId : null;
  const kept = Object.entries(done).filter(([alertId, entry]) => entry.seq > token || alertId === undoOut);
  const nextState = stateAfterReload(state, token);
  // A load with nothing to clear must not redraw the queue.
  if (nextState === state && kept.length === Object.keys(done).length) return;
  update(core, { state: nextState, done: Object.fromEntries(kept) });
}

/** Asks the panel to reload the queue. The load reports back through `beginReload` and `reloaded`. */
async function reload(core: FlowCore): Promise<void> {
  try {
    await core.deps.refresh(core.reload);
  } catch {
    // The loader shows its own failure and does not reject. If it ever does, a reload that did not happen clears
    // nothing here, which is the safe side: every done line and the Undo offer stay.
  }
}

/** Asks before acting on a critical alert. On a no, puts back what was there before. */
async function confirmCritical(
  core: FlowCore,
  mounted: () => boolean,
  alert: QueueUndoTarget,
  action: QueueAlertRequest,
  previous: UndoOffer | null,
): Promise<boolean> {
  update(core, { state: { kind: "confirming", alertId: alert.id, action, previous }, message: null });
  const yes = await core.deps.confirm(confirmQuestionFor(alert, action));
  if (!mounted()) return false;
  if (yes) return true;
  const { state } = core.snapshot;
  const restored = state.kind === "confirming" ? state.previous : null;
  update(core, { state: offerState(restored), focus: focusOn(core, alertControlId(alert.id, action)) });
  return false;
}

/** The offer a new action would end, or null when the flow is busy or unmounted and the tap is ignored. */
function startingOffer(core: FlowCore): { previous: UndoOffer | null } | null {
  const { state } = core.snapshot;
  if (core.disposed) return null;
  if (state.kind === "idle") return { previous: null };
  if (state.kind === "undoable") {
    return { previous: { alertId: state.alertId, action: state.action, seq: state.seq, expected: state.expected } };
  }
  return null;
}

async function act(core: FlowCore, alert: QueueUndoTarget, action: QueueAlertRequest): Promise<void> {
  // Checked before any await, so a second tap lands on the busy state and is ignored.
  const start = startingOffer(core);
  if (!start) return;
  const mounted = watch(core);
  if (needsConfirm(alert) && !(await confirmCritical(core, mounted, alert, action, start.previous))) return;
  const before = core.snapshot.state;
  const previous = before.kind === "confirming" ? before.previous : start.previous;
  update(core, { state: { kind: "sending", alertId: alert.id, action, previous }, message: null });
  let expected: UndoExpectation | null;
  try {
    expected = await core.deps.send(alert.id, action);
  } catch (error: unknown) {
    if (!mounted()) return;
    if (error instanceof AlertChangedError) await changedElsewhere(core);
    else actionFailed(core, alert.id, action);
    return;
  }
  if (!mounted()) return;
  await saved(core, alert.id, action, expected);
}

/** The route refused because another instructor changed the alert. Only a reload shows what it is now. */
async function changedElsewhere(core: FlowCore): Promise<void> {
  update(core, {
    state: IDLE,
    message: note(core, "alert", ALERT_CHANGED_TEXT),
    focus: focusOn(core, QUEUE_STATUS_ID),
  });
  await reload(core);
}

/** The send worked. The line turns into a done line, stamped so a reload that began earlier cannot clear it. */
async function saved(
  core: FlowCore,
  alertId: string,
  action: QueueAlertRequest,
  expected: UndoExpectation | null,
): Promise<void> {
  core.seq += 1;
  const seq = core.seq;
  const done = { ...core.snapshot.done, [alertId]: { action, seq } };
  if (action === "snooze") {
    await snoozed(core, done);
    return;
  }
  if (!expected) {
    // Saved, but the answer holds nothing an Undo could check against, so no Undo is offered.
    update(core, { state: IDLE, done, focus: focusOn(core, QUEUE_STATUS_ID) });
    return;
  }
  update(core, {
    state: { kind: "undoable", alertId, action, seq, expected },
    done,
    focus: focusOn(core, alertControlId(alertId, "undo")),
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

/** A snooze has no Undo. Its line shows as done until the reload it starts lands, or a later one if that load fails. */
async function snoozed(core: FlowCore, done: QueueUndoSnapshot["done"]): Promise<void> {
  const { state } = core.snapshot;
  const previous = state.kind === "sending" ? state.previous : null;
  update(core, {
    state: offerState(previous),
    done,
    message: note(core, "status", DONE_LABEL.snooze),
    focus: focusOn(core, QUEUE_STATUS_ID),
  });
  await reload(core);
}

async function undo(core: FlowCore): Promise<void> {
  const offer = core.snapshot.state;
  if (core.disposed || offer.kind !== "undoable") return;
  const mounted = watch(core);
  update(core, { state: { ...offer, kind: "undoing", rowGone: false }, message: null });
  let reopened = true;
  try {
    await core.deps.send(offer.alertId, "reopen", offer.expected);
  } catch (error: unknown) {
    if (error instanceof AlertChangedError) {
      if (mounted()) await changedElsewhere(core);
      return;
    }
    reopened = false;
  }
  if (!mounted()) return;
  const now = core.snapshot.state;
  const rowGone = now.kind === "undoing" && now.rowGone;
  if (reopened) await undone(core, offer, rowGone);
  else undoFailed(core, offer, rowGone);
}

/** The alert is open again. If a reload took its row away meanwhile, only another reload can show it. */
async function undone(core: FlowCore, offer: UndoOffer, rowGone: boolean): Promise<void> {
  update(core, {
    state: IDLE,
    done: withoutKey(core.snapshot.done, offer.alertId),
    message: note(core, "status", UNDO_DONE_TEXT),
    focus: focusOn(core, rowGone ? QUEUE_STATUS_ID : alertControlId(offer.alertId, "resolve")),
  });
  if (rowGone) await reload(core);
}

function undoFailed(core: FlowCore, offer: UndoOffer, rowGone: boolean): void {
  if (!rowGone) {
    update(core, {
      state: offerState(offer),
      message: note(core, "alert", UNDO_FAILED),
      focus: focusOn(core, alertControlId(offer.alertId, "undo")),
    });
    return;
  }
  // No line is left to hold an Undo button, so the offer ends. Its done entry stays until the next reload, which
  // keeps Refresh list on screen for the instructor the message sends there.
  update(core, {
    state: IDLE,
    message: note(core, "alert", UNDO_FAILED_ROW_GONE[offer.action]),
    focus: focusOn(core, QUEUE_STATUS_ID),
  });
}

async function refreshList(core: FlowCore): Promise<void> {
  if (core.disposed) return;
  const mounted = watch(core);
  await reload(core);
  if (!mounted() || Object.keys(core.snapshot.done).length > 0) return;
  update(core, { focus: focusOn(core, QUEUE_STATUS_ID) });
}

export function createQueueUndo(deps: QueueUndoDeps): QueueUndo {
  const core: FlowCore = {
    deps,
    snapshot: { state: IDLE, message: null, done: {}, focus: null },
    nextId: 1,
    seq: 0,
    disposed: false,
    mounts: 0,
    listeners: new Set(),
    reload: {
      beginReload: () => core.seq,
      reloaded: (token) => reloaded(core, token ?? core.seq),
    },
  };
  return {
    ...core.reload,
    act: (alert, action) => act(core, alert, action),
    undo: () => undo(core),
    refreshList: () => refreshList(core),
    canAct: () => startingOffer(core) !== null,
    clearMessage: () => update(core, { message: null }),
    dispose: () => {
      core.disposed = true;
      core.mounts += 1;
    },
    connect: () => {
      core.disposed = false;
      // Whatever was out at dispose never reports back (see `watch`), so nothing else would end these states.
      if (isBusy(core.snapshot.state)) update(core, { state: IDLE });
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
