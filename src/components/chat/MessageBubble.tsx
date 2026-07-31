"use client";

import { useReducedMotion } from "framer-motion";
import SageMark from "./SageMark";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

export default function MessageBubble({ role, content, isStreaming }: MessageBubbleProps) {
  const isUser = role === "user";
  const shouldReduceMotion = useReducedMotion();

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
      role="group"
      aria-label={`${isUser ? "Your" : "Sage's"} message`}
    >
      {isUser ? (
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--chat-bubble-user-avatar)] text-xs font-bold text-white"
          aria-hidden="true"
        >
          Y
        </div>
      ) : (
        <SageMark />
      )}

      <div
        className={[
          "max-w-[min(42rem,82%)] text-[15px] leading-7",
          isUser
            ? "rounded-2xl rounded-br-md px-4 py-2.5 text-white shadow-sm"
            : "px-1 py-0.5 text-[var(--ink-strong)]",
          isStreaming && !shouldReduceMotion ? "animate-pulse" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        // --chat-bubble-user-bg is a gradient; Tailwind's bg-[var(--x)]
        // compiles to background-color which can't render gradients.
        style={isUser ? { background: "var(--chat-bubble-user-bg)" } : undefined}
      >
        <p className="whitespace-pre-wrap break-words">
          {content}
          {isStreaming && shouldReduceMotion ? "…" : ""}
        </p>
      </div>
    </div>
  );
}
