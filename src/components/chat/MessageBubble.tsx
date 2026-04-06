"use client";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

export default function MessageBubble({ role, content, isStreaming }: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`} role="group" aria-label={`${isUser ? "Your" : "Sage's"} message`}>
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl text-sm font-bold shadow-[0_12px_28px_rgba(16,37,62,0.12)]
          ${isUser
            ? "bg-[var(--chat-bubble-user-avatar)] text-white"
            : "bg-[linear-gradient(135deg,rgba(249,115,22,0.18),var(--chat-bubble-assistant-bg))] text-[var(--accent-strong)]"
          }`}
      >
        {isUser ? "You" : "S"}
      </div>

      <div
        className={`max-w-[82%] rounded-[1.4rem] px-4 py-3 text-[15px] leading-7 shadow-[0_16px_36px_rgba(16,37,62,0.08)]
          ${isUser
            ? "rounded-br-md bg-[var(--chat-bubble-user-bg)] text-white"
            : "rounded-bl-md border border-[var(--chat-bubble-assistant-border)] bg-[var(--chat-bubble-assistant-bg)] text-[var(--ink-strong)] backdrop-blur"
          }
          ${isStreaming ? "animate-pulse" : ""}`}
      >
        <p className="whitespace-pre-wrap break-words">{content}</p>
      </div>
    </div>
  );
}
