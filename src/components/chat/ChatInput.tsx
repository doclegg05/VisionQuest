"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CommandPalette } from "./CommandPalette";
import { type ChatRole } from "@/lib/chat/commands";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  compact?: boolean;
  role?: ChatRole;
}

export default function ChatInput({ onSend, disabled, compact, role = "student" }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevDisabledRef = useRef(disabled);

  useEffect(() => {
    if (prevDisabledRef.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
  }, [disabled]);

  // Open palette only when the FIRST char is "/" and there's no space yet.
  // Derived synchronously — no effect needed.
  const shouldPaletteOpen = message.startsWith("/") && !message.includes(" ");
  if (paletteOpen !== shouldPaletteOpen) {
    setPaletteOpen(shouldPaletteOpen);
  }

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
    // When palette is open, let it handle Enter/Arrow/Escape via its own listener.
    if (paletteOpen && (e.key === "Enter" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape")) {
      return;
    }
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

  const handleSelectCommand = useCallback(
    (command: { prefill: string }) => {
      setMessage(command.prefill);
      setPaletteOpen(false);
      // Keep focus in textarea and place caret at end
      const el = textareaRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(command.prefill.length, command.prefill.length);
        });
      }
    },
    [],
  );

  return (
    <div className={`border-t border-[var(--chat-input-border)] bg-[var(--chat-input-bg)] backdrop-blur ${compact ? "p-2" : "p-4"}`}>
      <div className={`flex items-end gap-2 ${compact ? "" : "mx-auto max-w-4xl gap-3"}`}>
        <div className="relative flex-1" aria-expanded={paletteOpen}>
          <CommandPalette
            open={paletteOpen && !disabled}
            input={message}
            role={role}
            onSelect={handleSelectCommand}
            onClose={() => setPaletteOpen(false)}
          />
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={role === "student" ? "Type your message... (try /goal)" : "Type your message... (try /)"}
            disabled={disabled}
            rows={1}
            aria-label="Message to Sage"
            aria-autocomplete={paletteOpen ? "list" : undefined}
            className={`textarea-field w-full resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] overflow-y-auto ${compact ? "min-h-[42px] px-3 py-2 text-sm" : "min-h-[54px] px-4 py-3 text-base"}`}
          />
        </div>
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
