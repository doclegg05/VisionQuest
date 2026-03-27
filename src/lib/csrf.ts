import crypto from "crypto";

export function isUrlHostMatch(value: string | null, host: string | null): boolean {
  if (!value || !host) return false;

  try {
    const parsed = new URL(value);
    return parsed.host === host;
  } catch {
    return false;
  }
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

  const expected = `Bearer ${cronSecret}`;
  const a = Buffer.from(authorizationHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
