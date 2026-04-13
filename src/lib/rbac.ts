import { prisma } from "./db";

/**
 * RBAC permission checker.
 *
 * Resolves permissions from the Role -> RolePermission -> Permission tables.
 * Results are cached in-memory for CACHE_TTL_MS to avoid a DB round-trip on
 * every request while still honouring runtime permission changes within a
 * reasonable window.
 */

const permissionCache = new Map<
  string,
  { permissions: Set<string>; expiresAt: number }
>();
let rolePermissionSeedState:
  | { hasAssignments: boolean; expiresAt: number }
  | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

export interface PermissionResolution {
  allowed: boolean;
  source: "rbac" | "fallback";
}

async function hasSeededRolePermissions(): Promise<boolean> {
  if (rolePermissionSeedState && rolePermissionSeedState.expiresAt > Date.now()) {
    return rolePermissionSeedState.hasAssignments;
  }

  const count = await prisma.rolePermission.count();
  const hasAssignments = count > 0;
  rolePermissionSeedState = {
    hasAssignments,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return hasAssignments;
}

/**
 * Get all granted permission keys for a role name.
 * Results are cached for 1 minute.
 */
export async function getPermissionsForRole(
  roleName: string,
): Promise<Set<string>> {
  const cached = permissionCache.get(roleName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.permissions;
  }

  const rolePerms = await prisma.rolePermission.findMany({
    where: {
      role: { name: roleName },
      granted: true,
    },
    include: { permission: { select: { key: true } } },
  });

  const permissions = new Set(rolePerms.map((rp) => rp.permission.key));
  permissionCache.set(roleName, {
    permissions,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return permissions;
}

/**
 * Check if a role has a specific permission.
 */
export async function hasPermission(
  roleName: string,
  permissionKey: string,
): Promise<boolean> {
  const permissions = await getPermissionsForRole(roleName);
  return permissions.has(permissionKey);
}

/**
 * Resolve a permission check while preserving the distinction between:
 * - RBAC explicitly allowing/denying a permission
 * - RBAC being unavailable or unseeded, in which case callers may fall back
 */
export async function resolvePermission(
  roleName: string,
  permissionKey: string,
): Promise<PermissionResolution> {
  try {
    const hasAssignments = await hasSeededRolePermissions();
    if (!hasAssignments) {
      return { allowed: false, source: "fallback" };
    }

    const permissions = await getPermissionsForRole(roleName);
    return {
      allowed: permissions.has(permissionKey),
      source: "rbac",
    };
  } catch {
    return { allowed: false, source: "fallback" };
  }
}

/**
 * Clear the permission cache (call after role-permission changes).
 */
export function clearPermissionCache(): void {
  permissionCache.clear();
  rolePermissionSeedState = null;
}
