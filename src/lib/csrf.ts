export function isUrlHostMatch(value: string | null, host: string | null): boolean {
  if (!value || !host) return false;

  try {
    const parsed = new URL(value);
    return parsed.host === host;
  } catch {
    return false;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Paths whose POST comes from a named third party that cannot send our Origin
 * header, and which authenticate the request THEMSELVES with a provider
 * signature over the body.
 *
 * This is an exemption from the Origin check only, and it is not free: a path
 * listed here MUST verify a signature before it acts, or it becomes an
 * unauthenticated write endpoint. `/api/sms/inbound` verifies Twilio's
 * `X-Twilio-Signature` (HMAC-SHA1 over the URL plus the sorted form fields,
 * src/lib/nudges/twilio-signature.ts) and fails closed when TWILIO_AUTH_TOKEN
 * is unset. The list is exact-match and deliberately not a prefix: adding a
 * whole subtree here would exempt routes nobody reviewed.
 */
export const SIGNED_WEBHOOK_PATHS = ["/api/sms/inbound"] as const;

export function isSignedWebhookPath(pathname: string): boolean {
  return (SIGNED_WEBHOOK_PATHS as readonly string[]).includes(pathname);
}

export function isAuthorizedInternalRequest(
  pathname: string,
  authorizationHeader: string | null,
  cronSecret: string | undefined
): boolean {
  if (!pathname.startsWith("/api/internal/")) {
    return false;
  }

  if (!cronSecret || !authorizationHeader) {
    return false;
  }

  return constantTimeEqual(authorizationHeader, `Bearer ${cronSecret}`);
}
