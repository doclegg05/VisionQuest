"use client";

import { useReducedMotion } from "framer-motion";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

export default function MessageBubble({ role, content, isStreaming }: MessageBubbleProps) {
  const isUser = role === "user";
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`} role="group" aria-label={`${isUser ? "Your" : "Sage's"} message`}>
      <div
        className={`flex h-10 flex-shrink-0 items-center justify-center rounded-2xl px-3 text-sm font-bold shadow-[var(--shadow-card)]
          ${isUser
            ? "w-10 bg-[var(--chat-bubble-user-avatar)] text-white"
            : "bg-[linear-gradient(135deg,rgba(249,115,22,0.18),var(--chat-bubble-assistant-bg))] text-[var(--accent-strong)]"
          }`}
      >
        {isUser ? "You" : "Sage"}
      </div>

      <div
        className={`max-w-[82%] rounded-[1.4rem] px-4 py-3 text-[15px] leading-7 shadow-[var(--shadow-card-lg)]
          ${isUser
            ? "rounded-br-md text-white"
            : "rounded-bl-md border border-[var(--chat-bubble-assistant-border)] bg-[var(--chat-bubble-assistant-bg)] text-[var(--ink-strong)]"
          }
          ${isStreaming && !shouldReduceMotion ? "animate-pulse" : ""}`}
        // --chat-bubble-user-bg is a gradient; Tailwind's bg-[var(--x)]
        // compiles to background-color which can't render gradients
        // (causing the bubble to fall back to transparent in light mode
        // and hide the white text). Inline `background` shorthand
        // accepts gradients cleanly in both themes.
        style={isUser ? { background: "var(--chat-bubble-user-bg)" } : undefined}
      >
        <p className="whitespace-pre-wrap break-words">{content}{isStreaming && shouldReduceMotion ? "▍" : ""}</p>
      </div>
    </div>
  );
}
