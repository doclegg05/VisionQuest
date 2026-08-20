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

const EMAIL_PATTERN =
  /[^\s<>()[\]:;,"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g;

/**
 * Matches E.164 numbers and separator-formatted ones only. A bare run of digits
 * is left alone so timestamps, byte counts, and provider error codes survive.
 */
const PHONE_PATTERN = /\+\d[\d\s().-]{6,18}\d|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;

export const REDACTED_EMAIL = "[email redacted]";
export const REDACTED_PHONE = "[phone redacted]";

/** Replace email addresses and phone numbers in `text` with fixed placeholders. */
export function redactContactInfo(text: string): string {
  if (typeof text !== "string") return "";

  return text.replace(EMAIL_PATTERN, REDACTED_EMAIL).replace(PHONE_PATTERN, REDACTED_PHONE);
}
