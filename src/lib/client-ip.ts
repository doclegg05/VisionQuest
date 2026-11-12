// =============================================================================
// The client's IP, for rate-limit buckets and audit rows, and nothing else.
//
// Behind Render's proxy the socket address is the proxy's, so a proxy header
// is the only signal available. This value gates coarse buckets and never
// authorization.
//
// WHICH HOP (readiness A6, 2026-11-11; corrected in A6b the same day).
// `X-Forwarded-For` is a list the caller starts and every proxy appends to.
// The FIRST entry is whatever the caller wrote, so reading it let one machine
// claim a new address on every request and never reach a per-network limit.
// The entries trusted proxies appended are on the RIGHT, one per proxy.
//
// Render serves its onrender.com domain through Cloudflare, so the chain is
// client, Cloudflare edge, Render's proxy, app. Cloudflare appends the client
// it saw; Render's proxy then appends the Cloudflare edge it saw. A published
// trace (https://rohitpaulk.com/articles/render-rails-remote-ip) shows the app
// receiving `X-Forwarded-For: <client>, <cloudflare edge>`, so the client is
// two entries from the right. `TRUSTED_PROXY_HOPS` (default 2) is that count.
// The risk runs both ways, and one owner check in DEPLOY.md settles it:
//   - too low (1): every student behind one Cloudflare edge shares one bucket,
//     so one classroom can lock out another;
//   - too high (3+): the count reaches into entries the caller wrote, so the
//     address is forgeable again.
//
// Cloudflare also sets `CF-Connecting-IP` to the client. `CLOUDFLARE_IN_FRONT=
// true` reads that header instead. It stays off by default: Cloudflare
// overwrites the header on requests it proxies, but nothing here proves every
// request came through Cloudflare, and a request that did not could carry a
// header the caller wrote. Turn it on only after the owner check shows the
// header holds the real client address.
//
// IPv6 (A6b). One home or phone network usually holds a whole /64, so a
// caller can rotate through billions of addresses without leaving it. The
// rate-limit bucket is the /64 (`clientIpBucket`); the audit row keeps the
// full address (`clientIpAddress`) so it still matches what the owner sees.
// An IPv4-mapped address (`::ffff:a.b.c.d`) is the IPv4 address in both.
//
// This started life inside src/lib/connect/employer-request.ts, where it was
// written carefully, shape-checked and length-capped, because the value
// becomes part of a `RateLimitEntry` primary key. The 2026-09-06 review found
// the seven auth and csp-report routes each hand-rolling the same header read
// WITHOUT either guard, which is exactly how an oversized header reached the
// store. One implementation, one set of guards, one place to fix them.
// =============================================================================

/** Longest textual IPv6 address, including the IPv4-mapped form. */
export const MAX_FORWARDED_IP_CHARS = 45;

/** Cloudflare's edge, then Render's proxy, append to `X-Forwarded-For` before the app sees it. */
export const DEFAULT_TRUSTED_PROXY_HOPS = 2;

/** More than this is a configuration mistake, not a real proxy chain. */
const MAX_TRUSTED_PROXY_HOPS = 10;

/** The shared bucket for every address that cannot be read. */
const UNKNOWN = "unknown";

/**
 * Deliberately a SHAPE test, not a parser. Hex, digits, dots and colons is
 * every character a v4 or v6 address can contain; anything else is not an
 * address and does not need to be told apart from anything else.
 */
const IP_SHAPED = /^[0-9a-fA-F.:]+$/u;

/** How the deployment's proxies hand over the client address. */
export interface ClientIpConfig {
  /** Proxies that append to `X-Forwarded-For`; the client is this many entries from the right. */
  trustedProxyHops: number;
  /** True only when every request reaches the service through Cloudflare. */
  cloudflareInFront: boolean;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

function parseTrustedProxyHops(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_TRUSTED_PROXY_HOPS;
  const hops = /^\d+$/u.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(hops) || hops < 1 || hops > MAX_TRUSTED_PROXY_HOPS) {
    throw new Error(`TRUSTED_PROXY_HOPS must be a whole number from 1 to ${MAX_TRUSTED_PROXY_HOPS}.`);
  }
  return hops;
}

function parseCloudflareInFront(raw: string | undefined): boolean {
  if (raw === undefined || raw === "" || raw === "false") return false;
  if (raw === "true") return true;
  throw new Error('CLOUDFLARE_IN_FRONT must be "true", "false" or unset.');
}

/**
 * The two settings, read from the environment. Throws on a value it cannot
 * read, so `validateRuntimeEnv` fails the boot rather than letting a typo
 * trust the wrong hop.
 */
export function clientIpConfigFrom(source: EnvSource): ClientIpConfig {
  return {
    trustedProxyHops: parseTrustedProxyHops(source.TRUSTED_PROXY_HOPS),
    cloudflareInFront: parseCloudflareInFront(source.CLOUDFLARE_IN_FRONT),
  };
}

/**
 * The value becomes part of a RateLimitEntry key, and the header is
 * attacker-influenced. Unbounded, a caller could mint a distinct bucket per
 * request, each one a row, and turn a rate limiter into a way to fill the
 * table. So anything that is not IP-shaped collapses to one shared bucket.
 *
 * THE TRADE, stated so nobody has to rediscover it: everything that lands in
 * `"unknown"` shares ONE bucket, so traffic with malformed headers can
 * exhaust it and make a limit refuse other requests that also landed there.
 * That is the direction to fail: refusing an unusual request is cheaper than
 * admitting every request. It also catches IPv6 zone ids ("fe80::1%eth0",
 * whose "%" is not in the shape test); a link-local address is not a public
 * client in this deployment, so that costs nothing real.
 */
function shapeChecked(candidate: string): string {
  return candidate.length > MAX_FORWARDED_IP_CHARS || !IP_SHAPED.test(candidate) ? UNKNOWN : candidate;
}

/**
 * The entry the last trusted proxy appended. A chain shorter than the trusted
 * count, or an empty entry at that place, cannot be the platform's own write,
 * so it goes to the shared bucket rather than to anything the caller chose.
 */
function appendedHop(forwarded: string, trustedProxyHops: number): string {
  const entries = forwarded.split(",").map((entry) => entry.trim());
  const hop = entries.length >= trustedProxyHops ? entries[entries.length - trustedProxyHops] : undefined;
  return hop ? shapeChecked(hop) : UNKNOWN;
}

/**
 * The client address from the request headers, or `null` when no proxy
 * header arrived. Pure, so the hop rule is tested without the environment.
 */
export function resolveClientIp(headers: Headers, config: ClientIpConfig): string | null {
  if (config.cloudflareInFront) {
    const connecting = headers.get("cf-connecting-ip")?.trim();
    if (connecting) return shapeChecked(connecting);
  }
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded?.trim()) return null;
  return appendedHop(forwarded, config.trustedProxyHops);
}

/** The four octets of a dotted IPv4 address as two 16-bit groups, or null. */
function ipv4Groups(dotted: string): number[] | null {
  const octets = dotted.split(".");
  if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255)) return null;
  const [a, b, c, d] = octets.map(Number);
  return [(a << 8) | b, (c << 8) | d];
}

/** One side of a `::`, as 16-bit groups, or null when a group is not 1 to 4 hex digits. */
function hexGroups(side: string): number[] | null {
  if (side === "") return [];
  const groups = side.split(":");
  return groups.every((group) => /^[0-9a-f]{1,4}$/u.test(group)) ? groups.map((group) => parseInt(group, 16)) : null;
}

/**
 * The hex part in front of an embedded IPv4 tail. `::ffff:1.2.3.4` keeps
 * `::ffff`; `::1.2.3.4` keeps its `::`, which the single colon cut would drop.
 */
function withoutIpv4Tail(lower: string, lastColon: number): string {
  return lower.slice(lastColon - 1, lastColon + 1) === "::" ? lower.slice(0, lastColon + 1) : lower.slice(0, lastColon);
}

/** The eight 16-bit groups of a textual IPv6 address, or null when it is not one. */
function ipv6Groups(text: string): number[] | null {
  const lower = text.toLowerCase();
  const lastColon = lower.lastIndexOf(":");
  const tail = lower.slice(lastColon + 1);
  const v4 = tail.includes(".") ? ipv4Groups(tail) : [];
  if (v4 === null) return null;
  const hexPart = tail.includes(".") ? withoutIpv4Tail(lower, lastColon) : lower;
  const halves = hexPart.split("::");
  if (halves.length > 2) return null;
  const head = hexGroups(halves[0]);
  const rest = halves.length === 2 ? hexGroups(halves[1]) : [];
  if (head === null || rest === null) return null;
  const known = head.length + rest.length + v4.length;
  if (halves.length === 2 ? known > 7 : known !== 8) return null;
  return [...head, ...new Array<number>(8 - known).fill(0), ...rest, ...v4];
}

/** `::ffff:a.b.c.d` in any spelling, as the dotted IPv4 address; otherwise null. */
function mappedIpv4(groups: readonly number[]): string | null {
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (!mapped) return null;
  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
}

/**
 * The rate-limit bucket for a resolved address: an IPv6 address counts by
 * its /64, an IPv4-mapped one as its IPv4 address, IPv4 and `"unknown"` as
 * they are. A colon value that is not an IPv6 address goes to the shared
 * unknown bucket, so it cannot mint buckets either.
 */
export function rateLimitBucketFor(address: string): string {
  // A value with no colon is IPv4 or the unknown bucket; anything else cannot mint its own bucket.
  if (!address.includes(":")) return address === UNKNOWN || ipv4Groups(address) !== null ? address : UNKNOWN;
  const groups = ipv6Groups(address);
  if (groups === null) return UNKNOWN;
  const v4 = mappedIpv4(groups);
  if (v4 !== null) return v4;
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

/** The address as the audit row keeps it: in full, with an IPv4-mapped address read as IPv4. */
function auditAddressFor(address: string): string {
  if (!address.includes(":")) return address;
  const groups = ipv6Groups(address);
  return (groups && mappedIpv4(groups)) ?? address;
}

/**
 * The client address under the deployment's settings, `null` when no proxy
 * header arrived, `"unknown"` when one arrived but could not be read.
 */
export function clientIpFrom(req: Request): string | null {
  return resolveClientIp(req.headers, clientIpConfigFrom(process.env));
}

/**
 * The rate-limit bucket: the client address, `"unknown"` when no header
 * arrived, and an IPv6 client's /64 rather than its full address.
 *
 * Use it in limiter keys only. An audit row takes `clientIpAddress`, which
 * keeps the full address. Connect's employer routes keep using `clientIpFrom`
 * directly: they pass the value on as `string | null` and distinguish the two
 * cases themselves.
 */
export function clientIpBucket(req: Request): string {
  return rateLimitBucketFor(clientIpFrom(req) ?? UNKNOWN);
}

/**
 * The client address for an audit row: in full, `"unknown"` when no header
 * arrived, an IPv4-mapped address as IPv4. Never a limiter key, because an
 * IPv6 caller could rotate it within its /64.
 */
export function clientIpAddress(req: Request): string {
  return auditAddressFor(clientIpFrom(req) ?? UNKNOWN);
}
