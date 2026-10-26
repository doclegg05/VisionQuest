import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedInternalRequest, isSignedWebhookPath, isUrlHostMatch } from "@/lib/csrf";
import { isCohortDemoEnabled } from "@/lib/demo/config";
import { DEMO_READ_ONLY_REFUSAL } from "@/lib/demo/copy";
import { isDemoInstructorRequestAllowed } from "@/lib/demo/instructor-policy";
import { verifyToken, type SessionClaims } from "@/lib/session-token";
import {
  RLS_HEADER_NAMES,
  RLS_HEADER_ROLE,
  RLS_HEADER_STUDENT_ID,
  RLS_HEADER_USER_ID,
  rlsHeadersFromClaims,
} from "@/lib/rls-headers";

const isProduction = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = "vq-session";

let warnedStyleRelaxIgnored = false;

/**
 * CSP_DEV_RELAX=1 permits inline <style> elements, for a local session fighting
 * a tool that injects un-nonced styles. Opt-in and greppable, rather than
 * inferred from `NODE_ENV !== "production"`, so the policy exercised in dev and
 * CI is the policy that ships. Production ignores it and says so once.
 */
function styleSrcElemRelaxed(): boolean {
  if (process.env.CSP_DEV_RELAX !== "1") return false;
  if (!isProduction) return true;
  if (!warnedStyleRelaxIgnored) {
    warnedStyleRelaxIgnored = true;
    console.warn("[csp] CSP_DEV_RELAX is set in production and is being ignored.");
  }
  return false;
}

// Next.js 16 proxy (middleware) convention — filename must be `proxy.ts` and the
// exported function must be named `proxy`. Handles:
//   1. Auth redirect for gated routes (student/teacher/admin) to prevent "Loading..." flash
//   2. CSRF protection via Origin / Referer validation for state-changing API requests
//   3. Per-request CSP nonce generation (replaces static unsafe-inline)
//   4. X-API-Version response header on /api/* responses
//   5. RLS context headers derived from the session JWT (Slice B).
//   6. X-Robots-Tag on the two public per-student pages (crawlerHeadersFor).
//   7. Cohort demo fence: a demo session is treated as signed out once the
//      switch is off, and the shared demo instructor is held to
//      src/lib/demo/instructor-policy.ts. Both checks need no database.
// The static CSP in next.config.ts has been removed — this proxy is the single source of truth.
// Referrer-Policy and X-Content-Type-Options are NOT set here: next.config.ts
// `headers()` already applies both (plus HSTS and X-Frame-Options) to `/(.*)`.

/**
 * Prefixes under which every response renders ONE student's data behind an
 * opaque identifier with no login: the public credential page and the
 * employer response page (plus the packet PDF it links). FERPA review W7
 * (2026-09-06): neither carried `noindex`, and the repo has no robots.txt, so
 * a search engine could index a TANF recipient's name against a credential.
 * The pages also export `robots` metadata; the header is the layer that
 * covers non-HTML responses and any renderer that forgets the metadata.
 *
 * `/teacher/connect` is the staff console and is not a prefix match here.
 */
const NOINDEX_PREFIXES = ["/credentials", "/connect"] as const;

/** Pure: response headers a path earns from its prefix alone. */
export function crawlerHeadersFor(pathname: string): Record<string, string> {
  const noindex = NOINDEX_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
  return noindex ? { "X-Robots-Tag": "noindex, nofollow" } : {};
}

/**
 * The verified session claims for this request, or null for no usable session.
 * The token is verified once here and every later check reads the result. A
 * demo session whose switch is off counts as no session at all: the proxy has
 * no database to ask, so the token's own `demo` claim is what it can see.
 */
function sessionClaimsFor(request: NextRequest): SessionClaims | null {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const claims = token ? verifyToken(token) : null;
  if (claims?.demo !== undefined && !isCohortDemoEnabled()) return null;
  return claims;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const claims = sessionClaimsFor(request);

  // --- Auth redirect for gated routes ---
  // Redirect unauthenticated users hitting student/teacher/admin routes to the sign-in page.
  // This happens before the page renders, preventing the "Loading..." flash.
  // Match exact paths or paths followed by "/" to avoid false positives
  // (e.g., /teacher is gated but /teacher-register is public).
  const gatedPrefixes = ["/dashboard", "/welcome", "/forms", "/vision-board", "/orientation", "/settings", "/memory", "/files", "/resources", "/profile", "/portfolio", "/learning", "/jobs", "/chat", "/appointments", "/career", "/goals", "/help", "/teacher", "/admin", "/coordinator"];
  const isGatedRoute = gatedPrefixes.some((prefix) => 
    pathname === prefix || pathname.startsWith(prefix + "/")
  );

  if (isGatedRoute && !claims) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // --- CSRF protection (state-changing API requests only) ---
  const method = request.method.toUpperCase();
  const isApi = pathname.startsWith("/api/");
  const isStateChanging = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

  if (isStateChanging && isApi && pathname !== "/api/health") {
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    const host = request.headers.get("host");
    const authorization = request.headers.get("authorization");

    const isInternal = isAuthorizedInternalRequest(
      pathname,
      authorization,
      process.env.CRON_SECRET,
      process.env.INTAKE_WEBHOOK_SECRET,
    );

    // A third-party webhook cannot send our Origin. The exemption is narrow
    // and the route pays for it by verifying the provider's own signature
    // before it acts — see SIGNED_WEBHOOK_PATHS in src/lib/csrf.ts.
    const isSignedWebhook = isSignedWebhookPath(pathname);

    // A present Origin is authoritative (including the opaque "null" origin).
    // Referer is a fallback only when Origin is absent, never an override.
    const isSameOrigin = isUrlHostMatch(origin ?? referer, host);
    if (!isInternal && !isSignedWebhook && !isSameOrigin) {
      return NextResponse.json(
        { error: "Forbidden: origin mismatch." },
        { status: 403 },
      );
    }
  }

  // --- Demo instructor fence ---
  // After the CSRF check, so a cross-site request still gets the origin
  // refusal. The shared demo instructor is a real teacher account, so the
  // route handlers alone would let it change the program's real content.
  if (claims?.demo === "instructor" && !isDemoInstructorRequestAllowed(method, pathname)) {
    return NextResponse.json({ error: DEMO_READ_ONLY_REFUSAL }, { status: 403 });
  }

  // --- CSP nonce + response headers ---
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    // Next.js and Framer Motion emit inline style attributes at runtime
    // (for example on next/image and the route announcer), so style attrs
    // need to be permitted even though style/script elements remain controlled.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    // Nonce-based in every environment unless CSP_DEV_RELAX=1 is explicitly set,
    // and never relaxed in production regardless. Relaxing on the mere absence of
    // production means the CSP you develop and test against is not the CSP you
    // ship — a missing nonce then surfaces for the first time as broken styling
    // for real users. This is the same reasoning as CSP_REPORT_SILENCE in
    // src/app/api/csp-report/route.ts; the two halves are kept in step.
    styleSrcElemRelaxed()
      ? `style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com`
      : `style-src-elem 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://images.credly.com https://www.credly.com",
    "connect-src 'self' https://generativelanguage.googleapis.com https://*.ingest.sentry.io",
    // frame-src 'self' so the Library's same-origin PDF preview iframe
    // (sourced from /api/documents/download?mode=view) can render. Files
    // stream through our own origin, never a cross-origin presigned URL.
    "frame-src 'self'",
    "object-src 'none'",
    // 'self' (not 'none') because the library's iframe previewer loads
    // /api/documents/download?mode=view as a same-origin frame. 'none'
    // would refuse framing even for our own origin and blocks the preview.
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "report-uri /api/csp-report",
  ].join("; ");

  // --- RLS context headers (Slice B) ---
  // Always strip any client-supplied copy before we decide whether to set
  // our own — otherwise a request crafted with `x-vq-role: admin` would
  // reach route handlers that trust the header as a fallback context.
  const requestHeaders = new Headers(request.headers);
  for (const name of RLS_HEADER_NAMES) requestHeaders.delete(name);

  if (claims) {
    const rls = rlsHeadersFromClaims(claims);
    requestHeaders.set(RLS_HEADER_USER_ID, rls[RLS_HEADER_USER_ID]);
    requestHeaders.set(RLS_HEADER_ROLE, rls[RLS_HEADER_ROLE]);
    requestHeaders.set(RLS_HEADER_STUDENT_ID, rls[RLS_HEADER_STUDENT_ID]);
  }

  requestHeaders.set("x-csp-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  // API version header
  if (isApi) {
    response.headers.set("X-API-Version", "1");
  }

  for (const [name, value] of Object.entries(crawlerHeadersFor(pathname))) {
    response.headers.set(name, value);
  }

  return response;
}

/**
 * Every path the proxy runs on, exported so a test can exercise the negative
 * lookahead directly (`config.matcher` is read by the build, not by any code
 * a unit test can call).
 *
 * The pattern used to carry a fourth exclusion, `.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$`.
 * A matcher exclusion does not skip a rule inside the proxy — it skips the
 * proxy — so any path ending in one of those extensions got no CSRF Origin
 * check and no `x-vq-*` stripping (2026-09-06 hunt, follow-up 3). Nothing
 * routes there today; the day a catch-all or a dynamic segment can end in
 * `.png`, `POST /api/anything.png` is an unauthenticated write and a
 * client-supplied `x-vq-role: admin` reaches the handler looking exactly like
 * one this proxy derived from a verified session JWT. An exclusion whose only
 * purpose is to save work on assets is not worth holding open a hole in two
 * security controls.
 *
 * Cost of dropping it: the seven image files in `public/` now run the proxy,
 * which adds a CSP header and — only when a session cookie is present — one JWT
 * verification. Nothing else changes, and this is not a guess: the other three
 * files in `public/` are `.mp4`/`.vtt`, extensions the clause never listed, so
 * public assets have always been served through this proxy. `_next/static` and
 * `_next/image`, where the built and optimized assets actually live, are still
 * excluded by name, so the hot path is untouched. No path under `public/`
 * matches a gated prefix, so none of them can be redirected.
 */
export const PROXY_MATCHER = "/((?!_next/static/|_next/image$|favicon\\.ico$).*)";

export const config = {
  // Next.js 16 proxy (renamed from middleware) always runs on Node.js runtime —
  // no `runtime` key allowed here. `jsonwebtoken`'s Node-crypto dependency
  // works out of the box.
  //
  // The matcher MUST be a string literal here: Next parses `config` statically
  // at build time and rejects an identifier. `proxy.test.ts` pins it to
  // PROXY_MATCHER. Only framework-owned assets bypass the perimeter.
  matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$).*)"],
};
