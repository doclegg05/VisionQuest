/**
 * RBAC permission check stub.
 *
 * The full RBAC system (Role, Permission, RolePermission tables) has not
 * been implemented yet. This stub always returns false, which causes the
 * registry middleware to fall back to the static requiredRoles array
 * defined in each tool's registry entry.
 */
export async function hasPermission(
  _role: string,
  _toolId: string,
): Promise<boolean> {
  return false;
}
