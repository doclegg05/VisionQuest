"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

export default function ChatInput({ onSend, disabled, compact }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevDisabledRef = useRef(disabled);

  useEffect(() => {
    if (prevDisabledRef.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
  }, [disabled]);

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setMessage("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
  }, [message, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      const scrollHeight = el.scrollHeight;
      el.style.height = "auto";
      requestAnimationFrame(() => {
        el.style.height = Math.min(scrollHeight, 160) + "px";
      });
    }
  };

  return (
    <div className={`border-t border-[var(--chat-input-border)] bg-[var(--chat-input-bg)] backdrop-blur ${compact ? "p-2" : "p-4"}`}>
      <div className={`flex items-end gap-2 ${compact ? "" : "mx-auto max-w-4xl gap-3"}`}>
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Type your message..."
          disabled={disabled}
          rows={1}
          aria-label="Message to Sage"
          className={`textarea-field flex-1 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] overflow-y-auto ${compact ? "min-h-[42px] px-3 py-2 text-sm" : "min-h-[54px] px-4 py-3 text-base"}`}
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !message.trim()}
          aria-label="Send message"
          type="button"
          className={`primary-button text-sm disabled:cursor-not-allowed disabled:opacity-60 ${compact ? "px-3 py-2.5" : "px-5 py-3.5"}`}
        >
          Send
        </button>
      </div>
    </div>
  );
}
