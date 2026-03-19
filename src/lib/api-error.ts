import { NextResponse } from "next/server";
import { getSession } from "./auth";
import { logger } from "./logger";

/**
 * Structured API error with HTTP status code.
 * Throw from any route handler wrapped by `withErrorHandler`.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// --- Factory helpers ---

export function unauthorized(msg = "Unauthorized") {
  return new ApiError(401, msg, "UNAUTHORIZED");
}

export function forbidden(msg = "Forbidden") {
  return new ApiError(403, msg, "FORBIDDEN");
}

export function badRequest(msg: string) {
  return new ApiError(400, msg, "BAD_REQUEST");
}

export function notFound(msg = "Not found") {
  return new ApiError(404, msg, "NOT_FOUND");
}

export function conflict(msg: string) {
  return new ApiError(409, msg, "CONFLICT");
}

export function rateLimited(msg = "Too many requests, please try again later") {
  return new ApiError(429, msg, "RATE_LIMITED");
}

// --- Error response builder ---

function errorResponse(status: number, message: string, code?: string) {
  return NextResponse.json(
    { error: message, ...(code && { code }) },
    { status },
  );
}

/**
 * Wraps a Next.js route handler with standardized error handling.
 *
 * Usage:
 *   export const GET = withErrorHandler(async (req) => {
 *     const session = await getSession();
 *     if (!session) throw unauthorized();
 *     // ... return NextResponse.json(...)
 *   });
 */
export function withErrorHandler<
  Args extends unknown[],
>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return errorResponse(err.statusCode, err.message, err.code);
      }

      logger.error("Unhandled API error", { error: String(err) });
      return errorResponse(500, "Internal server error", "INTERNAL_ERROR");
    }
  };
}

// --- Session type ---

export interface Session {
  id: string;
  studentId: string;
  displayName: string;
  role: string;
}

/**
 * Wraps a route handler with auth + error handling.
 * The handler receives the validated session as first arg.
 *
 * Usage:
 *   export const GET = withAuth(async (session, req) => {
 *     return NextResponse.json({ user: session.displayName });
 *   });
 */
export function withAuth<
  Args extends unknown[],
>(
  handler: (session: Session, ...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return withErrorHandler(async (...args: Args) => {
    const session = await getSession();
    if (!session) throw unauthorized();
    return handler(session as Session, ...args);
  });
}

/**
 * Wraps a route handler with teacher auth + error handling.
 * Rejects non-teacher sessions with 403.
 *
 * Usage:
 *   export const GET = withTeacherAuth(async (session, req) => {
 *     // session.role is guaranteed to be "teacher"
 *     return NextResponse.json({ ... });
 *   });
 */
export function withTeacherAuth<
  Args extends unknown[],
>(
  handler: (session: Session, ...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return withErrorHandler(async (...args: Args) => {
    const session = await getSession();
    if (!session) throw unauthorized();
    if (session.role !== "teacher") throw forbidden();
    return handler(session as Session, ...args);
  });
}
