"use client";

import { PencilSimple, X } from "@phosphor-icons/react";

interface GoalRowActionsProps {
  /** Row kind, used in the accessible names: "Edit Weekly", "Dismiss Weekly". */
  label: string;
  onEdit: () => void;
  onDismiss: () => void;
  iconSize?: number;
}

const BUTTON_BASE =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--ink-muted)] transition-colors";

/**
 * Edit and Dismiss controls for a goal row. Always visible in muted ink with
 * real 44px targets, so a student on a phone can reach them; hover only adds
 * emphasis, it never reveals (F45 / UX-06). The negative vertical margin keeps
 * the row's layout height near the text line while the hit area stays 44px.
 */
export function GoalRowActions({ label, onEdit, onDismiss, iconSize = 14 }: GoalRowActionsProps) {
  return (
    <div className="-my-1.5 ml-2 flex shrink-0 gap-1">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${label}`}
        className={`${BUTTON_BASE} hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]`}
      >
        <PencilSimple size={iconSize} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss ${label}`}
        className={`${BUTTON_BASE} hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40`}
      >
        <X size={iconSize} aria-hidden="true" />
      </button>
    </div>
  );
}
