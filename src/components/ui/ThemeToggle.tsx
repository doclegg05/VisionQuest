"use client";

import { Sun, Moon } from "@phosphor-icons/react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      type="button"
      className={`rounded-full border border-[var(--border)] p-2 transition-colors hover:bg-[var(--surface-overlay)] ${className}`}
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
