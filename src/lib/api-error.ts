import { NextResponse } from "next/server";
import { getSession } from "./auth";
import { logger } from "./logger";
import { withRlsContext, type RlsContext } from "./rls-context";

/**
 * Translate a Session into the RLS context shape expected by
 * `withRlsContext` — the canonical mapping used by every auth wrapper in
 * the codebase. Exported so adjacent wrappers (withRegistry,
 * withCoordinatorAuth) can share the exact same logic and stay in sync.
 */
export function rlsContextFor(session: Session): RlsContext {
  const role = session.role === "admin" || session.role === "teacher" ? session.role : "student";
  return {
    userId: session.id,
    role,
    // For students, studentId == Student.id (row ownership key).
    // For staff, empty string — teacher policies branch on `current_role`
    // and join through SpokesClassInstructor instead of direct ownership.
    studentId: role === "student" ? session.id : "",
  };
}

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
 * Wraps a Next.js route handler with standardized error handling only —
 * NO session, NO RLS context. Use this strictly for endpoints that are
 * supposed to run unauthenticated: login, register, forgot-password,
 * csp-report, internal cron, etc.
 *
 * If your route needs `session`, use `withAuth` / `withTeacherAuth`.
 * Pairing `withErrorHandler` with a manual `getSession()` call skips
 * `withRlsContext` — under `vq_app` every subsequent Prisma query then
 * sees an empty role/userId and silently returns no rows. This class of
 * bug wrecked the document library on 2026-04-24 (commits 3493026,
 * 0cb9876).
 *
 * Usage (unauth endpoint):
 *   export const POST = withErrorHandler(async (req) => {
 *     const body = await req.json();
 *     // no getSession() here; this is a public endpoint
 *     return NextResponse.json(...);
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

export function isStaffRole(role: string) {
  return role === "teacher" || role === "admin";
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
    const typedSession = session as Session;
    return withRlsContext(rlsContextFor(typedSession), () => handler(typedSession, ...args));
  });
}

/**
 * Wraps a route handler with staff auth + error handling.
 * Rejects non-teacher/admin sessions with 403.
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
    if (!isStaffRole(session.role)) throw forbidden();
    const typedSession = session as Session;
    return withRlsContext(rlsContextFor(typedSession), () => handler(typedSession, ...args));
  });
}

export function withAdminAuth<
  Args extends unknown[],
>(
  handler: (session: Session, ...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return withErrorHandler(async (...args: Args) => {
    const session = await getSession();
    if (!session) throw unauthorized();
    if (session.role !== "admin") throw forbidden();
    const typedSession = session as Session;
    return withRlsContext(rlsContextFor(typedSession), () => handler(typedSession, ...args));
  });
}
