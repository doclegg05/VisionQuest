export const GENERIC_AUTH_ERROR_MESSAGE = "An error occurred. Please try again.";

/**
 * Resolves a `?error=` redirect code to its plain-language copy. The code
 * comes straight from the URL, so the lookup must be an own-property check:
 * `?error=__proto__` would otherwise return Object.prototype, which React
 * cannot render, and a crafted link would break the sign-in page.
 */
export function lookupErrorMessage(messages: Record<string, string>, code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(messages, code) ? messages[code] : GENERIC_AUTH_ERROR_MESSAGE;
}
