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
 * The behavior under test is deliberately coarse: this value gates a rate
 * limit bucket and nothing else. It is never authorization.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientIpFrom, MAX_FORWARDED_IP_CHARS } from "./client-ip";

function requestWithForwardedFor(value: string | null): Request {
  const headers = new Headers();
  if (value !== null) headers.set("x-forwarded-for", value);
  return new Request("https://visionquest.onrender.com/api/auth/login", { headers });
}

describe("clientIpFrom", () => {
  it("returns the first forwarded hop", () => {
    assert.equal(clientIpFrom(requestWithForwardedFor("203.0.113.7, 10.0.0.1")), "203.0.113.7");
  });

  it("trims surrounding whitespace on the first hop", () => {
    assert.equal(clientIpFrom(requestWithForwardedFor("  203.0.113.7 , 10.0.0.1")), "203.0.113.7");
  });

  it("accepts IPv6, including the IPv4-mapped form", () => {
    assert.equal(clientIpFrom(requestWithForwardedFor("2001:db8::1")), "2001:db8::1");
    assert.equal(
      clientIpFrom(requestWithForwardedFor("0000:0000:0000:0000:0000:ffff:192.168.100.228")),
      "0000:0000:0000:0000:0000:ffff:192.168.100.228",
    );
  });

  it("returns null when the header is absent or empty", () => {
    assert.equal(clientIpFrom(requestWithForwardedFor(null)), null);
    assert.equal(clientIpFrom(requestWithForwardedFor("")), null);
    assert.equal(clientIpFrom(requestWithForwardedFor("   ,  10.0.0.1")), null);
  });

  it("collapses a value that is not IP-shaped into the shared unknown bucket", () => {
    // The trade is documented at the implementation: everything malformed
    // shares ONE bucket, so a spoofer queues with every other spoofer instead
    // of minting a fresh bucket — and a fresh bucket is a fresh database row.
    assert.equal(clientIpFrom(requestWithForwardedFor("not an ip")), "unknown");
    assert.equal(clientIpFrom(requestWithForwardedFor("<script>")), "unknown");
    assert.equal(clientIpFrom(requestWithForwardedFor("fe80::1%eth0")), "unknown");
  });

  it("collapses an over-long value into the shared unknown bucket", () => {
    // This is the cap that keeps an attacker-chosen header out of the
    // rate-limit key. Longest real textual IPv6 address is 45 characters, so
    // nothing legitimate is truncated by it.
    const tooLong = "1".repeat(MAX_FORWARDED_IP_CHARS + 1);
    assert.equal(clientIpFrom(requestWithForwardedFor(tooLong)), "unknown");

    const wayTooLong = "a".repeat(4000);
    assert.equal(clientIpFrom(requestWithForwardedFor(wayTooLong)), "unknown");
  });

  it("accepts a value exactly at the cap", () => {
    const atCap = `${"1".repeat(MAX_FORWARDED_IP_CHARS - 1)}2`;
    assert.equal(atCap.length, MAX_FORWARDED_IP_CHARS);
    assert.equal(clientIpFrom(requestWithForwardedFor(atCap)), atCap);
  });

  it("never returns a value longer than the cap", () => {
    // The property the rate limiter depends on, stated once so a future
    // change to the shape test cannot quietly widen it.
    for (const candidate of ["203.0.113.7", "not an ip", "z".repeat(9000), "2001:db8::1"]) {
      const resolved = clientIpFrom(requestWithForwardedFor(candidate));
      assert.ok(
        resolved === null || resolved.length <= MAX_FORWARDED_IP_CHARS,
        `clientIpFrom must never hand back more than ${MAX_FORWARDED_IP_CHARS} characters`,
      );
    }
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
