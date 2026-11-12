// =============================================================================
// The client's IP, for rate-limit buckets and audit rows, and nothing else.
//
// Behind Render's proxy the socket address is the proxy's, so a proxy header
// is the only signal available. This value gates coarse buckets and never
// authorization.
//
// WHICH HOP (readiness A6, 2026-11-11). `X-Forwarded-For` is a list the
// caller starts and every proxy appends to. The FIRST entry is whatever the
// caller wrote, so reading it let one machine claim a new address on every
// request and never reach a per-network limit. The entries a trusted proxy
// appended are on the RIGHT: Render's proxy appends the address it saw, so
// with one trusted proxy (the default) the right-most entry is the client as
// Render saw it. `TRUSTED_PROXY_HOPS` says how many proxies the deployment
// trusts; the client is that many entries from the right.
//
// Cloudflare in front of the service sets `CF-Connecting-IP` to the visitor's
// address, and Render then sees a Cloudflare edge address, so every visitor
// would share a few buckets. `CLOUDFLARE_IN_FRONT=true` reads that header
// instead. It is off by default because without Cloudflare a caller can send
// the header itself; turn it on only when every request comes through
// Cloudflare.
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

/** One proxy, Render's, appends to `X-Forwarded-For` before the app sees it. */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;

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

/**
 * The client address under the deployment's settings, `null` when no proxy
 * header arrived, `"unknown"` when one arrived but could not be read.
 */
export function clientIpFrom(req: Request): string | null {
  return resolveClientIp(req.headers, clientIpConfigFrom(process.env));
}

/**
 * The same value, already collapsed to `"unknown"` when no header arrived.
 *
 * The auth and csp-report routes all built `?? "unknown"` by hand, and each of
 * them then used the string twice, once in a limiter key and once in an audit
 * or log field, so the fallback belongs here rather than at seven call sites.
 * Connect's employer routes keep using `clientIpFrom` directly: they pass the
 * value on as `string | null` and distinguish the two cases themselves.
 */
export function clientIpBucket(req: Request): string {
  return clientIpFrom(req) ?? UNKNOWN;
}
