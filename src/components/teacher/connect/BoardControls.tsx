"use client";

import { useMemo, useState } from "react";

/**
 * The two controls every board on the console shares: a text filter and a
 * "Show more" collapse (UX review WARNING #4).
 *
 * A board that renders every card is unusable the term it has forty leads and
 * thirty students, and at 375px it is unusable much sooner than that. One
 * place for both so the three boards cannot drift into behaving differently.
 *
 * No Prisma import anywhere in this file — it is a client component, and the
 * connect module's server halves must stay out of the browser bundle.
 */

/** Cards rendered before "Show more" appears. */
export const BOARD_PAGE_SIZE = 10;

export function useBoardPaging<T>(items: T[]) {
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(
    () => (expanded ? items : items.slice(0, BOARD_PAGE_SIZE)),
    [items, expanded],
  );
  return {
    visible,
    hiddenCount: Math.max(items.length - visible.length, 0),
    expanded,
    expand: () => setExpanded(true),
  };
}

export function BoardFilter({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="mt-3">
      <label htmlFor={id} className="block text-sm font-medium text-[var(--ink-strong)]">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={hint}
        className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--border)] bg-[var(--surface-base)] px-3 py-2 text-sm text-[var(--ink-strong)]"
      />
    </div>
  );
}

export function ShowMore({
  hiddenCount,
  expanded,
  onExpand,
  noun,
}: {
  hiddenCount: number;
  expanded: boolean;
  onExpand: () => void;
  noun: string;
}) {
  if (expanded || hiddenCount === 0) return null;
  return (
    <button
      type="button"
      onClick={onExpand}
      className="mt-4 min-h-[44px] w-full rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] sm:w-auto"
    >
      Show {hiddenCount} more {noun}
    </button>
  );
}
