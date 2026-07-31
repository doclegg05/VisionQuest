"use client";

import { motion, useReducedMotion } from "framer-motion";

export default function TypingIndicator() {
  const reduce = useReducedMotion();

  return (
    <div className="flex gap-3" role="status" aria-label="Sage is typing">
      <div
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--chat-sage-mark-bg)] text-xs font-bold text-[var(--chat-sage-mark)]"
        aria-hidden="true"
      >
        S
      </div>
      <div className="flex items-center gap-1.5 px-1 py-2">
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
    </div>
  );
}
