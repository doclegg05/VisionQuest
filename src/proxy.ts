import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedInternalRequest, isUrlHostMatch } from "@/lib/csrf";

const isProduction = process.env.NODE_ENV === "production";

// Next.js 16 proxy (middleware) convention — filename must be `proxy.ts` and the
// exported function must be named `proxy`. Handles:
//   1. CSRF protection via Origin / Referer validation for state-changing API requests
//   2. Per-request CSP nonce generation (replaces static unsafe-inline)
//   3. X-API-Version response header on /api/* responses
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
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://images.credly.com https://www.credly.com",
    "connect-src 'self' https://generativelanguage.googleapis.com https://*.ingest.sentry.io",
    "frame-src 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "report-uri /api/csp-report",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
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
  matcher: [
    // Match all paths except static files and _next internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
