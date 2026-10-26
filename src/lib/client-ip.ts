// =============================================================================
// The client's IP, for rate-limit buckets and nothing else.
//
// Behind Render's proxy the socket address is the proxy's, so `X-Forwarded-For`
// is the only signal available. It is spoofable, which is why it gates coarse
// buckets and never authorization.
//
// This started life inside src/lib/connect/employer-request.ts, where it was
// written carefully — shape-checked and length-capped — because the value
// becomes part of a `RateLimitEntry` primary key. The 2026-09-06 review found
// the seven auth and csp-report routes each hand-rolling the same header read
// WITHOUT either guard, which is exactly how an oversized header reached the
// store. One implementation, one set of guards, one place to fix them.
// =============================================================================

/** Longest textual IPv6 address, including the IPv4-mapped form. */
export const MAX_FORWARDED_IP_CHARS = 45;

/**
 * Deliberately a SHAPE test, not a parser. Hex, digits, dots and colons is
 * every character a v4 or v6 address can contain; anything else is not an
 * address and does not need to be told apart from anything else.
 */
const IP_SHAPED = /^[0-9a-fA-F.:]+$/u;

/**
 * The first forwarded hop, or `null` when the header carries nothing.
 *
 * Anything that is not IP-shaped, or is longer than a real address can be,
 * collapses to one shared `"unknown"` bucket.
 */
export function clientIpFrom(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (!first) return null;

  // The value becomes part of a RateLimitEntry key, and the header is
  // attacker-controlled. Unbounded, a caller could mint a distinct bucket per
  // request — each one a row — and turn a rate limiter into a way to fill the
  // table. So anything that is not IP-shaped collapses to one shared bucket:
  // a spoofer gets to share a queue with every other spoofer, which is the
  // correct outcome for a signal that gates nothing but this.
  //
  // 45 is the longest possible textual IPv6 address
  // (an IPv4-mapped form: 45 characters), so no real client is truncated.
  //
  // THE TRADE, stated so nobody has to rediscover it: everything that lands in
  // `"unknown"` shares ONE bucket, so a single spoofer sending malformed
  // headers can exhaust it and make a limit refuse legitimate traffic that
  // also landed there. That is the direction to fail — refusing an unusual
  // request is cheaper than admitting every request, which is what the
  // unbounded key did. It also catches IPv6 zone ids ("fe80::1%eth0", whose
  // "%" is not in the shape test), which collapse to the shared bucket rather
  // than getting one each; a link-local address is not a public client in this
  // deployment, so that costs nothing real.
  if (first.length > MAX_FORWARDED_IP_CHARS || !IP_SHAPED.test(first)) return "unknown";
  return first;
}

/**
 * The same value, already collapsed to `"unknown"` when the header is absent.
 *
 * The auth and csp-report routes all built `?? "unknown"` by hand, and each of
 * them then used the string twice — once in a limiter key and once in an audit
 * or log field — so the fallback belongs here rather than at seven call sites.
 * Connect's employer routes keep using `clientIpFrom` directly: they pass the
 * value on as `string | null` and distinguish the two cases themselves.
 */
export function clientIpBucket(req: Request): string {
  return clientIpFrom(req) ?? "unknown";
}
