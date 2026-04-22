import type { RlsContext } from "./rls-context";

/**
 * Request headers the middleware (src/proxy.ts) sets when it decodes a valid
 * session JWT. The Prisma extension (src/lib/db.ts) falls back to reading
 * these when no AsyncLocalStorage context is available — e.g. in server
 * components that never go through `withAuth`.
 *
 * Must be x-* headers so they pass through Next.js request forwarding and
 * can never be spoofed by the client: middleware strips any inbound copies
 * before adding its own.
 */
export const RLS_HEADER_USER_ID = "x-vq-user-id";
export const RLS_HEADER_ROLE = "x-vq-role";
export const RLS_HEADER_STUDENT_ID = "x-vq-student-id";

export const RLS_HEADER_NAMES = [
  RLS_HEADER_USER_ID,
  RLS_HEADER_ROLE,
  RLS_HEADER_STUDENT_ID,
] as const;

export interface SessionClaimsLike {
  sub: string;
  role: string;
}

/**
 * Build the RLS context header record from verified JWT claims.
 *
 * For students, `studentId` equals their user id (row-ownership key).
 * For staff, `studentId` is empty — teacher policies branch on
 * `current_role` and join through `SpokesClassInstructor` instead.
 */
export function rlsHeadersFromClaims(
  claims: SessionClaimsLike,
): Record<string, string> {
  const role = claims.role === "admin" || claims.role === "teacher" ? claims.role : "student";
  const studentId = role === "student" ? claims.sub : "";
  return {
    [RLS_HEADER_USER_ID]: claims.sub,
    [RLS_HEADER_ROLE]: role,
    [RLS_HEADER_STUDENT_ID]: studentId,
  };
}

interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Reconstruct the RLS context from a headers-like object (typically the
 * `next/headers` return value). Returns null when any required header is
 * missing or empty — callers must treat that as "no context".
 */
export function rlsContextFromHeaders(headers: HeaderReader): RlsContext | null {
  const userId = headers.get(RLS_HEADER_USER_ID);
  const role = headers.get(RLS_HEADER_ROLE);
  const studentId = headers.get(RLS_HEADER_STUDENT_ID);

  if (!userId || !role) return null;
  if (role !== "student" && role !== "teacher" && role !== "admin") return null;
  if (role === "student" && !studentId) return null;

  return {
    userId,
    role,
    studentId: studentId ?? "",
  };
}
