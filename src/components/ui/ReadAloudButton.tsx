"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { SpeakerHigh, Stop } from "@phosphor-icons/react";

/**
 * Pick a voice that speaks ON THE DEVICE.
 *
 * `speechSynthesis.speak()` with no voice uses the platform default, which on
 * several platforms is network-backed: the text is sent to a speech vendor to
 * be synthesized. The text here is a job posting or a Sage reply, and a Sage
 * reply can quote what a student just disclosed — so a remote voice would be
 * an unconsented disclosure of student data to a third party.
 *
 * `localService: true` is the browser's own flag for "synthesized here". No
 * local English voice means we do not speak and do not render the control:
 * an unusable button costs a slow reader an attempt, and a button that speaks
 * over the network is worse than none at all.
 */
export function pickLocalVoice<T extends { lang: string; localService: boolean }>(
  voices: ReadonlyArray<T>,
): T | null {
  return (
    voices.find((voice) => voice.localService && voice.lang?.toLowerCase().startsWith("en")) ?? null
  );
}

function speechSynthesisOrNull(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  const synth = (window as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  return synth ?? null;
}

/**
 * Subscribe to `voiceschanged`: on Chrome `getVoices()` is empty on the first
 * call and fills in asynchronously, so a one-shot check would hide the button
 * from every first paint.
 */
function subscribeToVoices(onChange: () => void): () => void {
  const synth = speechSynthesisOrNull();
  if (!synth?.addEventListener) return () => {};
  synth.addEventListener("voiceschanged", onChange);
  return () => synth.removeEventListener("voiceschanged", onChange);
}

function localVoiceName(): string | null {
  const synth = speechSynthesisOrNull();
  if (!synth) return null;
  const voice = pickLocalVoice(synth.getVoices() ?? []);
  // A NAME (a string) rather than the voice object: useSyncExternalStore
  // compares snapshots by identity, and getVoices() returns fresh objects on
  // every call, which would re-render forever.
  return voice ? (voice.voiceURI ?? voice.name) : null;
}

/**
 * Server snapshot. Deliberately the SAME pure function as the client snapshot:
 * on a real server render `typeof window === "undefined"`, so it returns null
 * there and the first client render agrees (no hydration mismatch). Keeping one
 * function means the render path under test is the render path that ships,
 * rather than a server stub that can never show the control.
 */
const noLocalVoiceOnServer = localVoiceName;

/**
 * Read-aloud for one block of text, using the browser's own speech synthesis
 * (Match & Connect Task 2.3). No library: `window.speechSynthesis` is in every
 * browser this program's students use, and adding a dependency to read a job
 * posting out loud would not be worth its bundle.
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
  // Feature detection via useSyncExternalStore rather than a mount effect: no
  // setState-in-effect, and `voiceschanged` re-runs the check when the browser
  // fills its voice list in late.
  const voiceKey = useSyncExternalStore(subscribeToVoices, localVoiceName, noLocalVoiceOnServer);
  const [speaking, setSpeaking] = useState(false);

  useEffect(
    () => () => {
      speechSynthesisOrNull()?.cancel();
    },
    [],
  );

  const toggle = useCallback(() => {
    const synth = speechSynthesisOrNull();
    if (!synth) return;

    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }

    // Re-check at speak time, not only at render time: the voice list can
    // change between the two, and speaking through a network voice is exactly
    // what this control must never do.
    const voice = pickLocalVoice(synth.getVoices() ?? []);
    if (!voice) return;

    // Cancel anything another card started, so two jobs never talk at once.
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(utterance);
  }, [speaking, text]);

  if (!voiceKey || !text.trim()) return null;

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
