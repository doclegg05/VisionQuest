"use client";

import { useEffect, useRef } from "react";

/**
 * The Regions card says a region changed; the other cards on the admin page
 * reload their region lists and keep everything else they hold. A remount
 * would have erased what was typed, including a new student's password.
 */
export const REGIONS_CHANGED_EVENT = "vq:regions-changed";

export function announceRegionsChanged(target: EventTarget = window): void {
  target.dispatchEvent(new Event(REGIONS_CHANGED_EVENT));
}

/** Calls `handler` on each change until the returned function is called. */
export function onRegionsChanged(target: EventTarget, handler: () => void): () => void {
  target.addEventListener(REGIONS_CHANGED_EVENT, handler);
  return () => target.removeEventListener(REGIONS_CHANGED_EVENT, handler);
}

/** Runs the latest `handler` each time a region changes. */
export function useRegionsChanged(handler: () => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => onRegionsChanged(window, () => latest.current()), []);
}
