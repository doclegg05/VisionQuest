"use client";

import { useReducedMotion } from "framer-motion";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { ReadAloudButton } from "@/components/ui/ReadAloudButton";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  /** A failure sentence from Sage: drawn with the house error icon. */
  failed?: boolean;
  /** An id for the text, so Try again can point at it with aria-describedby. */
  textId?: string;
}

export default function MessageBubble({ role, content, isStreaming, failed, textId }: MessageBubbleProps) {
  const isUser = role === "user";
  const shouldReduceMotion = useReducedMotion();

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
      role="group"
      aria-label={`${isUser ? "Your" : "Sage's"} message`}
    >
      <div
        className={[
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold",
          isUser
            ? "bg-[var(--chat-bubble-user-avatar)] text-white"
            : "bg-[var(--chat-sage-mark-bg)] text-[var(--chat-sage-mark)]",
        ].join(" ")}
        aria-hidden="true"
      >
        {isUser ? "Y" : "S"}
      </div>

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
        {failed ? (
          <div className="flex items-start gap-2">
            <WarningCircle size={20} weight="bold" aria-hidden="true" className="shrink-0" />
            <p id={textId} className="min-w-0 whitespace-pre-wrap break-words">{content}</p>
          </div>
        ) : (
          <p id={textId} className="whitespace-pre-wrap break-words">
            {content}
            {isStreaming && shouldReduceMotion ? "…" : ""}
          </p>
        )}
        {/* Read-aloud lives on Sage's finished replies: an explain_job
            explanation reaches the student as Sage's own text, because
            ChatWindow renders a tool_result as a status chip (its summary) and
            does not render the tool's `data`. Renders nothing where the
            browser has no on-device voice. */}
        {!isUser && !isStreaming && (
          <div className="mt-2">
            <ReadAloudButton text={content} />
          </div>
        )}
      </div>
    </div>
  );
}
