/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";

const mockRolePermissionCount = mock.fn() as any;
const mockRolePermissionFindMany = mock.fn() as any;
const mockPermissionFindUnique = mock.fn() as any;

mock.module("./db", {
  namedExports: {
    prisma: {
      rolePermission: {
        count: mockRolePermissionCount,
        findMany: mockRolePermissionFindMany,
      },
      permission: {
        findUnique: mockPermissionFindUnique,
      },
    },
  },
});

const rbacModulePromise = import("./rbac");

beforeEach(async () => {
  mockRolePermissionCount.mock.resetCalls();
  mockRolePermissionFindMany.mock.resetCalls();
  mockPermissionFindUnique.mock.resetCalls();

  const { clearPermissionCache } = await rbacModulePromise;
  clearPermissionCache();
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
