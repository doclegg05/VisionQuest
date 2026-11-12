"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

interface ScrollSnapshot {
  restore: () => void;
  release: () => void;
}

function captureScroll(): ScrollSnapshot {
  const main = document.getElementById("main-content");
  const roots = [document.documentElement, document.body, main].filter((node): node is HTMLElement => node !== null);
  const anchors = roots.map((node) => ({ node, value: node.style.overflowAnchor }));
  const viewport = { left: window.scrollX, top: window.scrollY };
  const content = main && { left: main.scrollLeft, top: main.scrollTop };
  // A newly inserted status or roster can otherwise make the browser choose
  // a different anchor, even when the focused button stays mounted.
  for (const { node } of anchors) node.style.overflowAnchor = "none";
  return {
    restore() {
      if (main && content) main.scrollTo({ ...content, behavior: "instant" });
      window.scrollTo({ ...viewport, behavior: "instant" });
    },
    release() { for (const { node, value } of anchors) node.style.overflowAnchor = value; },
  };
}

/** Preserve the action's position through list/detail refreshes; user input cancels it. */
export function useClassActionScroll(busy: boolean, detailReady: boolean): () => void {
  const snapshot = useRef<ScrollSnapshot | null>(null);
  useEffect(() => {
    const cancel = () => { snapshot.current?.release(); snapshot.current = null; };
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of events) window.addEventListener(event, cancel, { passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, cancel);
      cancel();
    };
  }, []);
  // Every commit can change page height, including the detail request that
  // starts after the list request. Restore before paint and after anchoring.
  useLayoutEffect(() => {
    const current = snapshot.current;
    if (!current) return;
    current.restore();
    const frame = requestAnimationFrame(() => {
      if (snapshot.current !== current) return;
      current.restore();
      if (!busy && detailReady) { current.release(); snapshot.current = null; }
    });
    return () => cancelAnimationFrame(frame);
  });
  return () => { snapshot.current?.release(); snapshot.current = captureScroll(); };
}
