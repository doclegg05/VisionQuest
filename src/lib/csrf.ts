import { createHash, timingSafeEqual } from "node:crypto";

export function isUrlHostMatch(value: string | null, host: string | null): boolean {
  if (!value || !host) return false;

  try {
    const parsed = new URL(value);
    return parsed.host === host;
  } catch {
    return false;
  }
}

/**
 * Equality that takes the same time whatever the inputs' lengths. Both sides
 * are hashed to 32 bytes first, so there is no length check to return early
 * on: a guess of the wrong length costs the same as a near miss, and the
 * response time says nothing about how long the secret is.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
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
  cronSecret: string | undefined,
  intakeSecret?: string | undefined,
): boolean {
  if (pathname.startsWith("/api/internal/")) {
    if (!cronSecret || !authorizationHeader) {
      return false;
    }
    return constantTimeEqual(authorizationHeader, `Bearer ${cronSecret}`);
  }

  // The intake webhook's caller is an external SaaS (Power Automate), so its
  // secret is a separate, declared credential — never a fallback to
  // CRON_SECRET. Sharing them would mean one vendor-side leak authenticates
  // every /api/internal/* cron endpoint too. INTAKE_WEBHOOK_SECRET unset is a
  // misconfiguration, and this fails closed on it rather than quietly widening
  // the blast radius of a secret the vendor already holds.
  if (pathname === "/api/intake/webhook") {
    if (!intakeSecret || !authorizationHeader) {
      return false;
    }
    return constantTimeEqual(authorizationHeader, `Bearer ${intakeSecret}`);
  }

  return false;
}

/**
 * The route-side form of the same check, for the sessionless /api/internal
 * handlers. The proxy's check alone is not enough: it guards only
 * state-changing methods, so a GET never meets it, and it accepts any request
 * whose Origin matches the host, which a script can send.
 */
export function isAuthorizedInternalRoute(req: Request): boolean {
  return isAuthorizedInternalRequest(
    new URL(req.url).pathname,
    req.headers.get("authorization"),
    process.env.CRON_SECRET,
  );
}
