"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, type ChatRole, type SlashCommand } from "@/lib/chat/commands";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  input: string;
  role: ChatRole;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export function CommandPalette({ open, input, role, onSelect, onClose }: CommandPaletteProps) {
  const [highlightIndex, setHighlightIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => filterCommands(input, role), [input, role]);

  // Reset highlight when matches change
  const safeHighlightIndex = Math.min(highlightIndex, Math.max(0, matches.length - 1));

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => (matches.length === 0 ? 0 : (i + 1) % matches.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => (matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length));
      } else if (e.key === "Enter") {
        if (matches[safeHighlightIndex]) {
          e.preventDefault();
          onSelect(matches[safeHighlightIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, matches, safeHighlightIndex, onSelect, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-[0_24px_64px_rgba(7,23,43,0.18)] backdrop-blur-md"
      role="dialog"
      aria-label="Sage command palette"
    >
      {matches.length === 0 ? (
        <div className="px-4 py-3 text-sm text-[var(--ink-muted)]">
          No matching commands. Keep typing to send a regular message.
        </div>
      ) : (
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Available commands"
          className="max-h-64 overflow-y-auto py-1"
        >
          {matches.map((cmd, i) => (
            <li
              key={cmd.slash}
              role="option"
              aria-selected={i === safeHighlightIndex}
              onMouseEnter={() => setHighlightIndex(i)}
              onClick={() => onSelect(cmd)}
              className={cn(
                "flex cursor-pointer items-baseline gap-3 px-4 py-2.5 text-sm",
                i === safeHighlightIndex
                  ? "bg-[var(--surface-interactive-hover)] text-[var(--ink-strong)]"
                  : "text-[var(--ink-strong)]",
              )}
            >
              <span className="font-mono text-[13px] font-semibold text-[var(--accent-strong)]">
                {cmd.slash}
              </span>
              <span className="font-medium">{cmd.label}</span>
              <span className="truncate text-xs text-[var(--ink-muted)]">
                {cmd.description}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
