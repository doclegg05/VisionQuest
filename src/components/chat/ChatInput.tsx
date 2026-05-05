"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Command, PaperPlaneTilt, Plus, Sparkle } from "@phosphor-icons/react";
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
  const [focused, setFocused] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevDisabledRef = useRef(disabled);
  const reduce = useReducedMotion();

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
    setUploadStatus(null);
    setPaletteOpen(false);
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

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setMessage(next);
    setPaletteOpen(next.startsWith("/") && !next.includes(" "));
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

  const handleCommandButton = useCallback(() => {
    if (disabled) return;
    setMessage((current) => {
      const next = current.trim().length === 0 ? "/" : current;
      setPaletteOpen(next.startsWith("/") && !next.includes(" "));
      return next;
    });
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [disabled]);

  const handleFileButton = useCallback(() => {
    if (disabled || uploading) return;
    fileInputRef.current?.click();
  }, [disabled, uploading]);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || disabled) return;

      setUploading(true);
      setUploadStatus(`Uploading ${file.name}...`);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("category", "sage-chat");
        const res = await fetch("/api/files", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || "Could not upload that file.");
        }

        const filename = data?.file?.filename || file.name;
        setUploadStatus(`${filename} uploaded to Files.`);
        setMessage((current) => {
          const note = `I uploaded "${filename}" to my Files.`;
          return current.trim().length > 0 ? `${current}\n\n${note}` : note;
        });
        requestAnimationFrame(() => textareaRef.current?.focus());
      } catch (error) {
        setUploadStatus(error instanceof Error ? error.message : "Could not upload that file.");
      } finally {
        setUploading(false);
      }
    },
    [disabled],
  );

  const hasMessage = message.trim().length > 0;

  return (
    <div
      className={[
        "border-t border-[var(--chat-input-border)] bg-[var(--chat-input-bg)] backdrop-blur",
        compact ? "p-2" : "px-4 py-3 sm:p-4",
      ].join(" ")}
    >
      <div className={compact ? "" : "mx-auto max-w-4xl"}>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
          aria-hidden="true"
          tabIndex={-1}
        />
        <div
          className={[
            "relative flex flex-col overflow-visible rounded-[1.75rem] border bg-[var(--surface-raised)] shadow-[0_18px_48px_rgba(7,23,43,0.12)]",
            "transition-colors duration-200",
            focused
              ? "border-[var(--chat-input-border)] shadow-[0_18px_48px_rgba(7,23,43,0.16)]"
              : "border-[var(--chat-input-border)]",
            disabled ? "opacity-75" : "",
            compact ? "rounded-[1.25rem]" : "",
          ].filter(Boolean).join(" ")}
          aria-expanded={paletteOpen}
        >
          {/* Focus glow — decorative halo behind textarea */}
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
            style={{
              background:
                "radial-gradient(ellipse at center, var(--accent-green) 0%, var(--accent-blue) 50%, transparent 75%)",
              filter: compact ? "blur(18px)" : "blur(26px)",
            }}
            animate={{ opacity: focused && !reduce ? 0.25 : 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          />
          <CommandPalette
            open={paletteOpen && !disabled}
            input={message}
            role={role}
            onSelect={handleSelectCommand}
            onClose={() => setPaletteOpen(false)}
          />

          {!compact && (
            <div className="flex items-center gap-2 px-4 pt-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              <Sparkle size={15} weight="fill" className="text-[var(--accent-strong)]" />
              <span>Sage</span>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={role === "student" ? "Message Sage... (try /goal)" : "Message Sage... (try /)"}
            disabled={disabled}
            rows={1}
            aria-label="Message to Sage"
            aria-autocomplete={paletteOpen ? "list" : undefined}
            className={[
              "custom-scrollbar relative w-full resize-none border-0 bg-transparent text-[var(--ink-strong)] placeholder:text-[var(--ink-muted)]",
              "focus:outline-none focus:ring-0 focus-visible:outline-none disabled:cursor-not-allowed overflow-y-auto",
              compact ? "min-h-[42px] px-3 pb-1 pt-3 text-sm" : "min-h-[72px] px-4 py-3 text-base leading-6",
            ].join(" ")}
          />

          <div className={["flex items-center gap-2", compact ? "px-2 pb-2" : "px-3 pb-3"].join(" ")}>
            <button
              onClick={handleFileButton}
              disabled={disabled || uploading}
              type="button"
              title="Upload file"
              className={[
                "grid shrink-0 place-items-center rounded-full border border-[var(--border)] text-[var(--ink-muted)]",
                "transition-colors hover:bg-[var(--surface-interactive)] hover:text-[var(--ink-strong)]",
                "disabled:cursor-not-allowed disabled:opacity-50",
                compact ? "h-8 w-8" : "h-9 w-9",
              ].join(" ")}
              aria-label="Upload file"
            >
              <Plus size={compact ? 17 : 19} weight="bold" />
            </button>

            <button
              onClick={handleCommandButton}
              disabled={disabled}
              type="button"
              title="Open Sage commands"
              className={[
                "inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-full border border-[var(--border)] px-3 text-sm font-semibold",
                "text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-interactive)] hover:text-[var(--ink-strong)]",
                "disabled:cursor-not-allowed disabled:opacity-50",
                compact ? "h-8 px-2" : "",
              ].join(" ")}
              aria-label="Open Sage commands"
            >
              <Command size={compact ? 16 : 17} weight="bold" />
              {!compact && <span>Commands</span>}
            </button>

            <p className="min-w-0 flex-1 truncate text-xs text-[var(--ink-muted)]">
              {uploadStatus || (compact ? "Enter sends" : "Press Enter to send. Shift+Enter adds a line.")}
            </p>

            <motion.button
              onClick={handleSubmit}
              disabled={disabled || !hasMessage}
              aria-label="Send message"
              type="button"
              title="Send"
              whileTap={reduce || disabled || !hasMessage ? undefined : { scale: 0.92 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
              className={[
                "grid shrink-0 place-items-center rounded-full bg-[var(--ink-strong)] text-[var(--surface-base)] shadow-[0_12px_26px_rgba(7,23,43,0.18)]",
                "transition-colors hover:bg-[var(--accent-strong)] hover:text-white",
                "disabled:cursor-not-allowed disabled:bg-[var(--surface-interactive)] disabled:text-[var(--ink-muted)] disabled:shadow-none",
                compact ? "h-9 w-9" : "h-10 w-10",
              ].join(" ")}
            >
              <PaperPlaneTilt size={compact ? 18 : 20} weight="fill" />
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
