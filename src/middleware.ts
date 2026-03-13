import { NextRequest, NextResponse } from "next/server";

/**
 * CSRF protection via Origin header validation.
 *
 * For all state-changing requests (POST, PUT, PATCH, DELETE) to API routes,
 * verify the Origin or Referer header matches the app's host. This prevents
 * cross-site request forgery without requiring tokens, leveraging the browser's
 * guarantee that Origin cannot be spoofed by JavaScript.
 */
export function middleware(request: NextRequest) {
  const method = request.method.toUpperCase();

  // Only check state-changing methods
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return NextResponse.next();
  }

  // Only protect API routes
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow health check
  if (request.nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = request.headers.get("host");

  // In development, be lenient (tools like Postman don't send Origin)
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  // At least one of Origin or Referer must be present and match the host
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) {
        return NextResponse.next();
      }
    } catch {
      // Malformed origin — reject
    }
  }

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host === host) {
        return NextResponse.next();
      }
    } catch {
      // Malformed referer — reject
    }
  }

  return NextResponse.json(
    { error: "Forbidden: origin mismatch." },
    { status: 403 }
  );
}

export const config = {
  matcher: "/api/:path*",
};
