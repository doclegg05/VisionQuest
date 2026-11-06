/**
 * Organization-tree database tests (RegionInstructor and later tables).
 *
 * Opt-in like rls.test.ts: set RLS_TEST_ENABLED=true and point DATABASE_URL at
 * a migrated, non-production Postgres. Without both, the file registers one
 * passing placeholder and touches no database.
 *
 *   RLS_TEST_ENABLED=true DATABASE_URL=postgres://...rls-test... \
 *     node --import tsx --test src/lib/org-tree-rls.test.ts
 *
 * Append new cases inside the "org tree (integration)" describe; fixtures are
 * created in `before` and removed in `after`, scoped by a per-run suffix.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

type Role = "student" | "teacher" | "admin" | "coordinator";

const SHOULD_RUN = process.env.RLS_TEST_ENABLED === "true" && !!process.env.DATABASE_URL;

/** Read the backfill statement out of the migration so the test cannot drift from it. */
export function readBackfillSql(migrationFolder: string): string {
  const sql = readFileSync(
    join(process.cwd(), "prisma", "migrations", migrationFolder, "migration.sql"),
    "utf8",
  );
  const match = sql.match(/-- backfill:start\n([\s\S]*?)-- backfill:end/);
  if (!match) {
    throw new Error(`${migrationFolder} has no backfill:start/backfill:end block`);
  }
  return match[1].trim();
}

if (!SHOULD_RUN) {
  describe("org tree (integration) - SKIPPED", () => {
    it("requires RLS_TEST_ENABLED=true and DATABASE_URL pointing at a test DB", () => {
      assert.ok(true);
    });
  });
} else {
  describe("org tree (integration)", () => {
    const db = new PrismaClient();
    const suffix = `orgtree-${Date.now()}`;
    const ids = {
      regionA: "",
      teacher: "",
      studentLike: "",
      classA: "",
      classNoRegion: "",
    };

    /** Run `fn` as `vq_app` with the RLS GUCs set, like rls.test.ts. */
    async function asRole<T>(
      role: Role | null,
      userId: string | null,
      fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>,
    ): Promise<T> {
      return db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE vq_app`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_user_id', $1, true)`, userId ?? "");
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_role', $1, true)`, role ?? "");
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_student_id', $1, true)`,
          role === "student" ? (userId ?? "") : "",
        );
        return fn(tx);
      });
    }

    before(async () => {
      const region = await db.region.create({
        data: { name: `Region ${suffix}`, code: `R-${suffix}` },
      });
      ids.regionA = region.id;
      const teacher = await db.student.create({
        data: { studentId: `t-${suffix}`, displayName: "Org Teacher", role: "teacher", passwordHash: "x" },
      });
      ids.teacher = teacher.id;
      // A student-role row on a class instructor link must not be backfilled.
      const notTeacher = await db.student.create({
        data: { studentId: `s-${suffix}`, displayName: "Org Student", role: "student", passwordHash: "x" },
      });
      ids.studentLike = notTeacher.id;
      const classA = await db.spokesClass.create({
        data: { name: `Class A ${suffix}`, code: `CA-${suffix}`, regionId: region.id },
      });
      const classNoRegion = await db.spokesClass.create({
        data: { name: `Class 0 ${suffix}`, code: `C0-${suffix}` },
      });
      ids.classA = classA.id;
      ids.classNoRegion = classNoRegion.id;
      await db.spokesClassInstructor.createMany({
        data: [
          { classId: classA.id, instructorId: teacher.id },
          { classId: classNoRegion.id, instructorId: teacher.id },
          { classId: classA.id, instructorId: notTeacher.id },
        ],
      });
    });

    after(async () => {
      await db.regionInstructor.deleteMany({ where: { regionId: ids.regionA } });
      await db.spokesClass.deleteMany({ where: { id: { in: [ids.classA, ids.classNoRegion] } } });
      await db.student.deleteMany({ where: { id: { in: [ids.teacher, ids.studentLike] } } });
      await db.region.deleteMany({ where: { id: ids.regionA } });
      await db.$disconnect();
    });

    it("backfill gives each teacher the regions of the classes they teach", async () => {
      await db.regionInstructor.deleteMany({ where: { regionId: ids.regionA } });
      await db.$executeRawUnsafe(readBackfillSql("20261107110000_add_region_instructor"));
      // Running it twice must not fail or duplicate (ON CONFLICT DO NOTHING).
      await db.$executeRawUnsafe(readBackfillSql("20261107110000_add_region_instructor"));

      const rows = await db.regionInstructor.findMany({
        where: { instructorId: { in: [ids.teacher, ids.studentLike] } },
        select: { regionId: true, instructorId: true },
      });
      assert.deepEqual(rows, [{ regionId: ids.regionA, instructorId: ids.teacher }]);
    });

    it("a teacher reads only their own RegionInstructor rows", async () => {
      const rows = await asRole("teacher", ids.teacher, (tx) =>
        tx.regionInstructor.findMany({ where: { regionId: ids.regionA } }),
      );
      assert.equal(rows.length, 1);
      const other = await asRole("teacher", ids.studentLike, (tx) =>
        tx.regionInstructor.findMany({ where: { regionId: ids.regionA } }),
      );
      assert.equal(other.length, 0);
    });
  });
}
