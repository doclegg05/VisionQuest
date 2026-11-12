/**
 * `clientIpFrom` contract.
 *
 * The helper was written for the Connect employer-token routes and lived in
 * src/lib/connect/employer-request.ts; the 2026-09-06 review found the seven
 * auth and csp-report routes each hand-rolling the same header read WITHOUT
 * its shape test or its length cap, which is what let an oversized
 * `X-Forwarded-For` reach the rate-limit store. It is shared code now, so its
 * behavior is pinned here rather than left implicit at one call site.
 *
 * Readiness A6 (2026-11-11): the helper took the FIRST forwarded hop, which
 * the caller writes, so one machine could claim a new address on every
 * request and never reach a per-network limit. It now takes the hop the
 * platform's proxy appended (the right-most one, or further left when more
 * trusted proxies are configured), or Cloudflare's `CF-Connecting-IP` when the
 * deployment says Cloudflare is in front.
 *
 * The behavior under test is deliberately coarse: this value gates a rate
 * limit bucket and nothing else. It is never authorization.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  clientIpAddress,
  clientIpBucket,
  clientIpConfigFrom,
  clientIpFrom,
  DEFAULT_TRUSTED_PROXY_HOPS,
  MAX_FORWARDED_IP_CHARS,
  rateLimitBucketFor,
  resolveClientIp,
  type ClientIpConfig,
} from "./client-ip";

const RENDER_ONLY: ClientIpConfig = { trustedProxyHops: 1, cloudflareInFront: false };
const BEHIND_CLOUDFLARE: ClientIpConfig = { trustedProxyHops: 1, cloudflareInFront: true };

function headersWith(values: Record<string, string | null>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function forwardedFor(value: string | null, config: ClientIpConfig = RENDER_ONLY): string | null {
  return resolveClientIp(headersWith({ "x-forwarded-for": value }), config);
}

function requestWithForwardedFor(value: string | null): Request {
  return new Request("https://visionquest.onrender.com/api/auth/login", {
    headers: headersWith({ "x-forwarded-for": value }),
  });
}

describe("resolveClientIp: the hop the platform appended", () => {
  it("returns the right-most hop, the one Render's proxy appends", () => {
    assert.equal(forwardedFor("203.0.113.7, 198.51.100.4"), "198.51.100.4");
    assert.equal(forwardedFor("198.51.100.4"), "198.51.100.4");
  });

  it("counts one address however the caller rotates a forged first hop", () => {
    const seen = new Set<string | null>();
    for (let i = 0; i < 50; i += 1) {
      seen.add(forwardedFor(`10.${i}.${i}.${i}, 172.16.0.${i}, 198.51.100.4`));
    }
    assert.deepEqual([...seen], ["198.51.100.4"]);
  });

  it("trims whitespace around the trusted hop", () => {
    assert.equal(forwardedFor("203.0.113.7 ,   198.51.100.4  "), "198.51.100.4");
  });

  it("reaches further left when more trusted proxies are configured", () => {
    const twoHops: ClientIpConfig = { trustedProxyHops: 2, cloudflareInFront: false };
    assert.equal(forwardedFor("6.6.6.6, 198.51.100.4, 10.0.0.1", twoHops), "198.51.100.4");
  });

  it("accepts IPv6, including the IPv4-mapped form", () => {
    assert.equal(forwardedFor("2001:db8::1"), "2001:db8::1");
    assert.equal(
      forwardedFor("0000:0000:0000:0000:0000:ffff:192.168.100.228"),
      "0000:0000:0000:0000:0000:ffff:192.168.100.228",
    );
  });

  it("returns null when no proxy header arrived", () => {
    assert.equal(forwardedFor(null), null);
    assert.equal(forwardedFor(""), null);
    assert.equal(forwardedFor("   "), null);
  });

  it("puts a chain shorter than the trusted proxy count in the shared unknown bucket", () => {
    const twoHops: ClientIpConfig = { trustedProxyHops: 2, cloudflareInFront: false };
    assert.equal(forwardedFor("198.51.100.4", twoHops), "unknown");
  });

  it("puts an empty trusted hop in the shared unknown bucket, never the caller's first hop", () => {
    assert.equal(forwardedFor("198.51.100.4,"), "unknown");
    assert.equal(forwardedFor("198.51.100.4, ,"), "unknown");
  });

  it("collapses a trusted hop that is not IP-shaped into the shared unknown bucket", () => {
    // The trade is documented at the implementation: everything malformed
    // shares ONE bucket, so a spoofer queues with every other spoofer instead
    // of minting a fresh bucket, and a fresh bucket is a fresh database row.
    assert.equal(forwardedFor("not an ip"), "unknown");
    assert.equal(forwardedFor("<script>"), "unknown");
    assert.equal(forwardedFor("fe80::1%eth0"), "unknown");
    assert.equal(forwardedFor("198.51.100.4, not-an-ip"), "unknown");
  });

  it("collapses an over-long trusted hop into the shared unknown bucket", () => {
    // This is the cap that keeps an attacker-chosen header out of the
    // rate-limit key. Longest real textual IPv6 address is 45 characters, so
    // nothing legitimate is truncated by it.
    assert.equal(forwardedFor("1".repeat(MAX_FORWARDED_IP_CHARS + 1)), "unknown");
    assert.equal(forwardedFor("a".repeat(4000)), "unknown");
  });

  it("accepts a value exactly at the cap", () => {
    const atCap = `${"1".repeat(MAX_FORWARDED_IP_CHARS - 1)}2`;
    assert.equal(atCap.length, MAX_FORWARDED_IP_CHARS);
    assert.equal(forwardedFor(atCap), atCap);
  });

  it("ignores CF-Connecting-IP while the deployment does not say Cloudflare is in front", () => {
    const headers = headersWith({ "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "198.51.100.4" });
    assert.equal(resolveClientIp(headers, RENDER_ONLY), "198.51.100.4");
  });

  it("never returns a value longer than the cap", () => {
    // The property the rate limiter depends on, stated once so a future
    // change to the shape test cannot quietly widen it.
    for (const config of [RENDER_ONLY, BEHIND_CLOUDFLARE]) {
      for (const candidate of ["203.0.113.7", "not an ip", "z".repeat(9000), "2001:db8::1", "1.1.1.1, z"]) {
        const headers = headersWith({ "x-forwarded-for": candidate, "cf-connecting-ip": candidate });
        const resolved = resolveClientIp(headers, config);
        assert.ok(
          resolved === null || resolved.length <= MAX_FORWARDED_IP_CHARS,
          `resolveClientIp must never hand back more than ${MAX_FORWARDED_IP_CHARS} characters`,
        );
      }
    }
  });
});

describe("resolveClientIp: Render's domain, behind Cloudflare (two trusted hops)", () => {
  const RENDER_VIA_CLOUDFLARE: ClientIpConfig = { trustedProxyHops: 2, cloudflareInFront: false };

  it("reads the client from the shape a published Render trace shows: client, then Cloudflare edge", () => {
    // https://rohitpaulk.com/articles/render-rails-remote-ip: the app sees
    // `X-Forwarded-For: <client>, <cloudflare edge>`.
    assert.equal(forwardedFor("198.51.100.4, 172.70.1.9", RENDER_VIA_CLOUDFLARE), "198.51.100.4");
  });

  it("counts one address however a forged prefix rotates", () => {
    const seen = new Set<string | null>();
    for (let i = 0; i < 50; i += 1) {
      seen.add(forwardedFor(`10.${i}.0.1, 203.0.113.${i}, 198.51.100.4, 172.70.1.9`, RENDER_VIA_CLOUDFLARE));
    }
    assert.deepEqual([...seen], ["198.51.100.4"]);
  });

  it("puts students behind different edges in their own buckets, not the edge's", () => {
    assert.notEqual(
      forwardedFor("198.51.100.4, 172.70.1.9", RENDER_VIA_CLOUDFLARE),
      forwardedFor("198.51.100.5, 172.70.1.9", RENDER_VIA_CLOUDFLARE),
    );
  });

  it("puts a one-entry chain in the shared unknown bucket, never that entry", () => {
    assert.equal(forwardedFor("198.51.100.4", RENDER_VIA_CLOUDFLARE), "unknown");
  });

  it("puts an empty second-from-right entry in the shared unknown bucket", () => {
    assert.equal(forwardedFor(", 172.70.1.9", RENDER_VIA_CLOUDFLARE), "unknown");
  });
});

describe("rateLimitBucketFor: one bucket per IPv6 /64, IPv4-mapped read as IPv4", () => {
  it("collapses addresses that differ only below the /64 into one bucket", () => {
    const seen = new Set<string>();
    for (const address of ["2001:db8:1:2::1", "2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:0DB8:0001:0002:abcd::9"]) {
      seen.add(rateLimitBucketFor(address));
    }
    assert.deepEqual([...seen], ["2001:db8:1:2::/64"]);
  });

  it("keeps different /64s apart", () => {
    assert.notEqual(rateLimitBucketFor("2001:db8:1:2::1"), rateLimitBucketFor("2001:db8:1:3::1"));
  });

  it("reads compressed forms at either end", () => {
    assert.equal(rateLimitBucketFor("::1"), "0:0:0:0::/64");
    assert.equal(rateLimitBucketFor("fe80::"), "fe80:0:0:0::/64");
  });

  it("reads an IPv4-mapped address as the IPv4 address", () => {
    assert.equal(rateLimitBucketFor("::ffff:198.51.100.4"), "198.51.100.4");
    assert.equal(rateLimitBucketFor("0000:0000:0000:0000:0000:ffff:192.168.100.228"), "192.168.100.228");
    assert.equal(rateLimitBucketFor("::ffff:c633:6404"), "198.51.100.4");
  });

  it("leaves an IPv4 address and the unknown bucket as they are", () => {
    assert.equal(rateLimitBucketFor("198.51.100.4"), "198.51.100.4");
    assert.equal(rateLimitBucketFor("unknown"), "unknown");
  });

  it("puts a value with no colon that is not an IPv4 address in the shared unknown bucket", () => {
    for (const bad of ["deadbeef", "1.2.3.4.5.6", "999.1.1.1", "1.2.3", "localhost"]) {
      assert.equal(rateLimitBucketFor(bad), "unknown", bad);
    }
  });

  it("puts a colon value that is not an IPv6 address in the shared unknown bucket", () => {
    for (const bad of ["1::2::3", "1:2:3:4:5:6:7:8:9", "12345::1", ":::", "1:2:3:4:5:6:7", "::ffff:300.1.1.1", "::ffff:1.2.3"]) {
      assert.equal(rateLimitBucketFor(bad), "unknown", bad);
    }
  });
});

describe("resolveClientIp: Cloudflare in front", () => {
  it("reads CF-Connecting-IP and ignores X-Forwarded-For", () => {
    const headers = headersWith({ "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6, 162.158.1.1" });
    assert.equal(resolveClientIp(headers, BEHIND_CLOUDFLARE), "198.51.100.4");
  });

  it("falls back to the appended X-Forwarded-For hop when Cloudflare sent no header", () => {
    const headers = headersWith({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" });
    assert.equal(resolveClientIp(headers, BEHIND_CLOUDFLARE), "198.51.100.4");
  });

  it("puts a malformed CF-Connecting-IP in the shared unknown bucket", () => {
    const headers = headersWith({ "cf-connecting-ip": "not an ip", "x-forwarded-for": "198.51.100.4" });
    assert.equal(resolveClientIp(headers, BEHIND_CLOUDFLARE), "unknown");
  });

  it("returns null when neither header arrived", () => {
    assert.equal(resolveClientIp(headersWith({}), BEHIND_CLOUDFLARE), null);
  });
});

describe("clientIpConfigFrom: the two deployment settings", () => {
  it("defaults to two trusted proxies (Cloudflare's edge, then Render's proxy) and the Cloudflare header off", () => {
    assert.deepEqual(clientIpConfigFrom({}), { trustedProxyHops: DEFAULT_TRUSTED_PROXY_HOPS, cloudflareInFront: false });
    assert.equal(DEFAULT_TRUSTED_PROXY_HOPS, 2);
  });

  it("reads both settings", () => {
    assert.deepEqual(clientIpConfigFrom({ TRUSTED_PROXY_HOPS: "2", CLOUDFLARE_IN_FRONT: "true" }), {
      trustedProxyHops: 2,
      cloudflareInFront: true,
    });
    assert.equal(clientIpConfigFrom({ CLOUDFLARE_IN_FRONT: "false" }).cloudflareInFront, false);
  });

  it("refuses a value it cannot read, so a typo fails the boot instead of trusting the wrong hop", () => {
    for (const bad of ["0", "-1", "1.5", "abc", "11"]) {
      assert.throws(() => clientIpConfigFrom({ TRUSTED_PROXY_HOPS: bad }), /TRUSTED_PROXY_HOPS/);
    }
    for (const bad of ["yes", "TRUE", "1", "on"]) {
      assert.throws(() => clientIpConfigFrom({ CLOUDFLARE_IN_FRONT: bad }), /CLOUDFLARE_IN_FRONT/);
    }
  });
});

describe("clientIpFrom and clientIpBucket read the deployment settings", () => {
  const saved = { hops: process.env.TRUSTED_PROXY_HOPS, cf: process.env.CLOUDFLARE_IN_FRONT };

  afterEach(() => {
    if (saved.hops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = saved.hops;
    if (saved.cf === undefined) delete process.env.CLOUDFLARE_IN_FRONT;
    else process.env.CLOUDFLARE_IN_FRONT = saved.cf;
  });

  it("takes the client Cloudflare forwarded, not the edge, with the settings unset", () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    delete process.env.CLOUDFLARE_IN_FRONT;
    assert.equal(clientIpFrom(requestWithForwardedFor("6.6.6.6, 198.51.100.4, 172.68.10.20")), "198.51.100.4");
  });

  it("buckets an IPv6 client by its /64 but keeps the full address for the audit row", () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    delete process.env.CLOUDFLARE_IN_FRONT;
    const req = requestWithForwardedFor("2001:db8:1:2:aaaa::7, 2400:cb00::1");
    assert.equal(clientIpBucket(req), "2001:db8:1:2::/64");
    assert.equal(clientIpAddress(req), "2001:db8:1:2:aaaa::7");
  });

  it("puts a request with no proxy header in the shared unknown bucket and audit value", () => {
    assert.equal(clientIpAddress(requestWithForwardedFor(null)), "unknown");
  });

  it("follows CLOUDFLARE_IN_FRONT", () => {
    process.env.CLOUDFLARE_IN_FRONT = "true";
    const req = new Request("https://visionquest.onrender.com/api/auth/login", {
      headers: headersWith({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "6.6.6.6" }),
    });
    assert.equal(clientIpFrom(req), "198.51.100.9");
  });

  it("puts a request with no proxy header in the one shared unknown bucket", () => {
    assert.equal(clientIpFrom(requestWithForwardedFor(null)), null);
    assert.equal(clientIpBucket(requestWithForwardedFor(null)), "unknown");
  });
});

describe("connect/employer-request re-export", () => {
  it("still exports clientIpFrom from its original module", async () => {
    // The Connect employer routes import it from there; moving the source of
    // truth must not break them.
    const legacy = await import("./connect/employer-request");
    assert.equal(legacy.clientIpFrom, clientIpFrom);
  });
});
