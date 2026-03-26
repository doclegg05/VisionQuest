import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedInternalRequest, isUrlHostMatch } from "@/lib/csrf";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Combined proxy handling:
 * 1. CSRF protection via Origin header validation
 * 2. Per-request CSP nonce generation (replaces static unsafe-inline)
 * 3. API version header
 */
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

    if (isProduction) {
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
  }

  // --- CSP nonce + response headers ---
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isProduction ? "" : " 'unsafe-eval'"}`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://images.credly.com",
    "connect-src 'self' https://*.ingest.sentry.io",
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
