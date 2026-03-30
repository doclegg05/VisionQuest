export type Theme = "dark" | "light";

export const THEME_COOKIE = "vq-theme";
export const THEME_DEFAULT: Theme = "dark";

export function getThemeFromCookie(cookieValue: string | undefined): Theme {
  if (cookieValue === "light" || cookieValue === "dark") return cookieValue;
  return THEME_DEFAULT;
}
