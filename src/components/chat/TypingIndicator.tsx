"use client";

import { motion, useReducedMotion } from "framer-motion";

import { SLOW_REPLY_WORDS, STALLED_REPLY_WORDS, TYPING_SR_WORDS } from "./wait-and-stop";

interface TypingIndicatorProps {
  /** Sage has said nothing for SLOW_REPLY_MS: show the wait words. */
  slow?: boolean;
  /** Sage has said nothing for REPLY_STALL_MS: say that Stop works (E7). */
  stalled?: boolean;
}

/**
 * The dots while Sage has not sent a word. It says one thing at a time:
 * hidden words at first, then, after five seconds, only the visible wait
 * words. It has no live region of its own (E9b 4): it sits inside the chat's
 * polite log, which is not busy while Sage says nothing (logBusy), so the
 * log reads the words out once when they appear.
 */
export default function TypingIndicator({ slow = false, stalled = false }: TypingIndicatorProps) {
  const reduce = useReducedMotion();
  const words = stalled ? STALLED_REPLY_WORDS : slow ? SLOW_REPLY_WORDS : null;

  return (
    <div className="flex gap-3">
      <div
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--chat-sage-mark-bg)] text-xs font-bold text-[var(--chat-sage-mark)]"
        aria-hidden="true"
      >
        S
      </div>
      <div className="min-w-0">
        {!words && <span className="sr-only">{TYPING_SR_WORDS}</span>}
        <div className="flex items-center gap-1.5 px-1 py-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-[var(--chat-typing-dot)]"
              animate={reduce ? { opacity: 1 } : { y: [0, -3, 0], opacity: [0.35, 1, 0.35] }}
              transition={
                reduce
                  ? undefined
                  : { duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }
              }
            />
          ))}
        </div>
        {words && <p className="px-1 text-sm leading-6 text-[var(--ink-muted)]">{words}</p>}
      </div>
    </div>
  );
}
