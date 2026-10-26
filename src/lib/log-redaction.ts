/**
 * Strip contact details out of third-party error text before it reaches the logs.
 *
 * SMTP rejections and Twilio error bodies quote the recipient address or number
 * verbatim ("550 5.1.1 <student@example.com>", "The 'To' number +1555... is not
 * valid"), so logging a provider error as-is puts back exactly the PII the caller
 * just left out of its own payload. Server logs carry no student contact details
 * at any level (.claude/rules/security.md, Data Privacy).
 *
 * Scope is deliberately narrow: this cleans provider error strings at the two
 * delivery boundaries. It is not a general PII scrubber, and it is not a reason
 * to put a student identifier in a log payload in the first place.
 */

/**
 * Exported (2026-09-07) so src/lib/ai/deidentify.ts can reuse the same
 * definition instead of carrying a second copy. Global regexes carry
 * `lastIndex` between calls: consumers that do anything other than a single
 * `String.prototype.replace` must construct their own instance from `.source`.
 *
 * The leading lookbehind lets a match start only where a run of local-part
 * characters starts. It drops no match: every character a match can hold is a
 * local-part character, and the domain after an "@" does not depend on where
 * the local part began, so if the run's first character cannot start a match
 * no later character in that run can, and if it can, the greedy local part
 * has already reached the run's last valid "@". Without it, a long run with no
 * address in it (a student's 10,000 "a"s) was retried from every index, an
 * O(n^2) scan on the shared event loop (F18).
 */
export const EMAIL_PATTERN =
  /(?<![^\s<>()[\]:;,"])[^\s<>()[\]:;,"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g;

/**
 * Matches E.164 numbers and separator-formatted ones only. A bare run of digits
 * is left alone so timestamps, byte counts, and provider error codes survive.
 */
export const PHONE_PATTERN = /\+\d[\d\s().-]{6,18}\d|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;

export const REDACTED_EMAIL = "[email redacted]";
export const REDACTED_PHONE = "[phone redacted]";

/** Replace email addresses and phone numbers in `text` with fixed placeholders. */
export function redactContactInfo(text: string): string {
  if (typeof text !== "string") return "";

  return text.replace(EMAIL_PATTERN, REDACTED_EMAIL).replace(PHONE_PATTERN, REDACTED_PHONE);
}

/**
 * A provider's own error text, contact details masked, for a log line that has
 * no other diagnostic: an SMTP rejection says whether the login, the relay or
 * the recipient was refused, and errorForLog's name and code do not.
 *
 * Only for a catch whose try block calls the provider and nothing else. A
 * Prisma message quotes query arguments, student ids included, and this does
 * not remove those; anywhere a database call can throw, log errorForLog from
 * src/lib/log-error.ts instead. The ESLint guard on logger calls cannot see
 * inside this helper, so the restriction rests on the call site.
 */
export function providerErrorText(error: unknown): string {
  return redactContactInfo(error instanceof Error ? error.message : String(error));
}
