/**
 * The Stop gate for one chat send (E2b): the abort controller, whether the
 * student stopped, and whether Stop is armed yet (stopArmed in
 * wait-and-stop.ts). The gate itself is plain code so its rules are testable
 * without a DOM; useSendAbort wraps it for ChatWindow.
 */

import { useEffect, useMemo, useState } from "react";

import { STOP_ARM_DELAY_MS, stopArmed } from "./wait-and-stop";

export interface SendAbort {
  /** A new send: a new controller, not stopped, not armed. */
  begin(): AbortController;
  /** The stream's first event arrived (ids, and the crisis flag with them). */
  noteIds(): void;
  /** Ends the reply, only once armed. Before that it does nothing. */
  stop(): void;
  wasStopped(): boolean;
  armed(): boolean;
  /** The send finished. An older send ending leaves a newer one alone. */
  end(controller: AbortController): void;
  /** Clears the arming timer. It never aborts the reply. */
  dispose(): void;
}

interface SendState {
  controller: AbortController | null;
  stopped: boolean;
  idsArrived: boolean;
  sentAt: number;
}

const IDLE: SendState = { controller: null, stopped: false, idsArrived: false, sentAt: 0 };

export function createSendAbort(onArmedChange: (armed: boolean) => void): SendAbort {
  let state = IDLE;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const isArmed = (now = Date.now()) =>
    state.controller !== null && stopArmed({ idsArrived: state.idsArrived, sentAt: state.sentAt, now });
  // The timer fired, so at least the delay has passed whatever the clock reads.
  const onDelay = () => onArmedChange(isArmed(Math.max(Date.now(), state.sentAt + STOP_ARM_DELAY_MS)));

  return {
    begin() {
      clearTimer();
      const controller = new AbortController();
      state = { controller, stopped: false, idsArrived: false, sentAt: Date.now() };
      onArmedChange(false);
      timer = setTimeout(onDelay, STOP_ARM_DELAY_MS);
      return controller;
    },
    noteIds() {
      state = { ...state, idsArrived: true };
      onArmedChange(isArmed());
    },
    stop() {
      if (!isArmed()) return;
      state = { ...state, stopped: true };
      state.controller?.abort();
    },
    wasStopped: () => state.stopped,
    armed: () => isArmed(),
    end(controller) {
      if (state.controller !== controller) return;
      clearTimer();
      state = { ...IDLE, stopped: state.stopped };
      onArmedChange(false);
    },
    dispose: clearTimer,
  };
}

/** The gate for ChatWindow, with `isArmed` as state so the Stop button redraws. */
export function useSendAbort(): SendAbort & { isArmed: boolean } {
  const [isArmed, setIsArmed] = useState(false);
  const [gate] = useState(() => createSendAbort(setIsArmed));
  // Leaving the page clears the timer but deliberately does not abort: the
  // server then finishes and saves the full reply.
  useEffect(() => gate.dispose, [gate]);
  return useMemo(() => ({ ...gate, isArmed }), [gate, isArmed]);
}
