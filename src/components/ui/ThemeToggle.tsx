"use client";

import { Sun, Moon } from "@phosphor-icons/react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      type="button"
      className={[
        // The 44px button is the hit target; the 36px circle inside is what people see. -m-1 keeps the
        // layout footprint at 36px so the mobile top bar does not get wider. No display class here, so
        // callers can still pass `hidden`/`block` (NavBar does).
        "group -m-1 size-11 rounded-full p-1",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="flex size-9 items-center justify-center rounded-full border border-[var(--border)] transition-colors group-hover:bg-[var(--surface-overlay)]">
        {theme === "dark" ? (
          <Sun aria-hidden="true" size={18} weight="bold" className="text-[var(--accent-gold)]" />
        ) : (
          <Moon aria-hidden="true" size={18} weight="bold" className="text-[var(--accent-blue)]" />
        )}
      </span>
    </button>
  );
}
