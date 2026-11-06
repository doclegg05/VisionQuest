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


  /** Ids for the tree fixtures. Region A holds class CA, region B holds CB, CN has no region. */
  interface Tree {
    regionA: string; regionB: string;
    classA: string; classB: string; classN: string;
    SA: string; SB: string; SN: string;
    TA: string; TB: string; TX: string;
    KA: string; KB: string; K0: string; P: string;
  }

  /**
   * Fixtures: SA, SB, SN enrolled one per class. TA instructs CA, TB instructs
   * CB. KA coordinates A, KB coordinates B, K0 coordinates nothing, P is the
   * program coordinator. TX is a teacher-role user holding a stale
   * RegionCoordinator row for A.
   */
  async function seedTree(db: PrismaClient, suffix: string): Promise<Tree> {
    const region = (code: string) =>
      db.region.create({ data: { name: `${code} ${suffix}`, code: `${code}-${suffix}` }, select: { id: true } });
    const regionA = (await region("A")).id;
    const regionB = (await region("B")).id;
    const mkClass = async (code: string, regionId: string | null) =>
      (await db.spokesClass.create({ data: { name: `${code} ${suffix}`, code: `${code}-${suffix}`, regionId } })).id;
    const user = async (key: string, role: AppRole) => (await createUser(db, `${key}-${suffix}`, role)).id;
    const t: Tree = {
      regionA, regionB,
      classA: await mkClass("CA", regionA), classB: await mkClass("CB", regionB), classN: await mkClass("CN", null),
      SA: await user("sa", "student"), SB: await user("sb", "student"), SN: await user("sn", "student"),
      TA: await user("ta", "teacher"), TB: await user("tb", "teacher"), TX: await user("tx", "teacher"),
      KA: await user("ka", "coordinator"), KB: await user("kb", "coordinator"), K0: await user("k0", "coordinator"),
      P: await user("p", "program_coordinator"),
    };
    await db.studentClassEnrollment.createMany({
      data: [
        { classId: t.classA, studentId: t.SA },
        { classId: t.classB, studentId: t.SB },
        { classId: t.classN, studentId: t.SN },
      ],
    });
    await db.spokesClassInstructor.createMany({
      data: [{ classId: t.classA, instructorId: t.TA }, { classId: t.classB, instructorId: t.TB }],
    });
    await db.regionCoordinator.createMany({
      data: [
        { regionId: regionA, coordinatorId: t.KA },
        { regionId: regionB, coordinatorId: t.KB },
        { regionId: regionA, coordinatorId: t.TX },
      ],
    });
    await db.regionInstructor.createMany({
      data: [{ regionId: regionA, instructorId: t.TA }, { regionId: regionB, instructorId: t.TB }],
    });
    return t;
  }

  interface TranscriptIds { memoryFrom: string; wagerId: string; operationId: string }

  /** One row of chat transcript (or text derived from it) per covered table, all for SA. */
  async function seedTranscriptRows(db: PrismaClient, t: Tree, suffix: string): Promise<TranscriptIds> {
    const conversation = await db.conversation.create({
      data: { studentId: t.SA, module: "goal", stage: "discovery", summary: "summary" },
    });
    await db.message.create({
      data: { conversationId: conversation.id, studentId: t.SA, role: "user", content: "hi" },
    });
    await db.sageInsight.create({ data: { studentId: t.SA, category: "context", content: "x" } });
    const memory = async (sourceHash: string) =>
      (await db.sageMemory.create({
        data: {
          subjectType: "student", subjectId: t.SA, kind: "semantic", content: "x",
          category: "other", sourceType: "conversation", sourceHash,
        },
      })).id;
    const memoryFrom = await memory(`h1-${suffix}`);
    const memoryTo = await memory(`h2-${suffix}`);
    await db.sageMemoryEdge.create({ data: { fromId: memoryFrom, toId: memoryTo, predicate: "relates_to", evidence: "x" } });
    await db.moodEntry.create({ data: { studentId: t.SA, score: 5, source: "chat", context: "x" } });
    await db.careerDiscovery.create({ data: { studentId: t.SA, sageSummary: "x" } });
    await db.failedExtraction.create({
      data: { studentId: t.SA, extractorKey: "goal_extraction", payload: "x", error: "e", attempts: 3 },
    });
    await db.sagePanel.create({ data: { studentId: t.SA, panelDate: new Date("2026-11-07"), spec: {} } });
    await db.studentAlert.create({
      data: { studentId: t.SA, alertKey: `alert-${suffix}`, type: "wellbeing_concern", title: "x", summary: "x" },
    });
    await db.fileUpload.create({
      data: { studentId: t.SA, filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, storageKey: `f-${suffix}` },
    });
    return { memoryFrom, ...(await seedWagerAndOperation(db, t, suffix)) };
  }

  async function seedWagerAndOperation(
    db: PrismaClient,
    t: Tree,
    suffix: string,
  ): Promise<{ wagerId: string; operationId: string }> {
    const wager = await db.wager.create({
      data: {
        studentId: t.SA, wagerType: "goal", targetType: "goal", targetId: "g",
        hypothesis: "x", predictedOutcome: "x", horizonAt: new Date("2026-12-01"),
      },
    });
    await db.wagerVerdict.create({
      data: { wagerId: wager.id, outcome: "lost", result: "x", resolvedBy: "system", evidence: {}, diagnosis: "x" },
    });
    const operationId = `op-${suffix}`;
    await db.sageOperation.create({
      data: {
        id: operationId, actorType: "student", actorId: t.SA, targetStudentId: t.SA,
        toolName: "propose_goal", status: "proposed", payload: { text: "x" },
      },
    });
    return { wagerId: wager.id, operationId };
  }

  interface WriteTargets { goalId: string; consentId: string; spokesRecordId: string; programDocumentId: string }

  /** Rows a coordinator could reach through a teacher write branch, all about SA. */
  async function seedWriteTargets(db: PrismaClient, t: Tree, suffix: string): Promise<WriteTargets> {
    const goal = await db.goal.create({ data: { studentId: t.SA, level: "daily", content: "x" } });
    const consent = await db.consentRecord.create({ data: { studentId: t.SA, scope: "x", recordedBy: t.TA } });
    const record = await db.spokesRecord.create({ data: { firstName: "x", lastName: "y", studentId: t.SA } });
    const doc = await db.programDocument.create({
      data: { title: "x", storageKey: `doc-${suffix}`, category: "ORIENTATION" },
    });
    return { goalId: goal.id, consentId: consent.id, spokesRecordId: record.id, programDocumentId: doc.id };
  }

  describe("org tree: managed_student_ids, classes, transcripts and writes (integration)", () => {
    const db = new PrismaClient();
    const asRole = asRoleOn(db);
    const suffix = `orgtree-rls-${Date.now()}`;
    let t: Tree;
    let ids: TranscriptIds;
    let targets: WriteTargets;
    const fixtureIds = (): string[] => [t.SA, t.SB, t.SN];
    const classIds = (): string[] => [t.classA, t.classB, t.classN];
    const RLS_REFUSED = /row-level security|42501/;

    before(async () => {
      t = await seedTree(db, suffix);
      ids = await seedTranscriptRows(db, t, suffix);
      targets = await seedWriteTargets(db, t, suffix);
    });

    after(async () => {
      await db.sageOperation.deleteMany({ where: { id: ids.operationId } });
      await db.sageMemory.deleteMany({ where: { subjectId: { in: [t.SA, t.KA] } } });
      await db.spokesRecord.deleteMany({ where: { id: targets.spokesRecordId } });
      await db.programDocument.deleteMany({ where: { id: targets.programDocumentId } });
      await db.spokesClass.deleteMany({ where: { id: { in: classIds() } } });
      await db.student.deleteMany({
        where: { id: { in: [t.SA, t.SB, t.SN, t.TA, t.TB, t.TX, t.KA, t.KB, t.K0, t.P] } },
      });
      await db.region.deleteMany({ where: { id: { in: [t.regionA, t.regionB] } } });
      await db.$disconnect();
    });

    async function visibleStudents(role: RlsRole, userId: string): Promise<string[]> {
      const rows = await asRole(role, userId, (tx) =>
        tx.student.findMany({ where: { role: "student", id: { in: fixtureIds() } }, select: { id: true } }),
      );
      return rows.map((r) => r.id).sort();
    }

    async function visibleClasses(userId: string): Promise<string[]> {
      const rows = await asRole("teacher", userId, (tx) =>
        tx.spokesClass.findMany({ where: { id: { in: classIds() } }, select: { id: true } }),
      );
      return rows.map((r) => r.id).sort();
    }

    async function visibleEnrollments(userId: string): Promise<string[]> {
      const rows = await asRole("teacher", userId, (tx) =>
        tx.studentClassEnrollment.findMany({ where: { classId: { in: classIds() } }, select: { studentId: true } }),
      );
      return rows.map((r) => r.studentId).sort();
    }

    function countConversations(role: RlsRole, userId: string): Promise<number> {
      return asRole(role, userId, (tx) => tx.conversation.count({ where: { studentId: t.SA } }));
    }

    // ---- Students (managed_student_ids) ----

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

    it("a teacher-role user with a stale RegionCoordinator row reaches nobody in that region", async () => {
      assert.deepEqual(await visibleStudents("teacher", t.TX), []);
      assert.deepEqual(await visibleClasses(t.TX), []);
      assert.equal(await countConversations("teacher", t.TX), 0);
    });

    it("removing the region row removes access on the next query", async () => {
      await db.regionCoordinator.delete({
        where: { regionId_coordinatorId: { regionId: t.regionA, coordinatorId: t.KA } },
      });
      try {
        assert.deepEqual(await visibleStudents("teacher", t.KA), []);
        assert.deepEqual(await visibleClasses(t.KA), []);
      } finally {
        // Restore so the cases below still exercise a coordinator who CAN reach SA.
        await db.regionCoordinator.create({ data: { regionId: t.regionA, coordinatorId: t.KA } });
      }
    });

    // ---- Classes, enrollments and region assignments (instructor_class_ids) ----

    it("a regional coordinator reads their region's class and its enrollments, not another region's", async () => {
      assert.deepEqual(await visibleClasses(t.KA), [t.classA]);
      assert.deepEqual(await visibleEnrollments(t.KA), [t.SA]);
    });

    it("a program coordinator reads every class and enrollment, the unregioned class included", async () => {
      assert.deepEqual(await visibleClasses(t.P), classIds().sort());
      assert.deepEqual(await visibleEnrollments(t.P), [t.SA, t.SB, t.SN].sort());
    });

    it("a coordinator with no region reads no class and no enrollment", async () => {
      assert.deepEqual(await visibleClasses(t.K0), []);
      assert.deepEqual(await visibleEnrollments(t.K0), []);
    });

    it("an instructor still reads exactly the class they teach", async () => {
      assert.deepEqual(await visibleClasses(t.TA), [t.classA]);
      assert.deepEqual(await visibleEnrollments(t.TA), [t.SA]);
    });

    it("a region-filtered student query returns SA for KA", async () => {
      const rows = await asRole("teacher", t.KA, (tx) =>
        tx.student.findMany({
          where: {
            role: "student",
            id: { in: fixtureIds() },
            classEnrollments: { some: { class: { region: { coordinators: { some: { coordinatorId: t.KA } } } } } },
          },
          select: { id: true },
        }),
      );
      assert.deepEqual(rows.map((r) => r.id), [t.SA]);
    });

    it("coordinators read their own RegionCoordinator rows; a program coordinator reads all", async () => {
      const read = (userId: string) =>
        asRole("teacher", userId, (tx) =>
          tx.regionCoordinator.findMany({
            where: { regionId: { in: [t.regionA, t.regionB] } },
            select: { coordinatorId: true },
          }),
        ).then((rows) => rows.map((r) => r.coordinatorId).sort());
      assert.deepEqual(await read(t.KA), [t.KA]);
      assert.deepEqual(await read(t.K0), []);
      assert.deepEqual(await read(t.P), [t.KA, t.KB, t.TX].sort());
    });

    it("coordinators read RegionInstructor rows in their regions; a program coordinator reads all", async () => {
      const read = (userId: string) =>
        asRole("teacher", userId, (tx) =>
          tx.regionInstructor.findMany({
            where: { regionId: { in: [t.regionA, t.regionB] } },
            select: { instructorId: true },
          }),
        ).then((rows) => rows.map((r) => r.instructorId).sort());
      assert.deepEqual(await read(t.KA), [t.TA]);
      assert.deepEqual(await read(t.K0), []);
      assert.deepEqual(await read(t.P), [t.TA, t.TB].sort());
    });

    // ---- Instructor links (SpokesClassInstructor) ----

    async function visibleInstructorLinks(userId: string): Promise<string[]> {
      const rows = await asRole("teacher", userId, (tx) =>
        tx.spokesClassInstructor.findMany({
          where: { classId: { in: classIds() } },
          select: { classId: true, instructorId: true },
        }),
      );
      return rows.map((r) => `${r.classId}:${r.instructorId}`).sort();
    }

    it("a regional coordinator reads their region's instructor links, not another region's", async () => {
      assert.deepEqual(await visibleInstructorLinks(t.KA), [`${t.classA}:${t.TA}`]);
    });

    it("a program coordinator reads every instructor link", async () => {
      assert.deepEqual(
        await visibleInstructorLinks(t.P),
        [`${t.classA}:${t.TA}`, `${t.classB}:${t.TB}`].sort(),
      );
    });

    it("a coordinator with no region reads no instructor link", async () => {
      assert.deepEqual(await visibleInstructorLinks(t.K0), []);
    });

    it("an instructor still reads their own instructor links", async () => {
      assert.deepEqual(await visibleInstructorLinks(t.TA), [`${t.classA}:${t.TA}`]);
    });

    // ---- Class creation (Ruling R19) ----

    it("a teacher's RLS insert of a new class is refused, which is why class creation writes through prismaAdmin", async () => {
      // spokes_class_access WITH CHECK needs the class in instructor_class_ids(me),
      // and no SpokesClassInstructor row can exist before the class does. Moving
      // POST /api/teacher/classes back to the RLS client would fail every create.
      await assert.rejects(
        asRole("teacher", t.TA, (tx) =>
          tx.spokesClass.createMany({
            data: [{ name: `New ${suffix}`, code: `NEW-${suffix}`, regionId: t.regionA }],
          }),
        ),
        RLS_REFUSED,
      );
      assert.equal(await db.spokesClass.count({ where: { code: `NEW-${suffix}` } }), 0);
    });

    // ---- Transcript tables ----

    it("coordinator reads no conversation rows", async () => {
      assert.deepEqual(await visibleStudents("teacher", t.KA), [t.SA], "KA must reach SA for this to mean anything");
      assert.equal(await countConversations("teacher", t.KA), 0);
    });

    it("a coordinator still reads and writes their own staff Sage conversation", async () => {
      const own = await asRole("teacher", t.KA, async (tx) => {
        const conversation = await tx.conversation.create({
          data: { studentId: t.KA, module: "teacher_assistant", stage: "teacher_assistant" },
        });
        const written = await tx.message.createMany({
          data: [{ conversationId: conversation.id, studentId: t.KA, role: "user", content: "hi" }],
        });
        assert.equal(written.count, 1);
        return tx.message.count({ where: { studentId: t.KA } });
      });
      assert.equal(own, 1);
    });

    it("a coordinator cannot write a transcript row for a student they reach", async () => {
      await assert.rejects(
        asRole("teacher", t.KA, (tx) =>
          tx.conversation.createMany({ data: [{ studentId: t.SA, module: "goal", stage: "discovery" }] }),
        ),
        RLS_REFUSED,
      );
    });

    const transcriptTables: ReadonlyArray<{ table: string; count: (tx: Tx) => Promise<number> }> = [
      { table: "Conversation", count: (tx) => tx.conversation.count({ where: { studentId: t.SA } }) },
      { table: "Message", count: (tx) => tx.message.count({ where: { studentId: t.SA } }) },
      { table: "SageInsight", count: (tx) => tx.sageInsight.count({ where: { studentId: t.SA } }) },
      { table: "SageMemory", count: (tx) => tx.sageMemory.count({ where: { subjectId: t.SA } }) },
      { table: "SageMemoryEdge", count: (tx) => tx.sageMemoryEdge.count({ where: { fromId: ids.memoryFrom } }) },
      { table: "MoodEntry", count: (tx) => tx.moodEntry.count({ where: { studentId: t.SA } }) },
      { table: "CareerDiscovery", count: (tx) => tx.careerDiscovery.count({ where: { studentId: t.SA } }) },
      { table: "FailedExtraction", count: (tx) => tx.failedExtraction.count({ where: { studentId: t.SA } }) },
      { table: "SagePanel", count: (tx) => tx.sagePanel.count({ where: { studentId: t.SA } }) },
      { table: "WagerVerdict", count: (tx) => tx.wagerVerdict.count({ where: { wagerId: ids.wagerId } }) },
      { table: "SageOperation", count: (tx) => tx.sageOperation.count({ where: { id: ids.operationId } }) },
      { table: "StudentAlert", count: (tx) => tx.studentAlert.count({ where: { studentId: t.SA } }) },
      { table: "FileUpload", count: (tx) => tx.fileUpload.count({ where: { studentId: t.SA } }) },
    ];

    for (const { table, count } of transcriptTables) {
      it(`${table}: tree readers read zero rows, the student's teacher still reads it`, async () => {
        assert.equal(await asRole("teacher", t.KA, count), 0, "regional coordinator");
        assert.equal(await asRole("teacher", t.P, count), 0, "program coordinator");
        assert.ok((await asRole("teacher", t.TA, count)) >= 1, "instructor of the student");
      });
    }

    // ---- Writes (ruling R8). updateMany/deleteMany report 0 rows under a
    // USING refusal; createMany throws under a WITH CHECK refusal. ----

    const updates: ReadonlyArray<{ table: string; update: (tx: Tx) => Promise<{ count: number }> }> = [
      { table: "Student", update: (tx) => tx.student.updateMany({ where: { id: t.SA }, data: { displayName: "Org student" } }) },
      { table: "ConsentRecord", update: (tx) => tx.consentRecord.updateMany({ where: { id: targets.consentId }, data: { scope: "y" } }) },
      { table: "Goal", update: (tx) => tx.goal.updateMany({ where: { id: targets.goalId }, data: { content: "y" } }) },
      { table: "SpokesRecord", update: (tx) => tx.spokesRecord.updateMany({ where: { id: targets.spokesRecordId }, data: { lastName: "z" } }) },
      { table: "ProgramDocument", update: (tx) => tx.programDocument.updateMany({ where: { id: targets.programDocumentId }, data: { title: "y" } }) },
    ];

    for (const { table, update } of updates) {
      it(`${table}: tree readers update zero rows, the student's teacher still updates it`, async () => {
        assert.equal((await asRole("teacher", t.KA, update)).count, 0, "regional coordinator");
        assert.equal((await asRole("teacher", t.P, update)).count, 0, "program coordinator");
        assert.equal((await asRole("teacher", t.TA, update)).count, 1, "instructor of the student");
      });
    }

    const inserts: ReadonlyArray<{ table: string; insert: (tx: Tx) => Promise<unknown> }> = [
      { table: "ConsentRecord", insert: (tx) => tx.consentRecord.createMany({ data: [{ studentId: t.SA, scope: "z", recordedBy: t.KA }] }) },
      { table: "Goal", insert: (tx) => tx.goal.createMany({ data: [{ studentId: t.SA, level: "daily", content: "z" }] }) },
      { table: "SpokesRecord", insert: (tx) => tx.spokesRecord.createMany({ data: [{ firstName: "a", lastName: "b", studentId: t.SA }] }) },
      { table: "ProgramDocument", insert: (tx) => tx.programDocument.createMany({ data: [{ title: "z", storageKey: `doc2-${suffix}`, category: "ORIENTATION" }] }) },
    ];

    for (const { table, insert } of inserts) {
      it(`${table}: tree readers cannot insert a row the teacher branch would admit`, async () => {
        await assert.rejects(asRole("teacher", t.KA, insert), RLS_REFUSED, "regional coordinator");
        await assert.rejects(asRole("teacher", t.P, insert), RLS_REFUSED, "program coordinator");
      });
    }

    it("tree readers delete nothing they reach", async () => {
      const remove = (tx: Tx) => tx.goal.deleteMany({ where: { id: targets.goalId } });
      assert.equal((await asRole("teacher", t.KA, remove)).count, 0);
      assert.equal((await asRole("teacher", t.P, remove)).count, 0);
      assert.equal(await db.goal.count({ where: { id: targets.goalId } }), 1);
    });

    it("a coordinator can still update their own Student row", async () => {
      const own = await asRole("teacher", t.KA, (tx) =>
        tx.student.updateMany({ where: { id: t.KA }, data: { displayName: "Org coordinator" } }),
      );
      assert.equal(own.count, 1);
    });
  });

  describe("org tree: StaffInvite (integration)", () => {
    const db = new PrismaClient();
    const asRole = asRoleOn(db);
    const suffix = `orgtree-si-${Date.now()}`;
    const ids = { admin: "", teacher: "", coordinator: "", student: "", invite: "" };

    before(async () => {
      ids.admin = (await createUser(db, `a-${suffix}`, "teacher")).id;
      ids.teacher = (await createUser(db, `t-${suffix}`, "teacher")).id;
      ids.coordinator = (await createUser(db, `c-${suffix}`, "coordinator")).id;
      ids.student = (await createUser(db, `s-${suffix}`, "student")).id;
      const invite = await db.staffInvite.create({
        data: {
          email: `invite-${suffix}@example.test`,
          role: "teacher",
          invitedById: ids.admin,
          tokenHash: `hash-${suffix}`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      ids.invite = invite.id;
    });

    after(async () => {
      await db.staffInvite.deleteMany({ where: { tokenHash: { startsWith: `hash-${suffix}` } } });
      await db.student.deleteMany({
        where: { id: { in: [ids.admin, ids.teacher, ids.coordinator, ids.student] } },
      });
      await db.$disconnect();
    });

    it("an admin reads a seeded StaffInvite row", async () => {
      const rows = await asRole("admin", ids.admin, (tx) =>
        tx.staffInvite.findMany({ where: { id: ids.invite } }),
      );
      assert.equal(rows.length, 1);
    });

    it("teacher, coordinator and student read zero StaffInvite rows", async () => {
      const read = (tx: Tx) => tx.staffInvite.findMany({ where: { id: ids.invite } });
      assert.equal((await asRole("teacher", ids.teacher, read)).length, 0);
      // Coordinators map onto the teacher RLS role.
      assert.equal((await asRole("teacher", ids.coordinator, read)).length, 0);
      assert.equal((await asRole("student", ids.student, read)).length, 0);
    });

    it("a teacher cannot write a StaffInvite row", async () => {
      await assert.rejects(
        asRole("teacher", ids.teacher, (tx) =>
          tx.staffInvite.createMany({
            data: [
              {
                email: `blocked-${suffix}@example.test`,
                role: "teacher",
                invitedById: ids.teacher,
                tokenHash: `hash-${suffix}-blocked`,
                expiresAt: new Date(Date.now() + 60 * 60 * 1000),
              },
            ],
          }),
        ),
      );
      assert.equal(await db.staffInvite.count({ where: { tokenHash: `hash-${suffix}-blocked` } }), 0);
    });
  });
}
