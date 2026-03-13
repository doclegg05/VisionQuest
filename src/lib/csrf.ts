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

  if (!cronSecret) {
    return false;
  }

  return authorizationHeader === `Bearer ${cronSecret}`;
}
