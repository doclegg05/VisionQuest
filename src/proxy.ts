import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedInternalRequest, isUrlHostMatch } from "@/lib/csrf";

/**
 * CSRF protection via Origin header validation.
 *
 * For all state-changing requests (POST, PUT, PATCH, DELETE) to API routes,
 * verify the Origin or Referer header matches the app's host. This prevents
 * cross-site request forgery without requiring tokens, leveraging the browser's
 * guarantee that Origin cannot be spoofed by JavaScript.
 *
 * Internal automation routes can bypass Origin validation when they present the
 * shared CRON_SECRET as a bearer token. Those routes still perform their own
 * route-level authorization checks.
 */
export function proxy(request: NextRequest) {
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
  const authorization = request.headers.get("authorization");

  // In development, be lenient (tools like Postman don't send Origin)
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  if (
    isAuthorizedInternalRequest(
      request.nextUrl.pathname,
      authorization,
      process.env.CRON_SECRET
    )
  ) {
    return NextResponse.next();
  }

  // At least one of Origin or Referer must be present and match the host
  if (isUrlHostMatch(origin, host)) {
    return NextResponse.next();
  }

  if (isUrlHostMatch(referer, host)) {
    return NextResponse.next();
  }

  return NextResponse.json(
    { error: "Forbidden: origin mismatch." },
    { status: 403 }
  );
}

export const config = {
  matcher: "/api/:path*",
};
