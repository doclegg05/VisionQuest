export type Theme = "dark" | "light";

/** What the person chose. "system" follows the device's appearance. */
export type ThemePreference = Theme | "system";

export const THEME_COOKIE = "vq-theme";
export const THEME_DEFAULT: ThemePreference = "system";

export function getThemePreferenceFromCookie(cookieValue: string | undefined): ThemePreference {
  if (cookieValue === "light" || cookieValue === "dark") return cookieValue;
  return THEME_DEFAULT;
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Theme {
  if (preference !== "system") return preference;
  return prefersDark ? "dark" : "light";
}

/**
 * Inline <head> script for the "system" preference. The server cannot know the
 * device's appearance, so it omits data-theme and this sets it before first
 * paint. data-theme stays the only thing the dark: variant keys on.
 */
export const THEME_BOOT_SCRIPT =
  'if(!document.documentElement.hasAttribute("data-theme")){' +
  'document.documentElement.setAttribute("data-theme",' +
  'matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}';
