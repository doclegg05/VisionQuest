"use client";

import { motion, useReducedMotion } from "framer-motion";

export default function TypingIndicator() {
  const reduce = useReducedMotion();

  return (
    <div className="flex gap-3" role="status" aria-label="Sage is typing">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(249,115,22,0.18),var(--chat-bubble-assistant-bg))] text-sm font-bold text-[var(--accent-strong)] shadow-[var(--shadow-card)]">
        S
      </div>
      <div className="rounded-[1.4rem] rounded-bl-md border border-[var(--chat-bubble-assistant-border)] bg-[var(--chat-bubble-assistant-bg)] px-4 py-3">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-2 w-2 rounded-full bg-[var(--chat-typing-dot)]"
              animate={reduce ? { opacity: 1 } : { y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
              transition={reduce ? undefined : { duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
