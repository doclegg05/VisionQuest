"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { SpeakerHigh, Stop } from "@phosphor-icons/react";

/** Support never changes for the life of the page, so there is nothing to subscribe to. */
function subscribeNothing(): () => void {
  return () => {};
}

function isSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function serverUnsupported(): boolean {
  return false;
}

/**
 * Read-aloud for one block of text, using the browser's own speech synthesis
 * (Match & Connect Task 2.3). No library: `window.speechSynthesis` is in every
 * browser this program's students use, and adding a dependency to read a job
 * posting out loud would not be worth its bundle.
 *
 * The button renders only when the API is actually there. A disabled control
 * the student cannot use is worse than no control — this audience reads the
 * screen slowly, and a dead button costs them a real attempt.
 */
export function ReadAloudButton({
  text,
  label = "Read out loud",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  // Feature detection through useSyncExternalStore rather than a mount effect:
  // the server snapshot is `false`, so the server render and the first client
  // render agree (no hydration mismatch) without a setState-in-effect.
  const supported = useSyncExternalStore(subscribeNothing, isSupported, serverUnsupported);
  const [speaking, setSpeaking] = useState(false);

  useEffect(
    () => () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    },
    [],
  );

  if (!supported || !text.trim()) return null;

  function toggle() {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    // Cancel anything another card started, so two jobs never talk at once.
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(utterance);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={speaking}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)] ${className}`}
    >
      {speaking ? <Stop size={16} weight="fill" /> : <SpeakerHigh size={16} />}
      {speaking ? "Stop" : label}
    </button>
  );
}
