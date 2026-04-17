"use client";

import { getStarterChips, type ChatRole } from "@/lib/chat/commands";

interface StarterChipsProps {
  role: ChatRole;
  onSelect: (prefill: string) => void;
}

export function StarterChips({ role, onSelect }: StarterChipsProps) {
  const chips = getStarterChips(role);

  return (
    <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Conversation starters">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={() => onSelect(chip.prefill)}
          className="rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2 text-sm font-medium text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-interactive)]"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
