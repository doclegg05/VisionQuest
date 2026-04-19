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
 *
 * Covers IPv4 (including decimal/octal/hex encodings), IPv4-mapped IPv6,
 * and IPv6 loopback / unique-local / link-local / site-local ranges.
 */
export function isSafeExternalUrl(url: string): boolean {
  if (!isValidUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Never allow bare "localhost"
    if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;

    // IPv6: URL parser returns "fc00::1" (no brackets). Also catch the
    // legacy "[::1]"-with-brackets form just in case some caller leaves them.
    const ipv6 = hostname.replace(/^\[|\]$/g, "");
    if (ipv6.includes(":")) return isSafeIpv6(ipv6);

    // IPv4 (dotted-decimal, decimal, octal, hex)
    const ipv4 = parseIpv4(hostname);
    if (ipv4 !== null) return isSafeIpv4(ipv4);

    return true;
  } catch {
    return false;
  }
}

/** Parse dotted-decimal / decimal / hex / octal IPv4 into four octets. Returns null if not an IPv4 form. */
function parseIpv4(host: string): [number, number, number, number] | null {
  // Pure decimal (e.g. "2130706433" for 127.0.0.1)
  if (/^\d+$/.test(host)) {
    const n = Number(host);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }
  // Hex (e.g. "0x7f000001")
  if (/^0x[0-9a-f]+$/i.test(host)) {
    const n = parseInt(host, 16);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }
  // Dotted (accepts decimal, octal-with-leading-0, hex 0x…)
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^[0-9a-fx]+$/i.test(p)) return null;
    let n: number;
    if (/^0x/i.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^\d+$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return [nums[0], nums[1], nums[2], nums[3]];
}

function isSafeIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return false;                // 0.0.0.0/8
  if (a === 10) return false;               // RFC1918
  if (a === 127) return false;              // loopback
  if (a === 169 && b === 254) return false; // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
  if (a === 192 && b === 168) return false; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a >= 224) return false;               // multicast + reserved
  return true;
}

function isSafeIpv6(host: string): boolean {
  const lower = host.toLowerCase();
  // Loopback
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return false;
  // Unspecified
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return false;
  // IPv4-mapped ::ffff:* in either dotted (::ffff:10.0.0.1) or hex
  // (::ffff:a00:1 after WHATWG normalization) form — decode and check as IPv4.
  if (/^::ffff:/i.test(lower)) {
    const suffix = lower.slice("::ffff:".length);
    // Dotted-quad
    const dotted = parseIpv4(suffix);
    if (dotted !== null) return isSafeIpv4(dotted);
    // Hex form "XXXX:YYYY" — each group is 16 bits
    const hex = suffix.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isSafeIpv4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
    }
    return false; // unknown mapped form — fail closed
  }
  // Unique-local (fc00::/7 → first byte fc or fd)
  if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return false;
  // Link-local (fe80::/10 → fe80..febf)
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return false;
  // Site-local (fec0::/10, deprecated but still blocked)
  if (/^fe[cdef][0-9a-f]?:/.test(lower)) return false;
  // Multicast (ff00::/8)
  if (/^ff[0-9a-f]{0,2}:/.test(lower)) return false;
  return true;
}

/**
 * Allow a locally hosted Ollama endpoint on loopback, or a public http/https
 * endpoint. Reject private/link-local/internal network targets.
 */
export function isSafeAiProviderUrl(url: string): boolean {
  if (!isValidUrl(url)) return false;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    ) {
      return true;
    }

    return isSafeExternalUrl(url);
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
