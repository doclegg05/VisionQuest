import { forbidden, unauthorized, withAuth, type Session } from "@/lib/api-error";
import { hasPermission } from "@/lib/rbac";

/**
 * Wraps a route handler so only admin + coordinator sessions pass. Teachers
 * and students get 403. Admin is always allowed (superset); coordinators
 * must also hold the named RBAC permission — the `requiredPermission`
 * argument is checked against the Role → RolePermission → Permission tables.
 *
 * Usage:
 *   export const GET = withCoordinatorAuth(
 *     "coordinator.dashboard.view",
 *     async (session, req) => { ... },
 *   );
 */
export function withCoordinatorAuth<Args extends unknown[]>(
  requiredPermission: `coordinator.${string}`,
  handler: (session: Session, ...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return withAuth(async (session, ...args: Args) => {
    if (session.role !== "admin" && session.role !== "coordinator") {
      throw forbidden();
    }
    if (session.role === "coordinator") {
      const allowed = await hasPermission(session.role, requiredPermission);
      if (!allowed) throw forbidden();
    }
    return handler(session, ...args);
  });
}

/**
 * Throws unauthorized() if no session, forbidden() unless the caller is
 * admin or coordinator. Useful for routes that need to branch behavior by
 * role rather than gate on a single permission.
 */
export function assertCoordinatorOrAdmin(session: Session | null | undefined): asserts session is Session {
  if (!session) throw unauthorized();
  if (session.role !== "admin" && session.role !== "coordinator") {
    throw forbidden();
  }
}
