// Match Next's server bootstrap before importing its matcher test helper.
import "next/dist/server/node-environment-baseline";
import { unstable_doesMiddlewareMatch as unstable_doesProxyMatch } from "next/experimental/testing/server";
import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { config as proxyConfig, crawlerHeadersFor, proxy, PROXY_MATCHER } from "./proxy";
import { DEMO_READ_ONLY_REFUSAL } from "@/lib/demo/copy";
import {
  ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED,
  PASSWORD_CHANGE_REQUIRED_MESSAGE,
  PUBLIC_FILES,
} from "@/lib/password-change-gate";
import { signToken } from "@/lib/session-token";

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

const perimeter = { proxy, config: proxyConfig };

function request(path: string, headers: Record<string, string> = {}, method = "POST") {
  return new NextRequest(`https://vq.example${path}`, {
    method,
    headers: { host: "vq.example", ...headers },
  });
}

test("dynamic file-looking paths cannot bypass the proxy", () => {
  for (const url of ["/api/files/hostile.png", "/api/files/hostile.svg", "/teacher/hostile.jpg", "/api/favicon.ico", "/faviconXico", "/_next/image-suffix"]) {
    assert.equal(unstable_doesProxyMatch({ config: perimeter.config, nextConfig: {}, url }), true, url);
  }
  for (const url of ["/_next/static/chunks/main.js", "/_next/image", "/favicon.ico"]) {
    assert.equal(unstable_doesProxyMatch({ config: perimeter.config, nextConfig: {}, url }), false, url);
  }
});

test("cross-origin API writes with image suffixes are rejected", () => {
  assert.equal(perimeter.proxy(request("/api/files/hostile.png", { origin: "https://evil.example" })).status, 403);
});

test("Origin cannot be overridden by a same-host Referer", () => {
  for (const origin of ["https://evil.example", "null", ""]) {
    assert.equal(perimeter.proxy(request("/api/files", { origin, referer: "https://vq.example/files" })).status, 403);
  }
});

test("same-host Origin and absent-Origin Referer fallback remain supported", () => {
  const cases: Record<string, string>[] = [{ origin: "https://vq.example" }, { referer: "https://vq.example/files" }];
  for (const headers of cases) {
    assert.equal(perimeter.proxy(request("/api/files", headers)).status, 200);
  }
  assert.equal(perimeter.proxy(request("/api/files")).status, 403);
});

test("anonymous API reads strip forged RLS headers, even for image-looking parameters", () => {
  const response = perimeter.proxy(request("/api/files/hostile.png", {
    "x-vq-user-id": "victim",
    "x-vq-role": "admin",
    "x-vq-student-id": "victim",
  }, "GET"));
  for (const name of ["x-vq-user-id", "x-vq-role", "x-vq-student-id"]) {
    assert.equal(response.headers.get(`x-middleware-request-${name}`), null);
    assert.ok(!response.headers.get("x-middleware-override-headers")?.split(",").includes(name));
  }
  assert.equal(response.headers.get("X-API-Version"), "1");
  assert.match(response.headers.get("Content-Security-Policy") ?? "", /nonce-/);
});

test("signed SMS webhook keeps its exact-path Origin exemption", () => {
  assert.equal(proxy(request("/api/sms/inbound")).status, 200);
  for (const path of ["/api/sms/inbound/extra", "/api/sms/inbound.png", "/api/sms/other"]) {
    assert.equal(proxy(request(path)).status, 403, path);
  }
});

// pg_cron sends no Origin, so the bearer is the only way an internal POST
// passes the CSRF check. Near-miss secrets of every length stay out.
test("the cron bearer lets an origin-less internal POST through, and nothing close to it does", () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "proxy-test-secret";
  try {
    assert.equal(proxy(request("/api/internal/jobs/process", { authorization: "Bearer proxy-test-secret" })).status, 200);
    for (const authorization of ["Bearer wrong", "Bearer proxy-test-secre", "Bearer proxy-test-secretX", ""]) {
      const headers: Record<string, string> = authorization ? { authorization } : {};
      assert.equal(proxy(request("/api/internal/jobs/process", headers)).status, 403, authorization);
    }
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("file-looking gated pages still redirect unauthenticated requests", () => {
  const response = perimeter.proxy(request("/teacher/hostile.jpg", {}, "GET"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://vq.example/");
});

// ---------------------------------------------------------------------------
// Cohort demo sessions
//
// A demo session is an ordinary signed token with a `demo` claim. Two rules
// live here because this is the one layer that sees every request without a
// database lookup: a session whose demo claim outlives the switch is treated
// as no session at all, and the shared demo instructor may only do what
// src/lib/demo/instructor-policy.ts lists. Both are fail-closed.
// ---------------------------------------------------------------------------

const DEMO_TEST_JWT_SECRET = "test-secret-for-proxy-demo-session-fence";
const SAME_ORIGIN = { origin: "https://vq.example" };

/** Runs `run` with a signing secret and the demo switch set the way the test needs. */
async function withDemoSwitch<T>(mode: "on" | "off", run: () => T | Promise<T>): Promise<T> {
  const previousSecret = process.env.JWT_SECRET;
  const previousMode = process.env.COHORT_DEMO_MODE;
  process.env.JWT_SECRET = DEMO_TEST_JWT_SECRET;
  if (mode === "on") process.env.COHORT_DEMO_MODE = "true";
  else delete process.env.COHORT_DEMO_MODE;
  try {
    return await run();
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousMode === undefined) delete process.env.COHORT_DEMO_MODE;
    else process.env.COHORT_DEMO_MODE = previousMode;
  }
}

function sessionCookie(token: string): Record<string, string> {
  return { cookie: `vq-session=${token}` };
}

function demoInstructorCookie(): Record<string, string> {
  return sessionCookie(signToken("demo-instructor-id", "teacher", 1, { demo: "instructor" }));
}

function forwardedHeader(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("proxy, the demo instructor fence", () => {
  it("refuses a demo instructor write outside the allowlist", () =>
    withDemoSwitch("on", async () => {
      const res = proxy(request("/api/teacher/sage-snippets", { ...SAME_ORIGIN, ...demoInstructorCookie() }));
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: DEMO_READ_ONLY_REFUSAL });
    }));

  it("passes an allowlisted demo instructor write and still sets the RLS headers", () =>
    withDemoSwitch("on", () => {
      const res = proxy(request("/api/teacher/students/abc/notes", { ...SAME_ORIGIN, ...demoInstructorCookie() }));
      assert.equal(res.status, 200);
      assert.equal(forwardedHeader(res, "x-vq-user-id"), "demo-instructor-id");
      assert.equal(forwardedHeader(res, "x-vq-role"), "teacher");
    }));

  it("refuses a demo instructor read of a cross-class report, and passes a program-wide read", () =>
    withDemoSwitch("on", async () => {
      const refused = proxy(request("/api/teacher/reports/grant-kpi", { ...demoInstructorCookie() }, "GET"));
      assert.equal(refused.status, 403);
      assert.deepEqual(await refused.json(), { error: DEMO_READ_ONLY_REFUSAL });

      const passed = proxy(request("/api/teacher/sage-snippets", { ...demoInstructorCookie() }, "GET"));
      assert.equal(passed.status, 200);
    }));

  it("passes a real teacher's program-wide write", () =>
    withDemoSwitch("on", () => {
      const cookie = sessionCookie(signToken("teacher-1", "teacher", 1));
      const res = proxy(request("/api/teacher/sage-snippets", { ...SAME_ORIGIN, ...cookie }));
      assert.equal(res.status, 200);
      assert.equal(forwardedHeader(res, "x-vq-user-id"), "teacher-1");
    }));

  it("leaves a demo student to the routes' own checks", () =>
    withDemoSwitch("on", () => {
      const cookie = sessionCookie(signToken("demo-student-id", "student", 1, { demo: "student" }));
      const res = proxy(request("/api/goals", { ...SAME_ORIGIN, ...cookie }));
      assert.equal(res.status, 200);
      assert.equal(forwardedHeader(res, "x-vq-role"), "student");
      assert.equal(forwardedHeader(res, "x-vq-student-id"), "demo-student-id");
    }));

  it("answers a cross-site write from a demo instructor with the origin refusal, not the demo one", () =>
    withDemoSwitch("on", async () => {
      const res = proxy(request("/api/teacher/sage-snippets", { origin: "https://evil.example", ...demoInstructorCookie() }));
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: "Forbidden: origin mismatch." });
    }));
});

describe("proxy, a demo session when the switch is off", () => {
  it("treats the session as signed out on a gated page", () =>
    withDemoSwitch("off", () => {
      for (const cookie of [
        demoInstructorCookie(),
        sessionCookie(signToken("demo-student-id", "student", 1, { demo: "student" })),
      ]) {
        const res = proxy(request("/teacher", cookie, "GET"));
        assert.equal(res.status, 307);
        assert.equal(res.headers.get("location"), "https://vq.example/");
      }
    }));

  it("sets no RLS headers on an API request", () =>
    withDemoSwitch("off", () => {
      const res = proxy(request("/api/teacher/students", demoInstructorCookie(), "GET"));
      for (const name of ["x-vq-user-id", "x-vq-role", "x-vq-student-id"]) {
        assert.equal(forwardedHeader(res, name), null, `${name} must not be forwarded`);
        assert.ok(!res.headers.get("x-middleware-override-headers")?.split(",").includes(name), name);
      }
    }));

  it("lets the same session through when the switch is on", () =>
    withDemoSwitch("on", () => {
      const res = proxy(request("/teacher", demoInstructorCookie(), "GET"));
      assert.equal(res.status, 200);
    }));

  it("does not touch a real teacher's session", () =>
    withDemoSwitch("off", () => {
      const cookie = sessionCookie(signToken("teacher-1", "teacher", 1));
      const res = proxy(request("/teacher", cookie, "GET"));
      assert.equal(res.status, 200);
      const api = proxy(request("/api/teacher/students", cookie, "GET"));
      assert.equal(forwardedHeader(api, "x-vq-user-id"), "teacher-1");
    }));
});

// Anti-goal 9: a page on another site must not be able to start a demo
// session by posting to the demo endpoints. The proxy's Origin check already
// covers any /api/ POST, so this passes before the demo routes exist; it is
// here so the day they land, the guarantee is pinned to them by name.
test("a cross-site POST to the demo endpoints is refused", () =>
  withDemoSwitch("on", () => {
    for (const path of ["/api/demo/student", "/api/demo/instructor"]) {
      assert.equal(proxy(request(path, { origin: "https://evil.example" })).status, 403, path);
    }
  }));

// H1 privacy follow-up, item 12 (2026-11-10). The policy allowed
// `https://*.ingest.sentry.io`. A current DSN names a host like
// `o123.ingest.us.sentry.io`, and a CSP wildcard covers one label, so the
// browser would have refused every report. The policy now allows the exact
// origin the DSN names, and nothing when there is no DSN.
describe("proxy, connect-src and the browser's error reports", () => {
  function connectSrc(dsn: string | undefined): string {
    const before = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
    try {
      const policy = proxy(request("/", {}, "GET")).headers.get("Content-Security-Policy") ?? "";
      return policy.split("; ").find((directive) => directive.startsWith("connect-src ")) ?? "";
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
      else process.env.NEXT_PUBLIC_SENTRY_DSN = before;
    }
  }

  const BASE = "connect-src 'self' https://generativelanguage.googleapis.com";

  it("allows the exact ingest origin of a current regional DSN", () => {
    assert.equal(connectSrc("https://publickey@o123.ingest.us.sentry.io/456"), `${BASE} https://o123.ingest.us.sentry.io`);
  });

  it("allows the exact ingest origin of an older DSN", () => {
    assert.equal(connectSrc("https://publickey@o123.ingest.sentry.io/456"), `${BASE} https://o123.ingest.sentry.io`);
  });

  it("adds nothing when no DSN is set", () => {
    assert.equal(connectSrc(undefined), BASE);
    assert.equal(connectSrc(""), BASE);
  });

  it("adds nothing for a DSN that is not an https URL", () => {
    assert.equal(connectSrc("not a dsn"), BASE);
    assert.equal(connectSrc("http://publickey@o123.ingest.us.sentry.io/456"), BASE);
  });

  it("never puts the DSN's key or a wildcard in the policy", () => {
    const directive = connectSrc("https://publickey@o123.ingest.us.sentry.io/456");
    assert.ok(!directive.includes("publickey"));
    assert.ok(!directive.includes("*"));
  });

  // H1 third pass, item 3 (2026-11-10). `new URL` accepts `*`, `,`, `;` and
  // `'` in a host name, and the origin went into the policy as it was parsed.
  // A mistyped or tampered DSN could widen `connect-src` to every https host,
  // or end the directive and start another.
  const HOSTILE_DSNS: readonly [what: string, dsn: string][] = [
    ["a wildcard, which would allow every https host", "https://k@*/1"],
    ["a semicolon, which would end connect-src and start script-src", "https://k@a.com;script-src/1"],
    ["a comma, which would start a second policy", "https://k@a.com,evil.example/1"],
    ["a quote, which is how a CSP keyword is written", "https://k@'unsafe-inline'/1"],
  ];
  for (const [what, dsn] of HOSTILE_DSNS) {
    it(`adds nothing for a DSN whose host holds ${what}`, () => {
      assert.equal(connectSrc(dsn), BASE);
    });
  }

  it("adds nothing for a wildcard subdomain, a host with one label, an IPv6 host or a trailing dot", () => {
    for (const dsn of ["https://k@*.ingest.sentry.io/1", "https://k@localhost/1", "https://k@[::1]/1", "https://k@o123.ingest.us.sentry.io./456"]) {
      assert.equal(connectSrc(dsn), BASE, dsn);
    }
  });

  it("adds nothing for a data: URL", () => {
    assert.equal(connectSrc("data:text/plain,https://o123.ingest.us.sentry.io"), BASE);
  });

  it("keeps a numeric port, and writes the host in lower case", () => {
    assert.equal(connectSrc("https://publickey@O123.Ingest.US.sentry.io:8443/456"), `${BASE} https://o123.ingest.us.sentry.io:8443`);
  });

  it("whatever the DSN, the directive holds only its own two sources and at most one https origin", () => {
    const dsns = [...HOSTILE_DSNS.map(([, dsn]) => dsn), "https://publickey@o123.ingest.us.sentry.io/456", "https://k@a.com;script-src%20*/1", "not a dsn"];
    for (const dsn of dsns) {
      assert.match(connectSrc(dsn), /^connect-src 'self' https:\/\/generativelanguage\.googleapis\.com(?: https:\/\/[a-z0-9.-]+(?::\d+)?)?$/, dsn);
    }
  });
});

// ---------------------------------------------------------------------------
// The forced password change
//
// Staff set a student's first password and every reset, so until the student
// picks a new one a staff member knows it. A session for such an account
// carries a signed `mustChangePassword` claim, and this is the one layer that
// sees every request: pages are sent to the change screen and API routes
// answer 403, apart from the short list in src/lib/password-change-gate.ts.
// A layout redirect would not do; it never runs for an API route.
// ---------------------------------------------------------------------------

function heldStudentCookie(): Record<string, string> {
  return sessionCookie(signToken("held-student", "student", 3, { mustChangePassword: true }));
}

describe("proxy, a session that must change its password", () => {
  it("sends a page to the change screen", () =>
    withDemoSwitch("off", () => {
      for (const path of ["/dashboard", "/settings", "/chat", "/recovery-setup", "/teacher", "/credentials/someone", "/goals/abc.png"]) {
        const res = proxy(request(path, heldStudentCookie(), "GET"));
        assert.equal(res.status, 307, path);
        assert.equal(res.headers.get("location"), "https://vq.example/change-password", path);
      }
    }));

  it("answers a form post to a page with a redirect the browser follows as a GET", () =>
    withDemoSwitch("off", () => {
      const res = proxy(request("/dashboard", { ...SAME_ORIGIN, ...heldStudentCookie() }, "POST"));
      assert.equal(res.status, 303);
      assert.equal(res.headers.get("location"), "https://vq.example/change-password");
    }));

  it("refuses an API read with 403 and the PASSWORD_CHANGE_REQUIRED code", () =>
    withDemoSwitch("off", async () => {
      for (const path of ["/api/goals", "/api/chat/history", "/api/notifications/stream", "/api/files/abc.png", "/api/settings/security-questions"]) {
        const res = proxy(request(path, heldStudentCookie(), "GET"));
        assert.equal(res.status, 403, path);
        assert.deepEqual(await res.json(), { error: PASSWORD_CHANGE_REQUIRED_MESSAGE, code: "PASSWORD_CHANGE_REQUIRED" }, path);
      }
    }));

  it("refuses an API write with the same answer", () =>
    withDemoSwitch("off", async () => {
      for (const [path, method] of [
        ["/api/chat/send", "POST"],
        ["/api/forms/sign", "POST"],
        ["/api/orientation/complete", "POST"],
        ["/api/settings/security-questions", "POST"],
        ["/api/settings/password", "PUT"],
        ["/api/auth/session", "POST"],
      ] as const) {
        const res = proxy(request(path, { ...SAME_ORIGIN, ...heldStudentCookie() }, method));
        assert.equal(res.status, 403, `${method} ${path}`);
        assert.equal((await res.json()).code, "PASSWORD_CHANGE_REQUIRED", `${method} ${path}`);
      }
    }));

  it("answers a cross-site write with the origin refusal, not this one", () =>
    withDemoSwitch("off", async () => {
      const res = proxy(request("/api/settings/password", { origin: "https://evil.example", ...heldStudentCookie() }));
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: "Forbidden: origin mismatch." });
    }));

  it("passes every request on the list", () =>
    withDemoSwitch("off", () => {
      for (const entry of ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED) {
        const [method = "", path = ""] = entry.split(" ");
        const res = proxy(request(path, { ...SAME_ORIGIN, ...heldStudentCookie() }, method));
        assert.equal(res.status, 200, entry);
      }
    }));

  it("passes the files in public/", () =>
    withDemoSwitch("off", () => {
      for (const file of PUBLIC_FILES) {
        assert.equal(proxy(request(file, heldStudentCookie(), "GET")).status, 200, file);
      }
    }));

  it("still gives the change route the student's own RLS headers", () =>
    withDemoSwitch("off", () => {
      const res = proxy(request("/api/settings/password", { ...SAME_ORIGIN, ...heldStudentCookie() }));
      assert.equal(res.status, 200);
      assert.equal(forwardedHeader(res, "x-vq-user-id"), "held-student");
      assert.equal(forwardedHeader(res, "x-vq-role"), "student");
      assert.equal(forwardedHeader(res, "x-vq-student-id"), "held-student");
    }));

  it("holds whatever token carries the claim, since the claim is all the proxy can see", () =>
    withDemoSwitch("off", () => {
      const cookie = sessionCookie(signToken("staff-1", "teacher", 1, { mustChangePassword: true }));
      assert.equal(proxy(request("/api/teacher/students", cookie, "GET")).status, 403);
      assert.equal(proxy(request("/teacher", cookie, "GET")).headers.get("location"), "https://vq.example/change-password");
    }));
});

describe("proxy, sessions with nothing to change", () => {
  it("leaves a student with no claim alone", () =>
    withDemoSwitch("off", () => {
      const cookie = sessionCookie(signToken("student-1", "student", 1, { mustChangePassword: false }));
      assert.equal(proxy(request("/dashboard", cookie, "GET")).status, 200);
      assert.equal(proxy(request("/api/goals", cookie, "GET")).status, 200);
      assert.equal(proxy(request("/api/chat/send", { ...SAME_ORIGIN, ...cookie })).status, 200);
    }));

  it("leaves staff alone", () =>
    withDemoSwitch("off", () => {
      for (const role of ["teacher", "admin", "coordinator"]) {
        const cookie = sessionCookie(signToken(`${role}-1`, role, 1, { mustChangePassword: false }));
        assert.equal(proxy(request("/teacher", cookie, "GET")).status, 200, role);
        assert.equal(proxy(request("/api/teacher/students", cookie, "GET")).status, 200, role);
      }
    }));

  it("leaves both kinds of demo session alone", () =>
    withDemoSwitch("on", () => {
      const student = sessionCookie(signToken("demo-student-id", "student", 1, { demo: "student", mustChangePassword: false }));
      assert.equal(proxy(request("/dashboard", student, "GET")).status, 200);
      assert.equal(proxy(request("/api/goals", { ...SAME_ORIGIN, ...student })).status, 200);
      assert.equal(proxy(request("/api/teacher/sage-snippets", demoInstructorCookie(), "GET")).status, 200);
    }));

  // The decision for a token signed before the claim existed. It has no key,
  // so the proxy reads it as "nothing to change" and passes it: refusing it
  // here would sign every person out on the day this ships. It is not let in.
  // getSession() ends any session whose claim and account row disagree, so
  // for an account that must change its password this token is no session at
  // all once a handler or a page asks (src/lib/auth.password-change.test.ts).
  it("passes a token signed before the claim existed, and leaves it to getSession", () =>
    withDemoSwitch("off", () => {
      const old = jwt.sign({ sub: "student-1", role: "student", sv: 1 }, DEMO_TEST_JWT_SECRET, {
        expiresIn: "7d",
        algorithm: "HS256",
      });
      assert.equal(proxy(request("/dashboard", sessionCookie(old), "GET")).status, 200);
      assert.equal(proxy(request("/api/goals", sessionCookie(old), "GET")).status, 200);
    }));

  it("treats a token whose claim is not exactly true as no session at all", () =>
    withDemoSwitch("off", () => {
      const forged = jwt.sign({ sub: "student-1", role: "student", sv: 1, mustChangePassword: "no" }, DEMO_TEST_JWT_SECRET, {
        expiresIn: "7d",
        algorithm: "HS256",
      });
      const page = proxy(request("/dashboard", sessionCookie(forged), "GET"));
      assert.equal(page.status, 307);
      assert.equal(page.headers.get("location"), "https://vq.example/");
      assert.equal(forwardedHeader(proxy(request("/api/goals", sessionCookie(forged), "GET")), "x-vq-user-id"), null);
    }));
});
