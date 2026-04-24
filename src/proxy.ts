import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedInternalRequest, isUrlHostMatch } from "@/lib/csrf";
import { verifyToken } from "@/lib/session-token";
import {
  RLS_HEADER_NAMES,
  RLS_HEADER_ROLE,
  RLS_HEADER_STUDENT_ID,
  RLS_HEADER_USER_ID,
  rlsHeadersFromClaims,
} from "@/lib/rls-headers";

const isProduction = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = "vq-session";

// Next.js 16 proxy (middleware) convention — filename must be `proxy.ts` and the
// exported function must be named `proxy`. Handles:
//   1. CSRF protection via Origin / Referer validation for state-changing API requests
//   2. Per-request CSP nonce generation (replaces static unsafe-inline)
//   3. X-API-Version response header on /api/* responses
//   4. RLS context headers derived from the session JWT (Slice B).
// The static CSP in next.config.ts has been removed — this proxy is the single source of truth.

export function proxy(request: NextRequest) {
  // --- CSRF protection (state-changing API requests only) ---
  const method = request.method.toUpperCase();
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const isStateChanging = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

  if (isStateChanging && isApi && request.nextUrl.pathname !== "/api/health") {
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    const host = request.headers.get("host");
    const authorization = request.headers.get("authorization");

    const isInternal = isAuthorizedInternalRequest(
      request.nextUrl.pathname,
      authorization,
      process.env.CRON_SECRET,
    );

    if (!isInternal && !isUrlHostMatch(origin, host) && !isUrlHostMatch(referer, host)) {
      return NextResponse.json(
        { error: "Forbidden: origin mismatch." },
        { status: 403 },
      );
    }
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
    `style-src-elem 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://images.credly.com https://www.credly.com",
    "connect-src 'self' https://generativelanguage.googleapis.com https://*.ingest.sentry.io",
    // frame-src 'self' so the Library's same-origin PDF preview iframe
    // (sourced from /api/documents/download?mode=view) can render. Files
    // stream through our own origin, never a cross-origin presigned URL.
    "frame-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
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

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const claims = verifyToken(token);
    if (claims) {
      const rls = rlsHeadersFromClaims(claims);
      requestHeaders.set(RLS_HEADER_USER_ID, rls[RLS_HEADER_USER_ID]);
      requestHeaders.set(RLS_HEADER_ROLE, rls[RLS_HEADER_ROLE]);
      requestHeaders.set(RLS_HEADER_STUDENT_ID, rls[RLS_HEADER_STUDENT_ID]);
    }
  }

  requestHeaders.set("x-csp-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  // API version header
  if (isApi) {
    response.headers.set("X-API-Version", "1");
  }

  return response;
}

export const config = {
  // Next.js 16 proxy (renamed from middleware) always runs on Node.js runtime —
  // no `runtime` key allowed here. `jsonwebtoken`'s Node-crypto dependency
  // works out of the box.
  matcher: [
    // Match all paths except static files and _next internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
