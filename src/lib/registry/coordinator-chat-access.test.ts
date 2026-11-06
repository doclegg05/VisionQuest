import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import type { NextRequest } from "next/server";
import type { Session } from "@/lib/api-error";
import { mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Owner decision, 2026-11-06: both coordinator roles may use Sage chat.
//
// The gate under test is the REAL one: the real registry entries, the real
// withRegistry middleware and the real rbac.ts resolution logic. Only the
// session lookup, the audit writer and the RBAC database client are stand-ins;
// role logic is never mocked.
// ---------------------------------------------------------------------------

let session: Session | null = null;

mock.module("@/lib/auth", {
  namedExports: { getSession: async () => session },
});
mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: async () => undefined },
});
mock.module("@/lib/db", {
  exports: { prisma: {}, prismaAdmin: {} },
});

/** Role name -> granted permission keys, standing in for RolePermission rows. */
type Grants = Record<string, readonly string[]>;

function fakeRbacClient(grants: Grants) {
  const rows = Object.entries(grants).flatMap(([role, keys]) => keys.map((key) => ({ role, key })));
  return {
    rolePermission: {
      count: async () => rows.length,
      findMany: async (args: { where: { role: { name: string } } }) =>
        rows
          .filter((row) => row.role === args.where.role.name)
          .map((row) => ({ permission: { key: row.key } })),
    },
    permission: {
      findUnique: async (args: { where: { key: string } }) => {
        const mapped = rows.filter((row) => row.key === args.where.key);
        return mapped.length > 0 ? { id: args.where.key, roles: [{ id: "rp" }] } : null;
      },
    },
  };
}

type Middleware = typeof import("./middleware");
type Rbac = typeof import("@/lib/rbac");
let withRegistry: Middleware["withRegistry"];
let setRbacPrismaClientForTests: Rbac["setRbacPrismaClientForTests"];
let restoreRbac: (() => void) | null = null;

before(async () => {
  ({ withRegistry } = await import("./middleware"));
  ({ setRbacPrismaClientForTests } = await import("@/lib/rbac"));
});

after(() => restoreRbac?.());

function useRbac(grants: Grants): void {
  restoreRbac?.();
  // The real client type is Prisma's; the stand-in implements the three calls rbac.ts makes.
  restoreRbac = setRbacPrismaClientForTests(
    fakeRbacClient(grants) as unknown as Parameters<Rbac["setRbacPrismaClientForTests"]>[0],
  );
}

async function statusFor(toolId: string, who: Session): Promise<number> {
  session = who;
  const handler = withRegistry(toolId, async () => Response.json({ ok: true }));
  const res = await handler({} as NextRequest, { params: Promise.resolve({}) });
  return res.status;
}

const coordinator = mockTeacherSession({ id: "crd-test-001", role: "coordinator" });
const programCoordinator = mockTeacherSession({ id: "pcd-test-001", role: "program_coordinator" });
const student = mockStudentSession();
const cdc = mockTeacherSession({ id: "cdc-test-001", role: "cdc" });

/** The chat surface's read and chat routes a coordinator needs. */
const CHAT_TOOLS = ["sage.chat", "sage.conversations", "sage.history"] as const;

describe("Sage chat gate, RBAC unseeded (static requiredRoles)", () => {
  beforeEach(() => useRbac({}));

  for (const who of [coordinator, programCoordinator]) {
    for (const toolId of CHAT_TOOLS) {
      it(`${who.role} may use ${toolId}`, async () => {
        assert.equal(await statusFor(toolId, who), 200);
      });
    }

    it(`${who.role} still may not use the student-only warmup`, async () => {
      assert.equal(await statusFor("sage.warmup", who), 403);
    });
  }

  it("a student still may use sage.chat", async () => {
    assert.equal(await statusFor("sage.chat", student), 200);
  });

  it("a cdc session is still refused sage.chat", async () => {
    assert.equal(await statusFor("sage.chat", cdc), 403);
  });
});

describe("Sage chat gate, RBAC seeded", () => {
  // Production before the grant migration: sage.chat is mapped for the old
  // three roles only, so RBAC answers for coordinators and answers no.
  it("refuses coordinators while their sage.chat grant is missing", async () => {
    useRbac({ student: ["sage.chat"], teacher: ["sage.chat"], admin: ["sage.chat"] });
    assert.equal(await statusFor("sage.chat", coordinator), 403);
    assert.equal(await statusFor("sage.chat", programCoordinator), 403);
  });

  it("admits coordinators once the grant rows exist", async () => {
    useRbac({
      student: ["sage.chat"],
      coordinator: [...CHAT_TOOLS],
      program_coordinator: [...CHAT_TOOLS],
    });
    for (const toolId of CHAT_TOOLS) {
      assert.equal(await statusFor(toolId, coordinator), 200, `coordinator ${toolId}`);
      assert.equal(await statusFor(toolId, programCoordinator), 200, `program_coordinator ${toolId}`);
    }
    assert.equal(await statusFor("sage.chat", student), 200);
  });
});

describe("where production gets the grant", () => {
  const read = (relative: string): string => readFileSync(path.join(process.cwd(), relative), "utf8");

  it("the migration grants the three chat permissions to both coordinator role rows", () => {
    const migration = read(
      "prisma/migrations/20261107140000_grant_sage_chat_to_coordinators/migration.sql",
    );
    // Roles are matched by name, the column rbac.ts reads, not by sentinel id.
    assert.match(migration, /r\."name" IN \('coordinator', 'program_coordinator'\)/);
    assert.doesNotMatch(migration, /sys_(program_)?coordinator_role_v1/);
    // Deterministic row ids.
    assert.match(migration, /'sys_rp_' \|\| r\."name" \|\| '_' \|\| replace\(p\."key", '\.', '_'\)/);
    for (const key of CHAT_TOOLS) {
      assert.match(migration, new RegExp(`'${key.replace(".", "\\.")}'`));
    }
    assert.match(migration, /ON CONFLICT DO NOTHING/);
    assert.doesNotMatch(migration, /\b(DELETE|DROP|UPDATE)\b/i);
  });

  it("the seed script maps the chat permissions to both coordinator roles", () => {
    const seed = read("scripts/seed-rbac.ts");
    for (const key of CHAT_TOOLS) {
      const line = seed.split("\n").find((l) => l.includes(`["${key}",`));
      assert.ok(line, `${key} is seeded`);
      assert.match(line, /"coordinator"/, `${key} lists coordinator`);
      assert.match(line, /"program_coordinator"/, `${key} lists program_coordinator`);
    }
  });
});
