/**
 * Organization-tree database tests (RegionInstructor, managed_student_ids,
 * and the is_tree_reader transcript restriction).
 *
 * Opt-in like rls.test.ts: set RLS_TEST_ENABLED=true and point DATABASE_URL at
 * a migrated, non-production Postgres. Without both, the file registers one
 * passing placeholder and touches no database.
 *
 *   RLS_TEST_ENABLED=true DATABASE_URL=postgres://...rls-test... \
 *     node --import tsx --test src/lib/org-tree-rls.test.ts
 *
 * Each describe creates its own fixtures in `before` and removes them in
 * `after`, scoped by a per-run suffix, so no case depends on another.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";

/** The RLS role GUC. App roles (coordinator, program_coordinator) map onto these. */
type RlsRole = "student" | "teacher" | "admin";
/** Student.role values the fixtures use. */
type AppRole = "student" | "teacher" | "coordinator" | "program_coordinator";
type Tx = Prisma.TransactionClient;

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

/** Run `fn` as `vq_app` with the RLS GUCs set, like rls.test.ts. */
function asRoleOn(db: PrismaClient) {
  return function asRole<T>(role: RlsRole, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE vq_app`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_user_id', $1, true)`, userId);
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_role', $1, true)`, role);
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_student_id', $1, true)`,
        role === "student" ? userId : "",
      );
      return fn(tx);
    });
  };
}

function createUser(db: PrismaClient, key: string, role: AppRole): Promise<{ id: string }> {
  return db.student.create({
    data: { studentId: key, displayName: `Org ${role}`, role, passwordHash: "x" },
    select: { id: true },
  });
}

if (!SHOULD_RUN) {
  describe("org tree (integration) - SKIPPED", () => {
    it("requires RLS_TEST_ENABLED=true and DATABASE_URL pointing at a test DB", () => {
      assert.ok(true);
    });
  });
} else {
  describe("org tree: RegionInstructor (integration)", () => {
    const db = new PrismaClient();
    const asRole = asRoleOn(db);
    const suffix = `orgtree-ri-${Date.now()}`;
    const ids = { regionA: "", teacher: "", studentLike: "", classA: "", classNoRegion: "" };

    before(async () => {
      const region = await db.region.create({
        data: { name: `Region ${suffix}`, code: `R-${suffix}` },
      });
      ids.regionA = region.id;
      ids.teacher = (await createUser(db, `t-${suffix}`, "teacher")).id;
      // A student-role row on a class instructor link must not be backfilled.
      ids.studentLike = (await createUser(db, `s-${suffix}`, "student")).id;
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
          { classId: classA.id, instructorId: ids.teacher },
          { classId: classNoRegion.id, instructorId: ids.teacher },
          { classId: classA.id, instructorId: ids.studentLike },
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
      // Seed the row here so this case does not depend on the backfill case.
      await db.regionInstructor.createMany({
        data: [{ regionId: ids.regionA, instructorId: ids.teacher }],
        skipDuplicates: true,
      });
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

  describe("org tree: managed_student_ids and transcript tables (integration)", () => {
    const db = new PrismaClient();
    const asRole = asRoleOn(db);
    const suffix = `orgtree-rls-${Date.now()}`;
    const t = {
      regionA: "", regionB: "",
      classA: "", classB: "", classN: "",
      SA: "", SB: "", SN: "",
      TA: "", KA: "", K0: "", P: "",
      operationId: `op-${suffix}`,
      memoryFrom: "", wagerId: "",
    };
    const fixtureIds = (): string[] => [t.SA, t.SB, t.SN];

    async function seedTree(): Promise<void> {
      t.regionA = (await db.region.create({ data: { name: `A ${suffix}`, code: `A-${suffix}` } })).id;
      t.regionB = (await db.region.create({ data: { name: `B ${suffix}`, code: `B-${suffix}` } })).id;
      const mkClass = (code: string, regionId: string | null) =>
        db.spokesClass.create({ data: { name: `${code} ${suffix}`, code: `${code}-${suffix}`, regionId } });
      t.classA = (await mkClass("CA", t.regionA)).id;
      t.classB = (await mkClass("CB", t.regionB)).id;
      t.classN = (await mkClass("CN", null)).id;
      t.SA = (await createUser(db, `sa-${suffix}`, "student")).id;
      t.SB = (await createUser(db, `sb-${suffix}`, "student")).id;
      t.SN = (await createUser(db, `sn-${suffix}`, "student")).id;
      t.TA = (await createUser(db, `ta-${suffix}`, "teacher")).id;
      t.KA = (await createUser(db, `ka-${suffix}`, "coordinator")).id;
      t.K0 = (await createUser(db, `k0-${suffix}`, "coordinator")).id;
      t.P = (await createUser(db, `p-${suffix}`, "program_coordinator")).id;
      await db.studentClassEnrollment.createMany({
        data: [
          { classId: t.classA, studentId: t.SA },
          { classId: t.classB, studentId: t.SB },
          { classId: t.classN, studentId: t.SN },
        ],
      });
      await db.spokesClassInstructor.create({ data: { classId: t.classA, instructorId: t.TA } });
      await db.regionCoordinator.create({ data: { regionId: t.regionA, coordinatorId: t.KA } });
    }

    /** One row of chat transcript (or text derived from it) per covered table, all for SA. */
    async function seedTranscriptRows(): Promise<void> {
      const conversation = await db.conversation.create({
        data: { studentId: t.SA, module: "goal", stage: "discovery", summary: "summary" },
      });
      await db.message.create({
        data: { conversationId: conversation.id, studentId: t.SA, role: "user", content: "hi" },
      });
      await db.sageInsight.create({ data: { studentId: t.SA, category: "context", content: "x" } });
      const memory = (subjectId: string, sourceHash: string) =>
        db.sageMemory.create({
          data: {
            subjectType: "student", subjectId, kind: "semantic", content: "x",
            category: "other", sourceType: "conversation", sourceHash,
          },
        });
      t.memoryFrom = (await memory(t.SA, `h1-${suffix}`)).id;
      const memoryTo = (await memory(t.SA, `h2-${suffix}`)).id;
      await db.sageMemoryEdge.create({
        data: { fromId: t.memoryFrom, toId: memoryTo, predicate: "relates_to", evidence: "x" },
      });
      await db.moodEntry.create({ data: { studentId: t.SA, score: 5, source: "chat", context: "x" } });
      await db.careerDiscovery.create({ data: { studentId: t.SA, sageSummary: "x" } });
      await db.failedExtraction.create({
        data: { studentId: t.SA, extractorKey: "goal_extraction", payload: "x", error: "e", attempts: 3 },
      });
      await db.sagePanel.create({ data: { studentId: t.SA, panelDate: new Date("2026-11-07"), spec: {} } });
      await seedWagerAndOperation();
    }

    async function seedWagerAndOperation(): Promise<void> {
      const wager = await db.wager.create({
        data: {
          studentId: t.SA, wagerType: "goal", targetType: "goal", targetId: "g",
          hypothesis: "x", predictedOutcome: "x", horizonAt: new Date("2026-12-01"),
        },
      });
      t.wagerId = wager.id;
      await db.wagerVerdict.create({
        data: { wagerId: wager.id, outcome: "lost", result: "x", resolvedBy: "system", evidence: {}, diagnosis: "x" },
      });
      await db.sageOperation.create({
        data: {
          id: t.operationId, actorType: "student", actorId: t.SA, targetStudentId: t.SA,
          toolName: "propose_goal", status: "proposed", payload: { text: "x" },
        },
      });
    }

    before(async () => {
      await seedTree();
      await seedTranscriptRows();
    });

    after(async () => {
      await db.sageOperation.deleteMany({ where: { id: t.operationId } });
      await db.sageMemory.deleteMany({ where: { subjectId: { in: [t.SA, t.KA] } } });
      await db.spokesClass.deleteMany({ where: { id: { in: [t.classA, t.classB, t.classN] } } });
      await db.student.deleteMany({ where: { id: { in: [t.SA, t.SB, t.SN, t.TA, t.KA, t.K0, t.P] } } });
      await db.region.deleteMany({ where: { id: { in: [t.regionA, t.regionB] } } });
      await db.$disconnect();
    });

    async function visibleStudents(role: RlsRole, userId: string): Promise<string[]> {
      const rows = await asRole(role, userId, (tx) =>
        tx.student.findMany({ where: { role: "student", id: { in: fixtureIds() } }, select: { id: true } }),
      );
      return rows.map((r) => r.id).sort();
    }

    function countConversations(role: RlsRole, userId: string): Promise<number> {
      return asRole(role, userId, (tx) => tx.conversation.count({ where: { studentId: t.SA } }));
    }

    it("teacher sees only their class", async () => {
      assert.deepEqual(await visibleStudents("teacher", t.TA), [t.SA]);
    });

    it("regional coordinator sees region A only", async () => {
      assert.deepEqual(await visibleStudents("teacher", t.KA), [t.SA]);
    });

    it("coordinator with no region sees nobody", async () => {
      assert.deepEqual(await visibleStudents("teacher", t.K0), []);
    });

    it("program coordinator sees all three", async () => {
      assert.deepEqual(await visibleStudents("teacher", t.P), [t.SA, t.SB, t.SN].sort());
    });

    it("removing the region row removes access on the next query", async () => {
      await db.regionCoordinator.delete({
        where: { regionId_coordinatorId: { regionId: t.regionA, coordinatorId: t.KA } },
      });
      try {
        assert.deepEqual(await visibleStudents("teacher", t.KA), []);
      } finally {
        // Restore so the cases below still exercise a coordinator who CAN reach SA.
        await db.regionCoordinator.create({ data: { regionId: t.regionA, coordinatorId: t.KA } });
      }
    });

    it("coordinator reads no conversation rows", async () => {
      assert.deepEqual(await visibleStudents("teacher", t.KA), [t.SA], "KA must reach SA for this to mean anything");
      assert.equal(await countConversations("teacher", t.KA), 0);
    });

    it("a coordinator still reads and writes their own staff Sage conversation", async () => {
      const own = await asRole("teacher", t.KA, async (tx) => {
        const conversation = await tx.conversation.create({
          data: { studentId: t.KA, module: "teacher_assistant", stage: "teacher_assistant" },
        });
        await tx.message.create({
          data: { conversationId: conversation.id, studentId: t.KA, role: "user", content: "hi" },
        });
        return tx.message.count({ where: { studentId: t.KA } });
      });
      assert.equal(own, 1);
    });

    it("a coordinator cannot write a transcript row for a student they reach", async () => {
      await assert.rejects(
        asRole("teacher", t.KA, (tx) =>
          tx.conversation.createMany({ data: [{ studentId: t.SA, module: "goal", stage: "discovery" }] }),
        ),
        /row-level security|42501/,
      );
    });

    const transcriptTables: ReadonlyArray<{ table: string; count: (tx: Tx) => Promise<number> }> = [
      { table: "Conversation", count: (tx) => tx.conversation.count({ where: { studentId: t.SA } }) },
      { table: "Message", count: (tx) => tx.message.count({ where: { studentId: t.SA } }) },
      { table: "SageInsight", count: (tx) => tx.sageInsight.count({ where: { studentId: t.SA } }) },
      { table: "SageMemory", count: (tx) => tx.sageMemory.count({ where: { subjectId: t.SA } }) },
      { table: "SageMemoryEdge", count: (tx) => tx.sageMemoryEdge.count({ where: { fromId: t.memoryFrom } }) },
      { table: "MoodEntry", count: (tx) => tx.moodEntry.count({ where: { studentId: t.SA } }) },
      { table: "CareerDiscovery", count: (tx) => tx.careerDiscovery.count({ where: { studentId: t.SA } }) },
      { table: "FailedExtraction", count: (tx) => tx.failedExtraction.count({ where: { studentId: t.SA } }) },
      { table: "SagePanel", count: (tx) => tx.sagePanel.count({ where: { studentId: t.SA } }) },
      { table: "WagerVerdict", count: (tx) => tx.wagerVerdict.count({ where: { wagerId: t.wagerId } }) },
      { table: "SageOperation", count: (tx) => tx.sageOperation.count({ where: { id: t.operationId } }) },
    ];

    for (const { table, count } of transcriptTables) {
      it(`${table}: tree readers read zero rows, the student's teacher still reads it`, async () => {
        assert.equal(await asRole("teacher", t.KA, count), 0, "regional coordinator");
        assert.equal(await asRole("teacher", t.P, count), 0, "program coordinator");
        assert.ok((await asRole("teacher", t.TA, count)) >= 1, "instructor of the student");
      });
    }
  });
}
