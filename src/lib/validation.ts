// --- URL validation ---

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Block URLs targeting internal/private network destinations.
 * Prevents SSRF via admin-configured webhooks or similar features.
 */
export function isSafeExternalUrl(url: string): boolean {
  if (!isValidUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Block loopback
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return false;
    }
    // Block link-local and metadata endpoints
    if (hostname === "169.254.169.254" || hostname.startsWith("169.254.")) {
      return false;
    }
    // Block private RFC1918 ranges (simple prefix check for common patterns)
    if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) {
      return false;
    }
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
      return false;
    }
    // Block 0.0.0.0
    if (hostname === "0.0.0.0") return false;
    // Block [::] and other IPv6 loopback/private forms
    if (hostname.startsWith("[")) return false;

    return true;
  } catch {
    return false;
  }
}

export function sanitizeUrl(url: string): string | null {
  return isValidUrl(url) ? url : null;
}

// --- Email validation (RFC 5322 simplified) ---

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return EMAIL_RE.test(email);
}

// --- String length limits ---

/** Max lengths for common text fields. */
export const MAX_LENGTHS = {
  displayName: 100,
  studentId: 50,
  email: 254,
  password: 128,
  chatMessage: 10_000,
  title: 200,
  description: 5_000,
  body: 50_000,
  notes: 10_000,
  url: 2_048,
  label: 200,
  category: 100,
  filename: 255,
} as const;

/**
 * Validate that a string does not exceed a max length.
 * Returns an error message or null if valid.
 */
export function checkLength(
  value: string,
  field: keyof typeof MAX_LENGTHS,
  fieldLabel?: string
): string | null {
  const max = MAX_LENGTHS[field];
  if (value.length > max) {
    return `${fieldLabel || field} must be ${max} characters or fewer.`;
  }
  return null;
}

/**
 * Trim and validate a required string field.
 * Returns { value, error } — value is trimmed, error is null if valid.
 */
export function requireString(
  raw: unknown,
  field: keyof typeof MAX_LENGTHS,
  fieldLabel?: string
): { value: string; error: string | null } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return { value, error: `${fieldLabel || field} is required.` };
  }
  const lengthError = checkLength(value, field, fieldLabel);
  if (lengthError) {
    return { value, error: lengthError };
  }
  return { value, error: null };
}
