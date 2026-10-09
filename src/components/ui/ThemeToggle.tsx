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
        // size-11 with p-3 centers the 18px block svg (1 + 12 + 18 + 12 + 1 = 44) without a display class,
        // so callers can still pass `hidden`/`block` (NavBar does) without breaking the layout.
        "size-11 rounded-full border border-[var(--border)] p-3 transition-colors hover:bg-[var(--surface-overlay)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? (
        <Sun aria-hidden="true" size={18} weight="bold" className="text-[var(--accent-gold)]" />
      ) : (
        <Moon aria-hidden="true" size={18} weight="bold" className="text-[var(--accent-blue)]" />
      )}
    </button>
  );
}
