import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { config as proxyConfig, crawlerHeadersFor, proxy, PROXY_MATCHER } from "./proxy";

// FERPA review W7 (2026-09-06): the two public pages that render one
// student's data behind an opaque identifier — /credentials/[slug] and
// /connect/[token] — carried no `noindex`, and the repo has no robots.txt.
// The page-level `robots` metadata covers HTML; this header covers every
// response under those prefixes, including the PDF the employer page links.

describe("crawlerHeadersFor", () => {
  it("marks /credentials/* noindex, nofollow", () => {
    assert.deepEqual(crawlerHeadersFor("/credentials/tanesha-rivers"), {
      "X-Robots-Tag": "noindex, nofollow",
    });
  });

  it("marks /connect/* noindex, nofollow", () => {
    assert.deepEqual(crawlerHeadersFor("/connect/hQ7nZ2xK9vB4mL0pR6sT8wY1cD3fG5jN7qA2eU4iO6k"), {
      "X-Robots-Tag": "noindex, nofollow",
    });
  });

  it("covers the bare prefix too", () => {
    assert.deepEqual(crawlerHeadersFor("/connect"), { "X-Robots-Tag": "noindex, nofollow" });
    assert.deepEqual(crawlerHeadersFor("/credentials"), { "X-Robots-Tag": "noindex, nofollow" });
  });

  it("leaves the staff console and everything else alone", () => {
    for (const pathname of ["/teacher/connect", "/teacher/connect/report", "/", "/dashboard", "/connections", "/api/health"]) {
      assert.deepEqual(crawlerHeadersFor(pathname), {}, pathname);
    }
  });
});

// ---------------------------------------------------------------------------
// Matcher coverage — 2026-09-06 hunt, follow-up (3)
//
// The matcher excluded `.*\.(svg|png|jpg|jpeg|gif|webp|ico)$` from the proxy
// entirely. A path ending in one of those extensions therefore got NO CSRF
// Origin check and NO `x-vq-*` stripping, because the proxy never ran for it.
// Nothing routes there today, so this is latent — but the moment a catch-all
// or a dynamic segment can end in `.png`, `POST /api/anything.png` is an
// unprotected write and `x-vq-role: admin` reaches the handler as if the
// proxy had derived it from a session JWT.
// ---------------------------------------------------------------------------

/** The matcher pattern is already valid regex; anchor it the way Next does. */
const matcherRe = new RegExp(`^${PROXY_MATCHER}$`);

describe("proxy config.matcher", () => {
  it("is the literal PROXY_MATCHER string (Next requires a static literal in config)", () => {
    // Next.js parses `config` at build time and rejects an identifier there,
    // so the literal is duplicated on purpose; this pins the two together.
    assert.deepEqual(proxyConfig.matcher, [PROXY_MATCHER]);
  });
});

describe("proxy matcher", () => {
  it("covers paths that end in an image extension", () => {
    for (const pathname of [
      "/api/anything.png",
      "/api/chat/upload.jpg",
      "/whatever.svg",
      "/some/route.ico",
      "/a.webp",
    ]) {
      assert.ok(matcherRe.test(pathname), `${pathname} must reach the proxy`);
    }
  });

  it("still skips the Next internals and the root favicon", () => {
    for (const pathname of ["/_next/static/chunks/main.js", "/_next/static/media/logo.png", "/_next/image", "/favicon.ico"]) {
      assert.equal(matcherRe.test(pathname), false, `${pathname} must not reach the proxy`);
    }
  });

  it("covers ordinary pages and API routes as before", () => {
    for (const pathname of ["/", "/dashboard", "/api/chat/send", "/credentials/tanesha-rivers"]) {
      assert.ok(matcherRe.test(pathname), pathname);
    }
  });
});

describe("proxy — image-extension paths are not exempt", () => {
  it("refuses a state-changing API request with a foreign Origin even when the path ends in .png", () => {
    const req = new NextRequest("http://localhost:3000/api/anything.png", {
      method: "POST",
      headers: { origin: "https://evil.example", host: "localhost:3000" },
    });

    const res = proxy(req);

    assert.equal(res.status, 403, "the CSRF check must apply to every state-changing /api/* path");
  });

  it("admits the same request from our own origin", () => {
    const req = new NextRequest("http://localhost:3000/api/anything.png", {
      method: "POST",
      headers: { origin: "http://localhost:3000", host: "localhost:3000" },
    });

    assert.notEqual(proxy(req).status, 403);
  });

  it("strips a client-supplied x-vq-* header on a GET to an image-extension path", () => {
    const req = new NextRequest("http://localhost:3000/whatever.svg", {
      method: "GET",
      headers: { "x-vq-user-id": "spoofed", "x-vq-role": "admin", "x-vq-student-id": "spoofed" },
    });

    const res = proxy(req);

    // NextResponse.next({ request: { headers } }) forwards the rewritten
    // request headers on `x-middleware-request-*`, and names the ones the
    // proxy set on `x-middleware-override-headers`. A header the proxy
    // deleted appears in neither, so the handler sees nothing.
    const overrides = (res.headers.get("x-middleware-override-headers") ?? "").split(",");
    for (const name of ["x-vq-user-id", "x-vq-role", "x-vq-student-id"]) {
      assert.equal(res.headers.get(`x-middleware-request-${name}`), null, `${name} must not be forwarded`);
      assert.equal(overrides.includes(name), false, `${name} must not survive the strip`);
    }
  });
});

// ---------------------------------------------------------------------------
// Response security headers — 2026-09-06 hunt, follow-up (5), half-stale
//
// The hunt asked for Referrer-Policy and X-Content-Type-Options on public
// pages. next.config.ts already applies both (plus HSTS and X-Frame-Options)
// to `/(.*)`, and proxy.ts deliberately does not duplicate them. Nothing
// pinned that, so a cleanup of next.config.ts could drop either silently and
// no test would notice. This is the pin.
// ---------------------------------------------------------------------------

describe("next.config.ts security headers", () => {
  it("applies X-Content-Type-Options and Referrer-Policy to every path", async () => {
    const nextConfig = (await import("../next.config")).default;
    assert.ok(typeof nextConfig.headers === "function", "next.config must declare headers()");
    const rules = await nextConfig.headers!();

    const rule = rules.find((r) => r.source === "/(.*)");
    assert.ok(rule, `expected a rule covering every path; saw ${rules.map((r) => r.source).join(", ")}`);

    const headers = new Map(rule.headers.map((h) => [h.key, h.value]));
    assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  });
});
