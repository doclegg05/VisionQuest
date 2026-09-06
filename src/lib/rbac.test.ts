/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";

const mockRolePermissionCount = mock.fn() as any;
const mockRolePermissionFindMany = mock.fn() as any;
const mockPermissionFindUnique = mock.fn() as any;

// ---------------------------------------------------------------------------
// Actor-blindness (Bug 2).
//
// Role, Permission and RolePermission carry admin-only RLS policies
// (`role_admin_only` and its two siblings in the baseline migration:
// USING (current_setting('app.current_role', true) = 'admin')), so reading
// them through the RLS-scoped app client returns ZERO rows on every student
// and teacher request. Two consequences, both live before the fix:
//   1. RBAC is inert for non-admins — every resolve falls back to static roles.
//   2. The module caches are global, unkeyed by actor, and hold for 60s, so
//      one admin request warms "RBAC is seeded" and "this permission is
//      mapped" to true; the next student request then takes the RBAC branch,
//      reads an empty grant set under its own RLS context, and is denied with
//      source "rbac" — which middleware.ts turns into a 403 with no fallback.
//
// The fakes below reproduce the policy. The app view yields rows only while
// the simulated actor is an admin; the admin view stands in for prismaAdmin,
// which connects as `postgres` and never injects an RLS context, so it always
// yields them.
// ---------------------------------------------------------------------------

type SeedRow = { role: string; permission: string; granted: boolean };

const RBAC_SEED: SeedRow[] = [
  { role: "student", permission: "sage.chat", granted: true },
  { role: "teacher", permission: "sage.chat", granted: true },
  { role: "admin", permission: "sage.chat", granted: true },
  { role: "admin", permission: "admin.audit_trail", granted: true },
  // Seeded FOR the student role and explicitly not granted — a revocation.
  // It must stay an RBAC deny, never soften into a static-roles fallback.
  { role: "student", permission: "admin.audit_trail", granted: false },
];

let simulatedActor = "admin";

function makeRbacFake(rowsVisible: () => boolean) {
  return {
    rolePermission: {
      count: async () => (rowsVisible() ? RBAC_SEED.length : 0),
      findMany: async ({ where }: any) =>
        rowsVisible()
          ? RBAC_SEED.filter(
              (row) => row.role === where.role.name && row.granted === where.granted,
            ).map((row) => ({ permission: { key: row.permission } }))
          : [],
    },
    permission: {
      findUnique: async ({ where }: any) => {
        if (!rowsVisible()) return null;
        const mapped = RBAC_SEED.filter((row) => row.permission === where.key);
        if (mapped.length === 0) return null;
        return { id: where.key, roles: [{ id: `rp-${where.key}` }] };
      },
    },
  };
}

const rlsScopedAppClient = makeRbacFake(() => simulatedActor === "admin");
const rlsBypassingAdminClient = makeRbacFake(() => true);
/** The ADMIN_DATABASE_URL-unset shape: prismaAdmin falls back to the app URL
 *  (`vq_app`) and carries no RLS extension, so it sets no `app.current_role`
 *  and the admin-only policies reject it for every actor, admins included. */
const blindClient = makeRbacFake(() => false);

mock.module("@/lib/db", {
  namedExports: { prisma: rlsScopedAppClient, prismaAdmin: rlsBypassingAdminClient },
});

type RbacModule = typeof import("./rbac");

const rbacModulePromise = import(
  `${new URL("./rbac.ts", import.meta.url).href}?rbac-test`
) as Promise<RbacModule>;

/** Puts rbac.ts back on the client it uses in production, and clears the
 *  caches. The beforeEach below installs a mock for the older tests; the
 *  actor-blindness tests need the real default, which is what this restores. */
let restoreDefaultRbacClient: () => void = () => {};

beforeEach(async () => {
  mockRolePermissionCount.mock.resetCalls();
  mockRolePermissionFindMany.mock.resetCalls();
  mockPermissionFindUnique.mock.resetCalls();
  simulatedActor = "admin";

  const { setRbacPrismaClientForTests } = await rbacModulePromise;
  restoreDefaultRbacClient = setRbacPrismaClientForTests({
    rolePermission: {
      count: mockRolePermissionCount,
      findMany: mockRolePermissionFindMany,
    },
    permission: {
      findUnique: mockPermissionFindUnique,
    },
  } as never);
});

test("resolvePermission falls back when no role-permission rows exist yet", async () => {
  const { resolvePermission } = await rbacModulePromise;
  mockRolePermissionCount.mock.mockImplementation(async () => 0);

  const result = await resolvePermission("admin", "classes.list");

  assert.deepEqual(result, { allowed: false, source: "fallback" });
  assert.equal(mockPermissionFindUnique.mock.callCount(), 0);
  assert.equal(mockRolePermissionFindMany.mock.callCount(), 0);
});

test("resolvePermission falls back when RBAC exists globally but the permission is missing", async () => {
  const { resolvePermission } = await rbacModulePromise;
  mockRolePermissionCount.mock.mockImplementation(async () => 1);
  mockPermissionFindUnique.mock.mockImplementation(async () => null);

  const result = await resolvePermission("admin", "classes.list");

  assert.deepEqual(result, { allowed: false, source: "fallback" });
  assert.equal(mockRolePermissionFindMany.mock.callCount(), 0);
});

test("resolvePermission falls back when the permission exists but has no role mappings yet", async () => {
  const { resolvePermission } = await rbacModulePromise;
  mockRolePermissionCount.mock.mockImplementation(async () => 1);
  mockPermissionFindUnique.mock.mockImplementation(async () => ({
    id: "perm-1",
    roles: [],
  }));

  const result = await resolvePermission("admin", "classes.list");

  assert.deepEqual(result, { allowed: false, source: "fallback" });
  assert.equal(mockRolePermissionFindMany.mock.callCount(), 0);
});

test("resolvePermission honors RBAC when the permission has seeded mappings", async () => {
  const { resolvePermission } = await rbacModulePromise;
  mockRolePermissionCount.mock.mockImplementation(async () => 3);
  mockPermissionFindUnique.mock.mockImplementation(async () => ({
    id: "perm-1",
    roles: [{ id: "rp-1" }],
  }));
  mockRolePermissionFindMany.mock.mockImplementation(async () => [
    { permission: { key: "classes.list" } },
  ]);

  const result = await resolvePermission("admin", "classes.list");

  assert.deepEqual(result, { allowed: true, source: "rbac" });
});

test("resolvePermission denies via RBAC when the permission is seeded but not granted to the role", async () => {
  const { resolvePermission } = await rbacModulePromise;
  mockRolePermissionCount.mock.mockImplementation(async () => 3);
  mockPermissionFindUnique.mock.mockImplementation(async () => ({
    id: "perm-1",
    roles: [{ id: "rp-1" }],
  }));
  mockRolePermissionFindMany.mock.mockImplementation(async () => []);

  const result = await resolvePermission("teacher", "admin.audit_trail");

  assert.deepEqual(result, { allowed: false, source: "rbac" });
});

test("does not turn a warm admin cache into an RBAC denial for the next student", async () => {
  // The 403-storm case: an admin page load warms both seed caches to true,
  // and the student request one second later reads its own (empty) view.
  restoreDefaultRbacClient();
  const { resolvePermission } = await rbacModulePromise;

  simulatedActor = "admin";
  assert.deepEqual(await resolvePermission("admin", "sage.chat"), {
    allowed: true,
    source: "rbac",
  });

  simulatedActor = "student";
  const student = await resolvePermission("student", "sage.chat");
  assert.notDeepEqual(
    student,
    { allowed: false, source: "rbac" },
    "a student must never be denied by an RBAC read the student cannot legally perform",
  );
  assert.deepEqual(student, { allowed: true, source: "rbac" });
});

test("resolves a student permission from a cold cache during the student's own request", async () => {
  restoreDefaultRbacClient();
  const { resolvePermission } = await rbacModulePromise;

  simulatedActor = "student";
  assert.deepEqual(await resolvePermission("student", "sage.chat"), {
    allowed: true,
    source: "rbac",
  });
});

test("keeps a revoked permission a fail-closed RBAC deny, not a fallback", async () => {
  // Only the actor-blindness goes away — a genuine denial must still deny,
  // or the fix would have quietly turned RBAC into an advisory layer.
  restoreDefaultRbacClient();
  const { resolvePermission } = await rbacModulePromise;

  simulatedActor = "student";
  assert.deepEqual(await resolvePermission("student", "admin.audit_trail"), {
    allowed: false,
    source: "rbac",
  });
});

test("falls back to static roles for everyone when the RBAC client sees nothing", async () => {
  // F63's caveat, pinned: with ADMIN_DATABASE_URL unset, prismaAdmin connects
  // as vq_app AND carries no RLS extension, so it sets no `app.current_role`
  // and the admin-only policies reject it uniformly. Uniform blindness reads
  // as "RBAC unseeded", so every actor falls back to the static requiredRoles
  // array — today's behavior, and never a 403 storm.
  const { resolvePermission, setRbacPrismaClientForTests } = await rbacModulePromise;
  setRbacPrismaClientForTests(blindClient as never);

  simulatedActor = "admin";
  assert.deepEqual(await resolvePermission("admin", "sage.chat"), {
    allowed: false,
    source: "fallback",
  });

  simulatedActor = "student";
  assert.deepEqual(await resolvePermission("student", "sage.chat"), {
    allowed: false,
    source: "fallback",
  });
});
