import { prismaAdmin } from "./db";

/**
 * RBAC permission checker.
 *
 * Resolves permissions from the Role -> RolePermission -> Permission tables.
 * Results are cached in-memory for CACHE_TTL_MS to avoid a DB round-trip on
 * every request while still honouring runtime permission changes within a
 * reasonable window.
 *
 * Deliberately prismaAdmin, in the same spirit as the doc block on
 * confirmation-use.ts: Role, Permission and RolePermission are SERVER POLICY
 * DATA, not student data. Their RLS policies (`role_admin_only`,
 * `permission_admin_only`, `role_permission_admin_only` in the baseline
 * migration) are admin-only BY DESIGN — `USING (current_setting(
 * 'app.current_role', true) = 'admin')` — so reading them through the
 * RLS-scoped app client returned zero rows on every student and teacher
 * request. That broke the layer in two directions at once:
 *
 *   1. RBAC was inert for non-admins: `hasSeededRolePermissions()` saw count
 *      0 and every resolve returned `{ allowed: false, source: "fallback" }`,
 *      so registry routes silently fell through to their static
 *      `requiredRoles` arrays and no granular permission ever applied.
 *   2. Worse, the caches below are module-global and NOT keyed by actor. One
 *      admin request warmed the seed caches to true; the next student request
 *      then took the RBAC branch, read an empty grant set under its own RLS
 *      context, and middleware.ts turned that into a 403 with no fallback —
 *      for every withRegistry route, for the whole 60s TTL, whenever
 *      RolePermission was seeded.
 *
 * The cache invariant this restores, and which any future change here must
 * keep: EVERY read below must be actor-independent. These caches are shared
 * across concurrent requests from different roles, so a read whose result
 * depends on who is asking poisons them for everyone. `permissionCache` is
 * keyed by role name and `permissionSeedCache` by permission key precisely so
 * that the cached value is a property of the data, not of the caller.
 *
 * F63 caveat, and why it is safe: if ADMIN_DATABASE_URL is unset, prismaAdmin
 * falls back to DATABASE_URL (`vq_app`) AND carries no RLS extension, so it
 * sets no `app.current_role` at all and the admin-only policies reject it
 * uniformly — for admins too. Uniform blindness reads as "RBAC unseeded", so
 * every actor falls back to static roles exactly as before. It cannot produce
 * the mixed-visibility state that caused (2). Pinned by a test.
 */

// Shared by every concurrent request regardless of role — see the
// actor-independence invariant in the module doc block before adding a read.
const permissionCache = new Map<
  string,
  { permissions: Set<string>; expiresAt: number }
>();
const permissionSeedCache = new Map<
  string,
  { hasPermissionMappings: boolean; expiresAt: number }
>();
let rolePermissionSeedState:
  | { hasAssignments: boolean; expiresAt: number }
  | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute
type RbacPrismaClient = Pick<typeof prismaAdmin, "permission" | "rolePermission">;
/** The production client, named so the test-injection escape hatch below has
 *  one place to restore rather than a second copy of the choice. */
const DEFAULT_RBAC_CLIENT: RbacPrismaClient = prismaAdmin;
let rbacPrisma: RbacPrismaClient = DEFAULT_RBAC_CLIENT;

export interface PermissionResolution {
  allowed: boolean;
  source: "rbac" | "fallback";
}

async function hasSeededRolePermissions(): Promise<boolean> {
  if (rolePermissionSeedState && rolePermissionSeedState.expiresAt > Date.now()) {
    return rolePermissionSeedState.hasAssignments;
  }

  const count = await rbacPrisma.rolePermission.count();
  const hasAssignments = count > 0;
  rolePermissionSeedState = {
    hasAssignments,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return hasAssignments;
}

async function hasSeededPermissionMappings(permissionKey: string): Promise<boolean> {
  const cached = permissionSeedCache.get(permissionKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.hasPermissionMappings;
  }

  const permission = await rbacPrisma.permission.findUnique({
    where: { key: permissionKey },
    select: {
      id: true,
      roles: {
        select: { id: true },
        take: 1,
      },
    },
  });

  const hasPermissionMappings = Boolean(permission && permission.roles.length > 0);
  permissionSeedCache.set(permissionKey, {
    hasPermissionMappings,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return hasPermissionMappings;
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

  const rolePerms = await rbacPrisma.rolePermission.findMany({
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

    // Some environments have partial RBAC data during rollout: a handful of
    // RolePermission rows exist, but the specific registry permission has not
    // been seeded yet. In that case we fall back to the tool's static roles
    // instead of treating the missing permission as an intentional deny.
    const hasPermissionMappings = await hasSeededPermissionMappings(permissionKey);
    if (!hasPermissionMappings) {
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
  permissionSeedCache.clear();
  rolePermissionSeedState = null;
}

export function setRbacPrismaClientForTests(client: RbacPrismaClient): () => void {
  rbacPrisma = client;
  clearPermissionCache();
  return () => {
    rbacPrisma = DEFAULT_RBAC_CLIENT;
    clearPermissionCache();
  };
}
