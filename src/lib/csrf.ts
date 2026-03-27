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
