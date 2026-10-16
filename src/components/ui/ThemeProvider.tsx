"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { type Theme, type ThemePreference, THEME_COOKIE, resolveTheme } from "@/lib/theme";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToAppearance(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const devicePrefersDark = () => window.matchMedia(DARK_QUERY).matches;
// The server cannot see the device; null means "not known yet".
const unknownOnServer = () => null;

export function ThemeProvider({
  initialPreference,
  children,
}: {
  initialPreference: ThemePreference;
  children: React.ReactNode;
}) {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);
  const prefersDark = useSyncExternalStore(subscribeToAppearance, devicePrefersDark, unknownOnServer);
  const resolved = preference === "system" && prefersDark === null ? null : resolveTheme(preference, prefersDark ?? false);

  useEffect(() => {
    // Until the device is known, leave the attribute the boot script set.
    if (resolved) document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const toggleTheme = useCallback(() => {
    const next: Theme = resolved === "dark" ? "light" : "dark";
    document.cookie = `${THEME_COOKIE}=${next};path=/;max-age=${365 * 24 * 60 * 60};SameSite=Strict`;
    setPreference(next);
  }, [resolved]);

  return (
    <ThemeContext value={{ theme: resolved ?? "light", toggleTheme }}>
      {children}
    </ThemeContext>
  );
}
