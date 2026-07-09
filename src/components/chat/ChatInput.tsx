"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Command, PaperPlaneTilt, Plus } from "@phosphor-icons/react";
import { CommandPalette } from "./CommandPalette";
import { type ChatRole, type SlashCommand } from "@/lib/chat/commands";

interface ChatInputProps {
  onSend: (message: string, attachmentIds?: string[]) => void;
  disabled?: boolean;
  compact?: boolean;
  role?: ChatRole;
}

export default function ChatInput({ onSend, disabled, compact, role = "student" }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [serverCommands, setServerCommands] = useState<SlashCommand[] | undefined>();
  const [focused, setFocused] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<{ id: string; filename: string }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevDisabledRef = useRef(disabled);
  const commandListboxId = useId();
  const reduce = useReducedMotion();

  useEffect(() => {
    if (prevDisabledRef.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    let cancelled = false;

    async function loadServerCommands() {
      try {
        const res = await fetch("/api/chat/slash-commands", { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json() as {
          agentEnabled?: boolean;
          commands?: Array<{
            name: string;
            label: string;
            description: string;
            argHint?: string;
            requiresArg?: boolean;
          }>;
        };
        if (cancelled) return;
        if (!data.agentEnabled || !data.commands?.length) {
          setServerCommands(undefined);
          return;
        }
        setServerCommands(
          data.commands.map((command) => {
            const slash = command.name.startsWith("/") ? command.name : `/${command.name}`;
            return {
              slash,
              label: command.label,
              description: command.description,
              prefill: command.requiresArg ? `${slash} ` : slash,
              roles: [role],
            };
          }),
        );
      } catch {
        if (!cancelled) setServerCommands(undefined);
      }
    }

    void loadServerCommands();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;
    onSend(
      trimmed || "I attached a file for you.",
      attachments.length > 0 ? attachments.map((attachment) => attachment.id) : undefined,
    );
    setMessage("");
    setAttachments([]);
    setUploadStatus(null);
    setPaletteOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
  }, [message, attachments, disabled, onSend]);

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
        const res = await fetch("/api/chat/upload", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || "Could not upload that file.");
        }

        const filename = data?.data?.filename || file.name;
        setAttachments((current) => [
          ...current,
          { id: data.data.fileUploadId as string, filename },
        ]);
        setUploadStatus(`${filename} attached — send your message and Sage will see it.`);
        requestAnimationFrame(() => textareaRef.current?.focus());
      } catch (error) {
        setUploadStatus(error instanceof Error ? error.message : "Could not upload that file.");
      } finally {
        setUploading(false);
      }
    },
    [disabled],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }, []);

  const canSend = message.trim().length > 0 || attachments.length > 0;

  return (
    <div className={compact ? "p-2" : "px-3 pb-3 pt-1 sm:px-4 sm:pb-4"}>
      <div className={compact ? "" : "mx-auto max-w-3xl"}>
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--chat-panel-border)] bg-[var(--chat-panel-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)]"
              >
                <span className="max-w-40 truncate">{attachment.filename}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`Remove attachment ${attachment.filename}`}
                  className="text-[var(--ink-faint)] hover:text-[var(--badge-error-text)]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
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
            "relative flex flex-col overflow-visible rounded-2xl border bg-[var(--chat-panel-bg)]",
            "shadow-[0_8px_28px_rgba(7,23,43,0.08)] transition-[box-shadow,border-color] duration-200",
            focused
              ? "border-[var(--chat-sage-mark)] shadow-[0_0_0_3px_var(--chat-composer-focus)]"
              : "border-[var(--chat-panel-border)]",
            disabled ? "opacity-75" : "",
            compact ? "rounded-xl" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <CommandPalette
            listboxId={commandListboxId}
            open={paletteOpen && !disabled}
            input={message}
            role={role}
            commands={serverCommands}
            onSelect={handleSelectCommand}
            onClose={() => setPaletteOpen(false)}
          />

          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={role === "student" ? "Message Sage…" : "Message Sage…"}
            disabled={disabled}
            rows={1}
            role="combobox"
            aria-label="Message to Sage"
            aria-autocomplete={paletteOpen ? "list" : undefined}
            aria-controls={paletteOpen ? commandListboxId : undefined}
            aria-expanded={paletteOpen}
            className={[
              "custom-scrollbar relative w-full resize-none border-0 bg-transparent text-[var(--ink-strong)] placeholder:text-[var(--ink-muted)]",
              "focus:outline-none focus:ring-0 focus-visible:outline-none disabled:cursor-not-allowed overflow-y-auto",
              compact ? "min-h-[40px] px-3 pb-1 pt-2.5 text-sm" : "min-h-[52px] px-4 py-3 text-[15px] leading-6",
            ].join(" ")}
          />

          <div className={["flex items-center gap-2", compact ? "px-2 pb-2" : "px-3 pb-2.5"].join(" ")}>
            <button
              onClick={handleFileButton}
              disabled={disabled || uploading}
              type="button"
              title="Upload file"
              className={[
                "grid shrink-0 place-items-center rounded-full text-[var(--ink-muted)]",
                "transition-colors hover:bg-[var(--surface-interactive)] hover:text-[var(--ink-strong)]",
                "disabled:cursor-not-allowed disabled:opacity-50",
              "h-11 w-11",
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
                "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-sm font-semibold",
                "text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-interactive)] hover:text-[var(--ink-strong)]",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "min-h-11",
              ].join(" ")}
              aria-label="Open Sage commands"
            >
              <Command size={compact ? 16 : 17} weight="bold" />
              {!compact && <span>Commands</span>}
            </button>

            <p className="min-w-0 flex-1 truncate text-xs text-[var(--ink-muted)]">
              {uploadStatus || (compact ? "Enter sends" : "Enter to send · Shift+Enter for a new line")}
            </p>

            <motion.button
              onClick={handleSubmit}
              disabled={disabled || !canSend}
              aria-label="Send message"
              type="button"
              title="Send"
              whileTap={reduce || disabled || !canSend ? undefined : { scale: 0.92 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
              className={[
                "grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors",
                canSend && !disabled
                  ? "bg-[var(--accent-strong)] text-white shadow-[0_8px_18px_rgba(42,138,60,0.28)] hover:opacity-95"
                  : "cursor-not-allowed bg-[var(--surface-interactive)] text-[var(--ink-muted)] shadow-none",
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
