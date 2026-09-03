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
