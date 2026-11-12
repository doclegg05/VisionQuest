/**
 * The Stop gate for one chat send (E2b): the abort controller, whether the
 * student stopped, and whether Stop is armed yet (stopArmed in
 * wait-and-stop.ts). The gate itself is plain code so its rules are testable
 * without a DOM; useSendAbort wraps it for ChatWindow.
 */

import { useEffect, useState } from "react";

import { FIRST_EVENT_TIMEOUT_MS, STOP_ARM_DELAY_MS, firstEventOverdue, stopArmed } from "./wait-and-stop";

export interface SendAbort {
  /** A new send: a new controller, not stopped, not armed. */
  begin(): AbortController;
  /** The stream's first event arrived (ids, and the crisis flag with them). */
  noteIds(): void;
  /**
   * Ends the reply once armed. A press after the delay but before the ids is
   * kept, and noteIds ends the reply then. A press under the delay (a second
   * tap on Send) does nothing.
   */
  stop(): void;
  wasStopped(): boolean;
  /** The chat ended the send because no first event came in time (E7, E9b 3). */
  timedOut(): boolean;
  armed(): boolean;
  /** The send finished. An older send ending leaves a newer one alone. */
  end(controller: AbortController): void;
  /** Clears the arming timer. It never aborts the reply. */
  dispose(): void;
}

interface SendState {
  controller: AbortController | null;
  stopped: boolean;
  /** Stop was pressed after the delay but before the ids. */
  stopKept: boolean;
  idsArrived: boolean;
  timedOut: boolean;
  sentAt: number;
}

const IDLE: SendState = {
  controller: null,
  stopped: false,
  stopKept: false,
  idsArrived: false,
  timedOut: false,
  sentAt: 0,
};

/** One pending timeout: start replaces it, cancel clears it. */
function oneTimer() {
  let id: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (id) clearTimeout(id);
    id = null;
  };
  return {
    start(run: () => void, ms: number) {
      cancel();
      id = setTimeout(run, ms);
    },
    cancel,
  };
}

/**
 * E7: the state once the first-event timer fires. Overdue ends the send as a
 * timeout, not a Stop, so the chat shows its own sentence with Try again
 * (E9b 3) and the box unlocks. Pure: the caller does the abort.
 */
function afterFirstEventTimer(state: SendState): SendState {
  // The timer fired, so at least the bound has passed whatever the clock reads.
  const now = Math.max(Date.now(), state.sentAt + FIRST_EVENT_TIMEOUT_MS);
  if (!firstEventOverdue({ idsArrived: state.idsArrived, sentAt: state.sentAt, now })) return state;
  return { ...state, stopKept: false, timedOut: true };
}

export function createSendAbort(onArmedChange: (armed: boolean) => void): SendAbort {
  let state = IDLE;
  const armTimer = oneTimer();
  const firstEventTimer = oneTimer();
  const clearTimers = () => [armTimer, firstEventTimer].forEach((timer) => timer.cancel());
  const isArmed = (now = Date.now()) =>
    state.controller !== null && stopArmed({ idsArrived: state.idsArrived, sentAt: state.sentAt, now });
  // The timer fired, so at least the delay has passed whatever the clock reads.
  const onDelay = () => onArmedChange(isArmed(Math.max(Date.now(), state.sentAt + STOP_ARM_DELAY_MS)));
  const delayPassed = () => Date.now() - state.sentAt >= STOP_ARM_DELAY_MS;
  const abortReply = () => {
    state = { ...state, stopped: true, stopKept: false };
    state.controller?.abort();
  };
  const onFirstEventLate = () => {
    state = afterFirstEventTimer(state);
    if (state.timedOut) state.controller?.abort();
  };

  return {
    begin() {
      const controller = new AbortController();
      state = { ...IDLE, controller, sentAt: Date.now() };
      onArmedChange(false);
      armTimer.start(onDelay, STOP_ARM_DELAY_MS);
      firstEventTimer.start(onFirstEventLate, FIRST_EVENT_TIMEOUT_MS);
      return controller;
    },
    noteIds() {
      firstEventTimer.cancel();
      state = { ...state, idsArrived: true };
      if (state.stopKept) abortReply();
      onArmedChange(isArmed());
    },
    stop() {
      if (isArmed()) abortReply();
      else if (state.controller && !state.idsArrived && delayPassed()) state = { ...state, stopKept: true };
    },
    wasStopped: () => state.stopped,
    timedOut: () => state.timedOut,
    armed: () => isArmed(),
    end(controller) {
      if (state.controller !== controller) return;
      clearTimers();
      // Kept for the turn's display after the send; the next begin clears them.
      state = { ...IDLE, stopped: state.stopped, timedOut: state.timedOut };
      onArmedChange(false);
    },
    dispose: clearTimers,
  };
}

/**
 * The gate for ChatWindow, and `isArmed` beside it as state so the Stop
 * button redraws. The gate is made once and never changes, so arming does
 * not give handleSend or the retry a new identity.
 */
export function useSendAbort(): { gate: SendAbort; isArmed: boolean } {
  const [isArmed, setIsArmed] = useState(false);
  const [gate] = useState(() => createSendAbort(setIsArmed));
  // Leaving the page clears the timer but deliberately does not abort: the
  // server then finishes and saves the full reply.
  useEffect(() => gate.dispose, [gate]);
  return { gate, isArmed };
}
