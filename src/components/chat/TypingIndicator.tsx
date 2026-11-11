"use client";

import { motion, useReducedMotion } from "framer-motion";

import { SLOW_REPLY_WORDS } from "./wait-and-stop";

interface TypingIndicatorProps {
  /** Sage has said nothing for SLOW_REPLY_MS: show the wait words. */
  slow?: boolean;
}

/**
 * The dots while Sage has not sent a word. This is the turn's one polite
 * status: the words that appear after five seconds are its content, so a
 * screen reader announces them once, when they appear.
 */
export default function TypingIndicator({ slow = false }: TypingIndicatorProps) {
  const reduce = useReducedMotion();

  return (
    <div className="flex gap-3" role="status">
      <div
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--chat-sage-mark-bg)] text-xs font-bold text-[var(--chat-sage-mark)]"
        aria-hidden="true"
      >
        S
      </div>
      <div className="min-w-0">
        <span className="sr-only">Sage is typing.</span>
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
        {slow && <p className="px-1 text-sm leading-6 text-[var(--ink-muted)]">{SLOW_REPLY_WORDS}</p>}
      </div>
    </div>
  );
}
