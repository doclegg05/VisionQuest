/**
 * RLS policy integration tests — verifies that migration
 * `20260423120000_rls_policy_recovery` (now folded into the baseline) plus
 * `20260701141000_scope_sage_memory_teacher_rls` and
 * `20260820140000_tighten_sage_operation_read_rls` enforce the intended
 * access matrix when queries run as the `vq_app` role.
 *
 * Every case below is written so that loosening the policy it names turns
 * it red; the comment on each block says which loosening it guards against.
 *
 * Approach:
 *   Each test runs inside an interactive transaction where we
 *   `SET LOCAL ROLE vq_app` + populate the three `app.current_*` GUCs to
 *   simulate a specific caller (student, teacher, admin, or anonymous).
 *   Because the test DB still connects as `postgres` at the top level,
 *   fixture setup/teardown can use the same client — only the assertion
 *   queries inside `asRole()` are subject to RLS.
 *
 * Prerequisites (test is auto-skipped if missing):
 *   - DATABASE_URL points at a Postgres where migration
 *     `20260421020000_add_rls_role_and_helpers` and
 *     `20260423120000_rls_policy_recovery` have been applied.
 *   - RLS_TEST_ENABLED=true in the environment. Opt-in because this test
 *     writes real fixture rows to the configured DB. Do not run against
 *     production.
 *
 * Typical usage:
 *   RLS_TEST_ENABLED=true DATABASE_URL=postgres://...rls-test... \
 *     npx tsx --test src/lib/rls.test.ts
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * The roles `app.current_role` can carry. "coordinator" is included so the
 * fail-closed cases can actually assert it: a policy that names only student /
 * teacher / admin must return zero rows for it, and a test that could not
 * spell the role could not prove that.
 */
type Role = "student" | "teacher" | "admin" | "coordinator";

interface Fixtures {
  /** Per-run namespace; every synthetic id/key embeds it so cleanup is scoped to this run. */
  suffix: string;
  studentA: string;
  studentB: string;
  /** Enrolled in classBeta; managed by teacherB only. */
  studentC: string;
  teacher: string;
  /** Second teacher; instructs classBeta only. Never manages Student A or B. */
  teacherB: string;
  admin: string;
  classAlpha: string;
  classBeta: string;
  conversationA: string;
  conversationB: string;
  conversationC: string;
  goalA: string;
  goalB: string;
  caseNoteA: string;
  memoryA: string;
  memoryB: string;
  alertA: string;
  alertC: string;
  arcA: string;
  arcB: string;
  auditRow: string;
  /** actorType=student, actorId=A, targetStudentId=NULL (legacy self-service shape). */
  opStudentA: string;
  /** actorType=student, actorId=B, targetStudentId=NULL (legacy self-service shape). */
  opStudentB: string;
  /** actorType=teacher, actorId=teacher, targetStudentId=A (staff on-behalf-of). */
  opStaffOnA: string;
  /** actorType=teacher, actorId=teacherB, targetStudentId=C (staff on-behalf-of). */
  opStaffOnC: string;
}

const SHOULD_RUN = process.env.RLS_TEST_ENABLED === "true" && !!process.env.DATABASE_URL;

if (!SHOULD_RUN) {
  describe("rls policies (integration) — SKIPPED", () => {
    it("requires RLS_TEST_ENABLED=true and DATABASE_URL pointing at a test DB", () => {
      assert.ok(
        true,
        "Set RLS_TEST_ENABLED=true and point DATABASE_URL at a non-production DB with the policy-recovery migration applied.",
      );
    });
  });
} else {
  describe("rls policies (integration)", () => {
    const db = new PrismaClient();
    const fixtures: Fixtures = {
      suffix: "",
      studentA: "",
      studentB: "",
      studentC: "",
      teacher: "",
      teacherB: "",
      admin: "",
      classAlpha: "",
      classBeta: "",
      conversationA: "",
      conversationB: "",
      conversationC: "",
      goalA: "",
      goalB: "",
      caseNoteA: "",
      memoryA: "",
      memoryB: "",
      alertA: "",
      alertC: "",
      arcA: "",
      arcB: "",
      auditRow: "",
      opStudentA: "",
      opStudentB: "",
      opStaffOnA: "",
      opStaffOnC: "",
    };

    /**
     * Run `fn` inside a transaction with `vq_app` role and populated RLS
     * GUCs. `ROLE vq_app` is SET LOCAL so it automatically reverts at
     * transaction end. Returns whatever the callback returns.
     */
    async function asRole<T>(
      role: Role | null,
      userId: string | null,
      fn: (tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>,
    ): Promise<T> {
      return db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE vq_app`);
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_user_id', $1, true)`,
          userId ?? "",
        );
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_role', $1, true)`,
          role ?? "",
        );
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_student_id', $1, true)`,
          role === "student" ? (userId ?? "") : "",
        );
        return fn(tx);
      });
    }

    async function createFixtures(): Promise<void> {
      const suffix = `rlstest-${Date.now()}`;
      fixtures.suffix = suffix;

      const [sa, sb, t, a] = await Promise.all([
        db.student.create({
          data: {
            studentId: `sa-${suffix}`,
            displayName: "Student A",
            role: "student",
            passwordHash: "x",
          },
        }),
        db.student.create({
          data: {
            studentId: `sb-${suffix}`,
            displayName: "Student B",
            role: "student",
            passwordHash: "x",
          },
        }),
        db.student.create({
          data: {
            studentId: `t-${suffix}`,
            displayName: "Teacher One",
            role: "teacher",
            passwordHash: "x",
          },
        }),
        db.student.create({
          data: {
            studentId: `a-${suffix}`,
            displayName: "Admin One",
            role: "admin",
            passwordHash: "x",
          },
        }),
      ]);

      fixtures.studentA = sa.id;
      fixtures.studentB = sb.id;
      fixtures.teacher = t.id;
      fixtures.admin = a.id;

      const cls = await db.spokesClass.create({
        data: {
          name: `RLS Test Class ${suffix}`,
          code: `RLS-${suffix}`,
          status: "active",
        },
      });
      fixtures.classAlpha = cls.id;

      await db.spokesClassInstructor.create({
        data: { classId: cls.id, instructorId: t.id },
      });

      // Only Student A is enrolled in Teacher's class. Student B is unmanaged.
      await db.studentClassEnrollment.create({
        data: { classId: cls.id, studentId: sa.id, status: "active" },
      });

      const [convA, convB] = await Promise.all([
        db.conversation.create({
          data: {
            studentId: sa.id,
            module: "goal-setting",
            stage: "start",
            title: "A's chat",
          },
        }),
        db.conversation.create({
          data: {
            studentId: sb.id,
            module: "goal-setting",
            stage: "start",
            title: "B's chat",
          },
        }),
      ]);
      fixtures.conversationA = convA.id;
      fixtures.conversationB = convB.id;

      const [gA, gB] = await Promise.all([
        db.goal.create({
          data: { studentId: sa.id, level: "weekly", content: "A's goal" },
        }),
        db.goal.create({
          data: { studentId: sb.id, level: "weekly", content: "B's goal" },
        }),
      ]);
      fixtures.goalA = gA.id;
      fixtures.goalB = gB.id;

      const note = await db.caseNote.create({
        data: {
          studentId: sa.id,
          authorId: t.id,
          body: "Private note about Student A",
        },
      });
      fixtures.caseNoteA = note.id;

      const [memA, memB] = await Promise.all([
        db.sageMemory.create({
          data: {
            subjectType: "student",
            subjectId: sa.id,
            kind: "semantic",
            content: "Student A's memory",
            category: "goal",
            sourceType: "manual",
            sourceHash: `rlstest-hash-a-${suffix}`,
          },
        }),
        db.sageMemory.create({
          data: {
            subjectType: "student",
            subjectId: sb.id,
            kind: "semantic",
            content: "Student B's memory",
            category: "goal",
            sourceType: "manual",
            sourceHash: `rlstest-hash-b-${suffix}`,
          },
        }),
      ]);
      fixtures.memoryA = memA.id;
      fixtures.memoryB = memB.id;

      // ---- Second tenant: Teacher B instructs Class Beta; only Student C is
      // enrolled there. Teacher B therefore manages C and nobody else.
      const [tb, sc] = await Promise.all([
        db.student.create({
          data: {
            studentId: `tb-${suffix}`,
            displayName: "Teacher Two",
            role: "teacher",
            passwordHash: "x",
          },
        }),
        db.student.create({
          data: {
            studentId: `sc-${suffix}`,
            displayName: "Student C",
            role: "student",
            passwordHash: "x",
          },
        }),
      ]);
      fixtures.teacherB = tb.id;
      fixtures.studentC = sc.id;

      const clsB = await db.spokesClass.create({
        data: {
          name: `RLS Test Class Beta ${suffix}`,
          code: `RLSB-${suffix}`,
          status: "active",
        },
      });
      fixtures.classBeta = clsB.id;
      await db.spokesClassInstructor.create({
        data: { classId: clsB.id, instructorId: tb.id },
      });
      await db.studentClassEnrollment.create({
        data: { classId: clsB.id, studentId: sc.id, status: "active" },
      });

      const convC = await db.conversation.create({
        data: {
          studentId: sc.id,
          module: "goal-setting",
          stage: "start",
          title: "C's chat",
        },
      });
      fixtures.conversationC = convC.id;

      // ---- StudentAlert: one per tenant (A under Teacher, C under Teacher B).
      const alertBase = {
        type: "wellbeing_concern",
        severity: "critical",
        title: "Wellbeing check-in needed",
        summary: "rls fixture",
      };
      const [alertA, alertC] = await Promise.all([
        db.studentAlert.create({
          data: { studentId: sa.id, alertKey: `rlstest-alert-a-${suffix}`, ...alertBase },
        }),
        db.studentAlert.create({
          data: { studentId: sc.id, alertKey: `rlstest-alert-c-${suffix}`, ...alertBase },
        }),
      ]);
      fixtures.alertA = alertA.id;
      fixtures.alertC = alertC.id;

      // ---- CoachingArc: A (managed by Teacher) and B (unmanaged).
      const [arcA, arcB] = await Promise.all([
        db.coachingArc.create({ data: { studentId: sa.id, arcType: "standard_6week" } }),
        db.coachingArc.create({ data: { studentId: sb.id, arcType: "standard_6week" } }),
      ]);
      fixtures.arcA = arcA.id;
      fixtures.arcB = arcB.id;

      // ---- AuditLog: written as postgres (the prismaAdmin path audit.ts uses).
      // No FK to Student, so it is deleted explicitly in destroyFixtures.
      const audit = await db.auditLog.create({
        data: {
          actorId: t.id,
          actorRole: "teacher",
          action: "rls_test.fixture",
          targetType: "RlsTestFixture",
          targetId: suffix,
          summary: "rls fixture",
        },
      });
      fixtures.auditRow = audit.id;

      // ---- SageOperation: the four row shapes sage_operation_read
      // distinguishes. `id` has no default and there is no FK, so ids embed
      // the suffix and destroyFixtures deletes by it.
      fixtures.opStudentA = `rlstest-op-student-a-${suffix}`;
      fixtures.opStudentB = `rlstest-op-student-b-${suffix}`;
      fixtures.opStaffOnA = `rlstest-op-staff-on-a-${suffix}`;
      fixtures.opStaffOnC = `rlstest-op-staff-on-c-${suffix}`;
      const opBase = { toolName: "update_goal_status", status: "executed", payload: {} };
      await db.sageOperation.createMany({
        data: [
          // Legacy shape (pre-20260820120000): student actor, no target. Both
          // student rows use it so the teacher cases exercise the actor
          // branch of the CASE in both directions (A managed, B unmanaged).
          { id: fixtures.opStudentA, actorType: "student", actorId: sa.id, targetStudentId: null, ...opBase },
          { id: fixtures.opStudentB, actorType: "student", actorId: sb.id, targetStudentId: null, ...opBase },
          { id: fixtures.opStaffOnA, actorType: "teacher", actorId: t.id, targetStudentId: sa.id, ...opBase },
          { id: fixtures.opStaffOnC, actorType: "teacher", actorId: tb.id, targetStudentId: sc.id, ...opBase },
        ],
      });
    }

    async function destroyFixtures(): Promise<void> {
      // SageOperation and AuditLog have no FK to Student (ledger rows must
      // survive offboarding), so neither cascades. Delete by the per-run
      // namespace so a mid-test failure (e.g. the F17 createMany case) leaves
      // nothing behind either.
      await db.sageOperation.deleteMany({ where: { id: { contains: fixtures.suffix } } });
      await db.auditLog.deleteMany({
        where: { targetType: "RlsTestFixture", targetId: fixtures.suffix },
      });

      // SageMemory.subjectId is a polymorphic reference (no Prisma relation /
      // real FK to Student — see prisma/schema.prisma's SageMemory model), so
      // it does NOT cascade-delete when the fixture Student rows are removed
      // below. Clean it up explicitly first, or fixture rows accumulate as
      // orphans across test runs.
      await db.sageMemory.deleteMany({ where: { id: { in: [fixtures.memoryA, fixtures.memoryB] } } });

      // Cascades on Student delete clean up Conversation, Goal, CaseNote,
      // StudentClassEnrollment, etc. SpokesClassInstructor is covered by the
      // class delete cascade.
      await db.spokesClass.deleteMany({ where: { id: { in: [fixtures.classAlpha, fixtures.classBeta] } } });
      await db.student.deleteMany({
        where: {
          id: {
            in: [
              fixtures.studentA,
              fixtures.studentB,
              fixtures.studentC,
              fixtures.teacher,
              fixtures.teacherB,
              fixtures.admin,
            ],
          },
        },
      });
    }

    before(async () => {
      await createFixtures();
    });

    after(async () => {
      try {
        await destroyFixtures();
      } finally {
        await db.$disconnect();
      }
    });

    describe("student role", () => {
      it("sees only own Conversations", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.conversation.findMany({
            where: { id: { in: [fixtures.conversationA, fixtures.conversationB] } },
            select: { id: true },
          }),
        );
        const ids = rows.map((r) => r.id);
        assert.deepEqual(ids, [fixtures.conversationA]);
      });

      it("sees only own Goals", async () => {
        const rows = await asRole("student", fixtures.studentB, (tx) =>
          tx.goal.findMany({
            where: { id: { in: [fixtures.goalA, fixtures.goalB] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows.map((r) => r.id), [fixtures.goalB]);
      });

      it("cannot see other students' CaseNotes at all", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.caseNote.findMany({ where: { id: fixtures.caseNoteA }, select: { id: true } }),
        );
        assert.deepEqual(rows, [], "students must never see CaseNotes (not even their own)");
      });

      it("sees only own Student row", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.student.findMany({
            where: { id: { in: [fixtures.studentA, fixtures.studentB] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows.map((r) => r.id), [fixtures.studentA]);
      });

      it("cannot insert a Goal for another student", async () => {
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.goal.create({
                data: { studentId: fixtures.studentB, level: "daily", content: "forged" },
              }),
            ),
          /row-level security/i,
        );
      });
    });

    describe("teacher role", () => {
      it("sees managed students' Conversations", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.conversation.findMany({
            where: { id: { in: [fixtures.conversationA, fixtures.conversationB] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows.map((r) => r.id), [fixtures.conversationA]);
      });

      it("does NOT see unmanaged students' Conversations", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.conversation.findMany({
            where: { id: fixtures.conversationB },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows, []);
      });

      it("sees managed students' CaseNotes", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.caseNote.findMany({ where: { id: fixtures.caseNoteA }, select: { id: true } }),
        );
        assert.deepEqual(rows.map((r) => r.id), [fixtures.caseNoteA]);
      });
    });

    describe("teacher role — SageMemory classroom scoping", () => {
      it("sees managed students' SageMemory", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.sageMemory.findMany({
            where: { id: { in: [fixtures.memoryA, fixtures.memoryB] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows.map((r) => r.id), [fixtures.memoryA]);
      });

      it("does NOT see unmanaged students' SageMemory", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.sageMemory.findMany({
            where: { id: fixtures.memoryB },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows, []);
      });

      it("cannot UPDATE an unmanaged student's SageMemory", async () => {
        const result = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.sageMemory.updateMany({
            where: { id: fixtures.memoryB },
            data: { confidence: 0.99 },
          }),
        );
        assert.equal(result.count, 0, "teacher must not be able to update a memory outside their managed students");
      });

      it("cannot DELETE (archive) an unmanaged student's SageMemory", async () => {
        const result = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.sageMemory.updateMany({
            where: { id: fixtures.memoryB },
            data: { validTo: new Date() },
          }),
        );
        assert.equal(result.count, 0, "teacher must not be able to archive a memory outside their managed students");
      });
    });

    describe("admin role", () => {
      it("sees every Conversation", async () => {
        const rows = await asRole("admin", fixtures.admin, (tx) =>
          tx.conversation.findMany({
            where: { id: { in: [fixtures.conversationA, fixtures.conversationB] } },
            select: { id: true },
          }),
        );
        assert.equal(rows.length, 2);
      });

      it("sees every Student including sensitive rows", async () => {
        const rows = await asRole("admin", fixtures.admin, (tx) =>
          tx.student.findMany({
            where: { id: { in: [fixtures.studentA, fixtures.studentB, fixtures.teacher] } },
            select: { id: true },
          }),
        );
        assert.equal(rows.length, 3);
      });

      it("can read admin-only SystemConfig", async () => {
        // No rows may exist; the assertion is that the query succeeds.
        await asRole("admin", fixtures.admin, (tx) => tx.systemConfig.findMany({ take: 1 }));
      });
    });

    describe("no RLS context", () => {
      it("returns zero rows for ALL student-owned tables", async () => {
        const [convs, goals, notes] = await asRole(null, null, (tx) =>
          Promise.all([
            tx.conversation.findMany({ select: { id: true } }),
            tx.goal.findMany({ select: { id: true } }),
            tx.caseNote.findMany({ select: { id: true } }),
          ]),
        );
        assert.deepEqual(convs, [], "Conversation must be empty with no context");
        assert.deepEqual(goals, [], "Goal must be empty with no context");
        assert.deepEqual(notes, [], "CaseNote must be empty with no context");
      });

      it("returns zero rows for AuditLog, CoachingArc, StudentAlert, and SageOperation", async () => {
        // Guards against any of these policies gaining a branch that is true
        // with empty GUCs (e.g. `OR "studentId" = ''`, or a CASE ELSE true
        // reachable without a role). Unfiltered on purpose: one row is a leak.
        const [audits, arcs, alerts, ops] = await asRole(null, null, (tx) =>
          Promise.all([
            tx.auditLog.findMany({ select: { id: true } }),
            tx.coachingArc.findMany({ select: { id: true } }),
            tx.studentAlert.findMany({ select: { id: true } }),
            tx.sageOperation.findMany({ select: { id: true } }),
          ]),
        );
        assert.deepEqual(audits, [], "AuditLog must be empty with no context");
        assert.deepEqual(arcs, [], "CoachingArc must be empty with no context");
        assert.deepEqual(alerts, [], "StudentAlert must be empty with no context");
        assert.deepEqual(ops, [], "SageOperation must be empty with no context");
      });
    });

    describe("prismaAdmin bypass (simulated by skipping SET LOCAL ROLE)", () => {
      it("postgres role sees all rows regardless of GUCs", async () => {
        const rows = await db.conversation.findMany({
          where: { id: { in: [fixtures.conversationA, fixtures.conversationB] } },
          select: { id: true },
        });
        assert.equal(rows.length, 2);
      });
    });

    describe("staff notification from a student context (F2 regression pins)", () => {
      // The crisis path (src/lib/sage/crisis-detection.ts) and teacher nudges
      // (src/lib/advising-interventions.ts) run inside the STUDENT's RLS
      // context. These cases pin why both resolve staff and write staff
      // Notification rows through prismaAdmin: under the student's context the
      // app client sees no teacher row and cannot insert a Notification whose
      // studentId is a teacher, so the alert silently reached nobody.
      const staffNotification = {
        type: "wellbeing.concern",
        title: "Wellbeing check-in needed",
        body: "A student may need support. Please check in with them directly.",
      };

      it("student context cannot insert a Notification addressed to a teacher", async () => {
        // Narrow on purpose: /violates|permission/ would also match an FK or
        // unique violation, so a fixture defect could keep this green for the
        // wrong reason. Only the policy rejection counts.
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.notification.create({
                data: { studentId: fixtures.teacher, ...staffNotification },
              }),
            ),
          /row-level security/i,
        );
      });

      it("student context cannot resolve assigned instructors through the production join", async () => {
        // Exact shape of findAssignedInstructors in crisis-detection.ts. The
        // enrollment, class, and instructor-link rows are all visible to the
        // enrolled student, but the instructor's Student row is not
        // (student_self_access), so Prisma meets a required to-one relation
        // with no row behind it and raises an inconsistency error instead of
        // returning instructors. resolveWellbeingRecipients catches that and
        // falls back to the all-active-teachers list, which is also empty
        // under this context (previous case): zero recipients either way.
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.studentClassEnrollment.findMany({
                where: {
                  studentId: fixtures.studentA,
                  status: { in: ["active", "inactive", "completed", "withdrawn"] },
                },
                select: {
                  class: {
                    select: {
                      instructors: {
                        select: {
                          instructor: { select: { id: true, email: true, isActive: true } },
                        },
                      },
                    },
                  },
                },
              }),
            ),
          /required to return data|inconsistent query result/i,
        );
      });

      it("student context resolves zero active teachers", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.student.findMany({
            where: { role: "teacher", isActive: true },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows, [], "the all-active-teachers fallback is empty under student RLS");
      });

      it("postgres (prismaAdmin) path resolves the teacher and inserts the same Notification", async () => {
        const teachers = await db.student.findMany({
          where: { role: "teacher", isActive: true },
          select: { id: true },
        });
        assert.ok(
          teachers.some((teacher) => teacher.id === fixtures.teacher),
          "the admin path sees the fixture teacher",
        );

        const created = await db.notification.create({
          data: { studentId: fixtures.teacher, ...staffNotification },
          select: { id: true },
        });
        try {
          const seen = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.notification.findMany({ where: { id: created.id }, select: { id: true } }),
          );
          assert.deepEqual(
            seen.map((row) => row.id),
            [created.id],
            "the teacher can read the row the admin path wrote",
          );
        } finally {
          // Notification cascades on Student delete, so destroyFixtures would
          // catch this too; delete here so a mid-test failure leaves nothing.
          await db.notification.deleteMany({ where: { id: created.id } });
        }
      });
    });

    describe("AuditLog (audit_log_admin_only)", () => {
      // Guards against adding a student or teacher branch to
      // audit_log_admin_only. Staff writes go through prismaAdmin
      // (src/lib/audit.ts); DB-03 in the 2026-09-01 DB review is two teacher
      // routes that wrote through the app client and 500'd on exactly this
      // policy. The postgres case at the end is the path that must keep working.
      const directWrite = (actorId: string, actorRole: string) => ({
        actorId,
        actorRole,
        action: "rls_test.direct-write",
        targetType: "RlsTestFixture",
        targetId: fixtures.suffix,
        summary: "written through the app role",
      });

      it("student and teacher read zero audit rows", async () => {
        const [asStudent, asTeacher] = await Promise.all([
          asRole("student", fixtures.studentA, (tx) =>
            tx.auditLog.findMany({ where: { id: fixtures.auditRow }, select: { id: true } }),
          ),
          asRole("teacher", fixtures.teacher, (tx) =>
            tx.auditLog.findMany({ where: { id: fixtures.auditRow }, select: { id: true } }),
          ),
        ]);
        assert.deepEqual(asStudent, [], "student must not read AuditLog");
        assert.deepEqual(asTeacher, [], "teacher must not read AuditLog (admin only)");
      });

      it("student cannot insert an audit row", async () => {
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.auditLog.create({ data: directWrite(fixtures.studentA, "student") }),
            ),
          /row-level security/i,
        );
      });

      it("teacher cannot insert an audit row through the app role (DB-03 shape)", async () => {
        await assert.rejects(
          () =>
            asRole("teacher", fixtures.teacher, (tx) =>
              tx.auditLog.create({ data: directWrite(fixtures.teacher, "teacher") }),
            ),
          /row-level security/i,
        );
      });

      it("admin reads the row; the postgres (prismaAdmin) path inserts one", async () => {
        const seen = await asRole("admin", fixtures.admin, (tx) =>
          tx.auditLog.findMany({ where: { id: fixtures.auditRow }, select: { id: true } }),
        );
        assert.deepEqual(seen.map((r) => r.id), [fixtures.auditRow], "admin branch must still read");

        const created = await db.auditLog.create({
          data: directWrite(fixtures.teacher, "teacher"),
          select: { id: true },
        });
        try {
          assert.ok(created.id, "audit.ts writes through prismaAdmin; that path must succeed");
        } finally {
          await db.auditLog.deleteMany({ where: { id: created.id } });
        }
      });
    });

    describe("CoachingArc (coaching_arc_access)", () => {
      // Guards against dropping the ownership term (`"studentId" =
      // current_user_id`) or the managed_student_ids() gate on the teacher
      // branch. The daily-coaching cron writes arcs; DB-02 in the 2026-09-01
      // DB review is that write running under the wrong client, not a policy
      // defect, so the policy shape is pinned here as-is.
      it("student sees only own arc", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.coachingArc.findMany({
            where: { id: { in: [fixtures.arcA, fixtures.arcB] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows.map((r) => r.id), [fixtures.arcA]);
      });

      it("student can update own arc and cannot update another student's", async () => {
        const own = await asRole("student", fixtures.studentA, (tx) =>
          tx.coachingArc.updateMany({ where: { id: fixtures.arcA }, data: { weekNumber: 2 } }),
        );
        assert.equal(own.count, 1, "own-row write is admitted (proves the context is live)");
        const other = await asRole("student", fixtures.studentA, (tx) =>
          tx.coachingArc.updateMany({ where: { id: fixtures.arcB }, data: { weekNumber: 2 } }),
        );
        assert.equal(other.count, 0, "cross-student write must touch zero rows");
      });

      it("student cannot insert an arc for another student", async () => {
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.coachingArc.create({
                // Distinct arcType so @@unique([studentId, arcType]) cannot be
                // what rejects this; only the policy may.
                data: { studentId: fixtures.studentB, arcType: "rlstest_forged" },
              }),
            ),
          /row-level security/i,
        );
      });

      it("teacher sees managed students' arcs only", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.coachingArc.findMany({
            where: { id: { in: [fixtures.arcA, fixtures.arcB] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows.map((r) => r.id), [fixtures.arcA], "Student B is unmanaged");
      });
    });

    describe("StudentAlert (student_alert_access)", () => {
      // Two things are pinned. (1) The policy admits a student's OWN alert
      // rows. That is what let staff wellbeing alerts reach the student's
      // Advising page and Home (F3, fixed app-side in #186), and it is also
      // what lets crisis-detection.ts upsert the CRITICAL alert from inside
      // the student's context. Tightening the policy would silently kill that
      // upsert, so the own-row cases going red means: check the crisis path
      // before changing anything else. (2) Cross-student and unmanaged-teacher
      // access must stay closed; those cases guard against dropping the
      // ownership term or the managed_student_ids() gate.
      it("student sees own alert rows (the DB admits them; hiding staff alerts is app-side, F3)", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.studentAlert.findMany({
            where: { id: { in: [fixtures.alertA, fixtures.alertC] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows.map((r) => r.id), [fixtures.alertA]);
      });

      it("student context can write own alert row (crisis-detection.ts upsert path)", async () => {
        const result = await asRole("student", fixtures.studentA, (tx) =>
          tx.studentAlert.updateMany({ where: { id: fixtures.alertA }, data: { status: "open" } }),
        );
        assert.equal(result.count, 1);
      });

      it("student cannot read or update another student's alert", async () => {
        const seen = await asRole("student", fixtures.studentB, (tx) =>
          tx.studentAlert.findMany({ where: { id: fixtures.alertA }, select: { id: true } }),
        );
        assert.deepEqual(seen, []);
        const touched = await asRole("student", fixtures.studentB, (tx) =>
          tx.studentAlert.updateMany({ where: { id: fixtures.alertA }, data: { status: "resolved" } }),
        );
        assert.equal(touched.count, 0);
      });

      it("student cannot insert an alert for another student", async () => {
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.studentAlert.create({
                data: {
                  studentId: fixtures.studentB,
                  alertKey: `rlstest-alert-forged-${fixtures.suffix}`,
                  type: "wellbeing_concern",
                  title: "forged",
                  summary: "forged",
                },
              }),
            ),
          /row-level security/i,
        );
      });

      it("teacher sees managed students' alerts only", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.studentAlert.findMany({
            where: { id: { in: [fixtures.alertA, fixtures.alertC] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows.map((r) => r.id), [fixtures.alertA], "Student C is Teacher B's");
      });
    });

    describe("StudentWorkProfile (student_work_profile_access)", () => {
      // Match & Connect Phase 2. The row holds availability, transport, pay
      // floor and childcare hours — student-owned answers that must reach the
      // student's own instructors and nobody else.
      before(async () => {
        await db.studentWorkProfile.createMany({
          data: [
            { studentId: fixtures.studentA, availability: {}, transport: "bus" },
            { studentId: fixtures.studentC, availability: {}, transport: "car" },
          ],
        });
      });

      it("student sees only own work profile", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.studentWorkProfile.findMany({
            where: { studentId: { in: [fixtures.studentA, fixtures.studentC] } },
            select: { studentId: true },
          }),
        );
        assert.deepEqual(rows.map((r) => r.studentId), [fixtures.studentA]);
      });

      it("student can update own profile and cannot update another student's", async () => {
        const own = await asRole("student", fixtures.studentA, (tx) =>
          tx.studentWorkProfile.updateMany({
            where: { studentId: fixtures.studentA },
            data: { payFloorHourly: 15 },
          }),
        );
        assert.equal(own.count, 1);

        const other = await asRole("student", fixtures.studentA, (tx) =>
          tx.studentWorkProfile.updateMany({
            where: { studentId: fixtures.studentC },
            data: { payFloorHourly: 99 },
          }),
        );
        assert.equal(other.count, 0);
      });

      it("student cannot insert a profile for another student", async () => {
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.studentWorkProfile.create({
                data: { studentId: fixtures.studentB, availability: {} },
              }),
            ),
          /row-level security/i,
        );
      });

      it("teacher sees managed students' profiles only", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.studentWorkProfile.findMany({
            where: { studentId: { in: [fixtures.studentA, fixtures.studentC] } },
            select: { studentId: true },
          }),
        );
        assert.deepEqual(rows.map((r) => r.studentId), [fixtures.studentA], "Student C is Teacher B's");
      });

      it("teacher can update a managed student's profile, and only that one", async () => {
        // Instructors correct a profile with the student in front of them
        // (updatedVia "teacher"), so the teacher branch must be writable —
        // and must stop at the classroom boundary.
        const managed = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.studentWorkProfile.updateMany({
            where: { studentId: fixtures.studentA },
            data: { maxCommuteMinutes: 30 },
          }),
        );
        assert.equal(managed.count, 1, "Teacher A manages Student A");

        const unmanaged = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.studentWorkProfile.updateMany({
            where: { studentId: fixtures.studentC },
            data: { maxCommuteMinutes: 999 },
          }),
        );
        assert.equal(unmanaged.count, 0, "Student C is Teacher B's");
      });

      it("student cannot re-key their own row onto another student", async () => {
        // The WITH CHECK clause is what catches this: the UPDATE passes USING
        // (it is their row) and must still fail on the row it would become.
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.studentWorkProfile.update({
                where: { studentId: fixtures.studentA },
                data: { studentId: fixtures.studentB },
              }),
            ),
          /row-level security/i,
        );
      });

      it("returns zero rows with no RLS context", async () => {
        // The "no RLS context" block above runs before these fixture rows
        // exist, so this table's empty-GUC case has to be asserted here, with
        // rows on the table. Unfiltered on purpose: one row is a leak.
        const rows = await asRole(null, null, (tx) =>
          tx.studentWorkProfile.findMany({ select: { studentId: true } }),
        );
        assert.deepEqual(rows, [], "StudentWorkProfile must be empty with no context");
      });
    });

    describe("Employer / EmployerContact / JobLead (Match & Connect Phase 3)", () => {
      // Employer and EmployerContact are staff-only: no student branch exists
      // in either policy. JobLead is the one table in the group a student may
      // read, and only rows that are open AND visible to a class they are
      // enrolled in. These cases guard four specific loosenings: adding a
      // student branch to the employer policies; dropping the
      // `status = 'open'` clause from job_lead_read; letting the student
      // branch reach the write path; and dropping the class clause from
      // job_lead_write, which would let a teacher publish into a classroom
      // they do not instruct.
      let employerId = "";
      let contactId = "";
      /** classId NULL — visible to every student. */
      let leadProgramWide = "";
      /** classId NULL, closed — invisible to students, visible to staff. */
      let leadProgramWideClosed = "";
      /** classAlpha (Student A's class), open. */
      let leadAlphaOpen = "";
      /** classAlpha, closed — the status clause is the only thing hiding it. */
      let leadAlphaClosed = "";
      /** classBeta (Student C's class), open. */
      let leadBetaOpen = "";

      before(async () => {
        const employer = await db.employer.create({
          data: {
            name: `RLS Test Employer ${fixtures.suffix}`,
            nameKey: `rls test employer ${fixtures.suffix}`,
            county: "Raleigh",
            city: "Beckley",
          },
        });
        employerId = employer.id;

        const contact = await db.employerContact.create({
          data: { employerId, name: "Pat Buyer", email: "pat@example.test" },
        });
        contactId = contact.id;

        const leadBase = {
          employerId,
          employerName: employer.name,
          location: "Beckley, WV",
          source: "manual",
        };
        // `source` + `sourceRef` is unique, so every fixture lead needs its own
        // sourceRef — the constraint is real and the fixtures must respect it.
        const [programWide, programWideClosed, alphaOpen, alphaClosed, betaOpen] =
          await Promise.all([
            db.jobLead.create({
              data: {
                ...leadBase,
                sourceRef: `rls-pw-${fixtures.suffix}`,
                title: "Program wide",
                classId: null,
                status: "open",
              },
            }),
            db.jobLead.create({
              data: {
                ...leadBase,
                sourceRef: `rls-pwc-${fixtures.suffix}`,
                title: "Program wide closed",
                classId: null,
                status: "closed",
              },
            }),
            db.jobLead.create({
              data: {
                ...leadBase,
                sourceRef: `rls-ao-${fixtures.suffix}`,
                title: "Alpha open",
                classId: fixtures.classAlpha,
                status: "open",
              },
            }),
            db.jobLead.create({
              data: {
                ...leadBase,
                sourceRef: `rls-ac-${fixtures.suffix}`,
                title: "Alpha closed",
                classId: fixtures.classAlpha,
                status: "closed",
              },
            }),
            db.jobLead.create({
              data: {
                ...leadBase,
                sourceRef: `rls-bo-${fixtures.suffix}`,
                title: "Beta open",
                classId: fixtures.classBeta,
                status: "open",
              },
            }),
          ]);
        leadProgramWide = programWide.id;
        leadProgramWideClosed = programWideClosed.id;
        leadAlphaOpen = alphaOpen.id;
        leadAlphaClosed = alphaClosed.id;
        leadBetaOpen = betaOpen.id;
      });

      after(async () => {
        // JobLead cascades from Employer; EmployerContact does too.
        await db.employer.deleteMany({ where: { id: employerId } });
      });

      it("a student sees no Employer rows at all", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.employer.findMany({ where: { id: employerId }, select: { id: true } }),
        );
        assert.deepEqual(rows, [], "Employer is staff-only");
      });

      it("a student sees no EmployerContact rows at all", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.employerContact.findMany({ where: { id: contactId }, select: { id: true } }),
        );
        assert.deepEqual(rows, [], "employer contact details never reach a student");
      });

      it("a coordinator sees none of the three tables", async () => {
        // The coordinator role has no branch in any of these policies, and
        // src/lib/classroom.ts's coordinator clause is fail-closed. This pins
        // that a role added to the app later does not silently inherit access.
        const [employers, contacts, leads] = await Promise.all([
          asRole("coordinator" as Role, fixtures.teacher, (tx) =>
            tx.employer.findMany({ where: { id: employerId }, select: { id: true } }),
          ),
          asRole("coordinator" as Role, fixtures.teacher, (tx) =>
            tx.employerContact.findMany({ where: { id: contactId }, select: { id: true } }),
          ),
          asRole("coordinator" as Role, fixtures.teacher, (tx) =>
            tx.jobLead.findMany({ where: { employerId }, select: { id: true } }),
          ),
        ]);
        assert.deepEqual(employers, [], "Employer must be empty for a coordinator");
        assert.deepEqual(contacts, [], "EmployerContact must be empty for a coordinator");
        assert.deepEqual(leads, [], "JobLead must be empty for a coordinator");
      });

      it("a teacher reads employers and their contacts", async () => {
        const [employers, contacts] = await Promise.all([
          asRole("teacher", fixtures.teacher, (tx) =>
            tx.employer.findMany({ where: { id: employerId }, select: { id: true } }),
          ),
          asRole("teacher", fixtures.teacher, (tx) =>
            tx.employerContact.findMany({ where: { id: contactId }, select: { id: true } }),
          ),
        ]);
        assert.deepEqual(employers.map((row) => row.id), [employerId]);
        assert.deepEqual(contacts.map((row) => row.id), [contactId]);
      });

      it("a student cannot create an Employer", async () => {
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.employer.create({
                data: {
                  name: `forged ${fixtures.suffix}`,
                  nameKey: `forged ${fixtures.suffix}`,
                  county: "Raleigh",
                  city: "Beckley",
                },
              }),
            ),
          /row-level security/i,
        );
      });

      it("runs rankLeadsForStudent's ACTUAL query shape as a student", async () => {
        // The shape is the point. rankLeadsForStudent selects lead columns
        // only and filters on lead columns only, because Employer has no
        // student branch — a query that reached through the relation would
        // come back empty here and the student would silently see no jobs.
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.jobLead.findMany({
            where: {
              status: "open",
              OR: [{ classId: null }, { classId: { in: [fixtures.classAlpha] } }],
            },
            orderBy: [{ postedAt: "desc" }, { id: "asc" }],
            select: {
              id: true,
              title: true,
              employerId: true,
              employerName: true,
              status: true,
              location: true,
              clusters: true,
              requirements: true,
              schedule: true,
              payMin: true,
              payMax: true,
              payPeriod: true,
              transitNotes: true,
              distanceMiles: true,
              source: true,
              classId: true,
            },
          }),
        );

        assert.deepEqual(
          rows.map((row) => row.id).sort(),
          [leadProgramWide, leadAlphaOpen].sort(),
          "open + (program-wide or my class); the closed and other-class leads must not appear",
        );
        assert.ok(
          rows.every((row) => row.employerName.length > 0),
          "the denormalised employerName is what makes this query possible at all",
        );
      });

      it("a student does NOT read a closed lead, for their class or program-wide", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.jobLead.findMany({
            where: { id: { in: [leadAlphaClosed, leadProgramWideClosed] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows, [], "job_lead_read must keep the status = 'open' clause");
      });

      it("a COMPLETED enrollment still reads its class's open lead", async () => {
        // Graduates are the placement population. Cutting them off at exit
        // would hide leads from exactly the students this feature exists for.
        await db.studentClassEnrollment.updateMany({
          where: { classId: fixtures.classAlpha, studentId: fixtures.studentA },
          data: { status: "completed" },
        });
        try {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.jobLead.findMany({ where: { id: leadAlphaOpen }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((row) => row.id), [leadAlphaOpen]);
        } finally {
          await db.studentClassEnrollment.updateMany({
            where: { classId: fixtures.classAlpha, studentId: fixtures.studentA },
            data: { status: "active" },
          });
        }
      });

      it("a WITHDRAWN enrollment loses the class lead but keeps program-wide ones", async () => {
        await db.studentClassEnrollment.updateMany({
          where: { classId: fixtures.classAlpha, studentId: fixtures.studentA },
          data: { status: "withdrawn" },
        });
        try {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.jobLead.findMany({
              where: { id: { in: [leadAlphaOpen, leadProgramWide] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(
            rows.map((row) => row.id),
            [leadProgramWide],
            "active_enrolled_class_ids() admits active and completed, not withdrawn",
          );
        } finally {
          await db.studentClassEnrollment.updateMany({
            where: { classId: fixtures.classAlpha, studentId: fixtures.studentA },
            data: { status: "active" },
          });
        }
      });

      it("a student cannot create, update or delete a lead", async () => {
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.jobLead.create({
                data: {
                  employerId,
                  employerName: "forged",
                  title: "forged",
                  location: "Beckley, WV",
                  source: "manual",
                  sourceRef: `rls-forged-${fixtures.suffix}`,
                  classId: null,
                },
              }),
            ),
          /row-level security/i,
        );

        // Count 0, not a throw: the student fails job_lead_write's USING, so
        // the row is never matched and no WITH CHECK is reached. The teacher
        // retarget case below is the opposite shape and rejects instead — see
        // the note there before making these two agree.
        const updated = await asRole("student", fixtures.studentA, (tx) =>
          tx.jobLead.updateMany({
            where: { id: leadProgramWide },
            data: { title: "forged title" },
          }),
        );
        assert.equal(updated.count, 0, "job_lead_write has no student branch");

        // Deleting a row they CAN see is the sharper case: the read policy
        // admits it, so only job_lead_write's missing student branch stops it.
        const deleted = await asRole("student", fixtures.studentA, (tx) =>
          tx.jobLead.deleteMany({ where: { id: leadProgramWide } }),
        );
        assert.equal(deleted.count, 0, "a visible lead is still not a deletable one");
      });

      it("a teacher cannot publish a lead into a class they do not instruct", async () => {
        // Teacher One instructs classAlpha only. classBeta belongs to
        // Teacher Two, and publishing there would put a job in front of
        // somebody else's students.
        await assert.rejects(
          () =>
            asRole("teacher", fixtures.teacher, (tx) =>
              tx.jobLead.create({
                data: {
                  employerId,
                  employerName: "RLS Test Employer",
                  title: "Cross-class forgery",
                  location: "Beckley, WV",
                  source: "manual",
                  sourceRef: `rls-cross-${fixtures.suffix}`,
                  classId: fixtures.classBeta,
                },
              }),
            ),
          /row-level security/i,
        );
      });

      it("a teacher cannot RETARGET a lead into a class they do not instruct", async () => {
        // THROWS, it does not return count 0 — and the difference is the whole
        // mechanism. On an UPDATE, Postgres evaluates the policy's USING
        // against the OLD row and its WITH CHECK against the NEW one. Teacher
        // One instructs classAlpha, so the old row passes USING and the row IS
        // matched; the new classId is classBeta, which fails WITH CHECK, and a
        // WITH CHECK violation raises 42501 rather than filtering the row out.
        //
        // Contrast the student cases above, which DO return count 0: a student
        // fails job_lead_write's USING, so no row is ever matched and there is
        // nothing to check. Expecting a count here (as the first cut did) tests
        // for the one outcome this policy cannot produce.
        await assert.rejects(
          () =>
            asRole("teacher", fixtures.teacher, (tx) =>
              tx.jobLead.updateMany({
                where: { id: leadAlphaOpen },
                data: { classId: fixtures.classBeta },
              }),
            ),
          /row-level security/i,
        );

        // The rejection aborts its transaction, so the lead must still belong
        // to the class it started in. Without this the test would pass on a
        // policy that threw AFTER writing.
        const after = await db.jobLead.findUnique({
          where: { id: leadAlphaOpen },
          select: { classId: true },
        });
        assert.equal(after?.classId, fixtures.classAlpha, "the lead must not have moved");
      });

      it("a teacher CAN publish into their own class and program-wide", async () => {
        const own = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.jobLead.create({
            data: {
              employerId,
              employerName: "RLS Test Employer",
              title: "Own class",
              location: "Beckley, WV",
              source: "manual",
              sourceRef: `rls-own-${fixtures.suffix}`,
              classId: fixtures.classAlpha,
            },
            select: { id: true },
          }),
        );
        assert.ok(own.id);

        const wide = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.jobLead.create({
            data: {
              employerId,
              employerName: "RLS Test Employer",
              title: "Program wide by teacher",
              location: "Beckley, WV",
              source: "manual",
              sourceRef: `rls-wide-${fixtures.suffix}`,
              classId: null,
            },
            select: { id: true },
          }),
        );
        assert.ok(wide.id);

        await db.jobLead.deleteMany({ where: { id: { in: [own.id, wide.id] } } });
      });

      it("a teacher reads every lead, open or not, in any class", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.jobLead.findMany({
            where: {
              id: {
                in: [leadProgramWide, leadAlphaOpen, leadAlphaClosed, leadBetaOpen],
              },
            },
            select: { id: true },
          }),
        );
        assert.equal(rows.length, 4, "leads are a staff work queue, not per-class student data");
      });

      it("returns zero rows for all three tables with no RLS context", async () => {
        const [employers, contacts, leads] = await Promise.all([
          asRole(null, null, (tx) => tx.employer.findMany({ select: { id: true } })),
          asRole(null, null, (tx) => tx.employerContact.findMany({ select: { id: true } })),
          asRole(null, null, (tx) => tx.jobLead.findMany({ select: { id: true } })),
        ]);
        assert.deepEqual(employers, [], "Employer must be empty with no context");
        assert.deepEqual(contacts, [], "EmployerContact must be empty with no context");
        assert.deepEqual(leads, [], "JobLead must be empty with no context");
      });
    });

    describe("SageOperation (sage_operation_read / _write / _update)", () => {
      // sage_operation_read is the one policy that has already been wrong
      // once (any teacher could read every ledger row until 20260820140000).
      // The read cases guard against that regression: the CASE must keep
      // gating both the targetStudentId branch and the legacy
      // actorType='student' branch through managed_student_ids(). The write
      // cases document F17 (DB-07 in the 2026-09-01 DB review): the INSERT
      // and UPDATE policies still admit any teacher, unscoped.
      const allOps = () => [
        fixtures.opStudentA,
        fixtures.opStudentB,
        fixtures.opStaffOnA,
        fixtures.opStaffOnC,
      ];
      const sortedIds = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
      const ledgerRow = (id: string, actorId: string, targetStudentId: string) => ({
        id,
        actorType: "teacher",
        actorId,
        targetStudentId,
        toolName: "update_goal_status",
        status: "proposed",
        payload: {},
      });

      it("student sees own actor rows only: not another student's, not staff rows about them", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.sageOperation.findMany({ where: { id: { in: allOps() } }, select: { id: true } }),
        );
        // opStaffOnA is ABOUT Student A but its actor is staff; the student
        // branch is actor-keyed on purpose (20260820140000 header: widening
        // students into on-behalf-of rows is a product decision, tracked in
        // .claude/MEMORY.md). Change this deliberately, never by accident.
        assert.deepEqual(sortedIds(rows), [fixtures.opStudentA]);
      });

      it("teacher sees rows about managed students only, through both CASE branches", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.sageOperation.findMany({ where: { id: { in: allOps() } }, select: { id: true } }),
        );
        // opStudentA passes the legacy actor branch, opStaffOnA the
        // targetStudentId branch. opStudentB (legacy, actor unmanaged) and
        // opStaffOnC (target managed by Teacher B) must both be filtered.
        assert.deepEqual(sortedIds(rows), [fixtures.opStaffOnA, fixtures.opStudentA].sort());
      });

      it("second teacher sees none of the first teacher's students' rows", async () => {
        const rows = await asRole("teacher", fixtures.teacherB, (tx) =>
          tx.sageOperation.findMany({ where: { id: { in: allOps() } }, select: { id: true } }),
        );
        assert.deepEqual(sortedIds(rows), [fixtures.opStaffOnC]);
      });

      it("admin sees every row", async () => {
        const rows = await asRole("admin", fixtures.admin, (tx) =>
          tx.sageOperation.findMany({ where: { id: { in: allOps() } }, select: { id: true } }),
        );
        assert.equal(rows.length, 4);
      });

      it("student cannot insert a ledger row as another student", async () => {
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.sageOperation.create({
                data: {
                  ...ledgerRow(`rlstest-op-forged-${fixtures.suffix}`, fixtures.studentB, fixtures.studentB),
                  actorType: "student",
                },
              }),
            ),
          /row-level security/i,
        );
      });

      it("teacher create() targeting an unmanaged student is rejected, but only by the read policy", async () => {
        // sage_operation_write's teacher branch is unscoped (F17). This
        // rejection comes from Postgres applying sage_operation_read to the
        // INSERT ... RETURNING row that Prisma's create() emits, not from the
        // WITH CHECK clause. It therefore guards the read policy; the next
        // case shows what happens once nothing is RETURNING.
        await assert.rejects(
          () =>
            asRole("teacher", fixtures.teacherB, (tx) =>
              tx.sageOperation.create({
                data: ledgerRow(`rlstest-op-f17-create-${fixtures.suffix}`, fixtures.teacherB, fixtures.studentA),
              }),
            ),
          /row-level security/i,
        );
      });

      it("F17 KNOWN GAP: teacher createMany() targeting an unmanaged student succeeds", async () => {
        // Documents current behavior; it is NOT the desired behavior.
        // sage_operation_write WITH CHECK is `current_role IN ('admin',
        // 'teacher')` with no managed_student_ids() gate, so an INSERT with no
        // RETURNING clause lands a ledger row about a student this teacher does
        // not manage. When the policy is scoped (mirror the CASE in
        // 20260820140000), this case goes red: replace the body with
        // assert.rejects(..., /row-level security/i) and delete this note.
        const id = `rlstest-op-f17-createmany-${fixtures.suffix}`;
        try {
          const result = await asRole("teacher", fixtures.teacherB, (tx) =>
            tx.sageOperation.createMany({
              data: [ledgerRow(id, fixtures.teacherB, fixtures.studentA)],
            }),
          );
          assert.equal(result.count, 1, "F17 closed? Flip this case to assert.rejects (see comment)");
        } finally {
          await db.sageOperation.deleteMany({ where: { id } });
        }
      });

      it("teacher keyed update of a row about an unmanaged student touches zero rows", async () => {
        // sage_operation_update USING also admits any teacher (F17). A keyed
        // UPDATE has to read the row first, so sage_operation_read filters it
        // and the count is 0; loosen the read policy and this goes red. An
        // UPDATE with no WHERE is not filtered, which is why F17 still needs
        // the policy scoped rather than relying on this.
        const result = await asRole("teacher", fixtures.teacherB, (tx) =>
          tx.sageOperation.updateMany({
            where: { id: fixtures.opStaffOnA },
            data: { resultSummary: "touched by the wrong teacher" },
          }),
        );
        assert.equal(result.count, 0);
      });
    });

    describe("two-teacher isolation (Teacher B manages Student C only)", () => {
      // The pre-2026-09-02 suite had one teacher, so a policy whose teacher
      // branch was `current_role = 'teacher'` with no managed_student_ids()
      // gate (the exact shape 20260701141000 and 20260820140000 removed)
      // passed every teacher case. These cases guard against that shape
      // returning on any of the five tables.
      it("Teacher B sees own managed student's Conversation (context is live)", async () => {
        const rows = await asRole("teacher", fixtures.teacherB, (tx) =>
          tx.conversation.findMany({ where: { id: fixtures.conversationC }, select: { id: true } }),
        );
        assert.deepEqual(rows.map((r) => r.id), [fixtures.conversationC]);
      });

      it("Teacher B does NOT see Student A's Conversation", async () => {
        // Red-proven in PR #191's first CI run: with this query run as
        // postgres instead of Teacher B (the shape of a wide-open teacher
        // branch) it failed with `[ { id: conversationA } ] !== []`.
        const rows = await asRole("teacher", fixtures.teacherB, (tx) =>
          tx.conversation.findMany({ where: { id: fixtures.conversationA }, select: { id: true } }),
        );
        assert.deepEqual(rows, []);
      });

      it("Teacher A does NOT see Student C's Conversation (isolation is symmetric)", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.conversation.findMany({ where: { id: fixtures.conversationC }, select: { id: true } }),
        );
        assert.deepEqual(rows, []);
      });

      it("Teacher B sees none of Student A's Goal, CaseNote, SageMemory, or StudentAlert rows", async () => {
        const [goals, notes, memories, alerts] = await asRole("teacher", fixtures.teacherB, (tx) =>
          Promise.all([
            tx.goal.findMany({ where: { id: fixtures.goalA }, select: { id: true } }),
            tx.caseNote.findMany({ where: { id: fixtures.caseNoteA }, select: { id: true } }),
            tx.sageMemory.findMany({ where: { id: fixtures.memoryA }, select: { id: true } }),
            tx.studentAlert.findMany({ where: { id: fixtures.alertA }, select: { id: true } }),
          ]),
        );
        assert.deepEqual(goals, [], "Goal");
        assert.deepEqual(notes, [], "CaseNote");
        assert.deepEqual(memories, [], "SageMemory");
        assert.deepEqual(alerts, [], "StudentAlert");
      });

      it("Teacher B cannot update any of Student A's rows", async () => {
        const [conv, goal, note, memory, alert] = await asRole("teacher", fixtures.teacherB, (tx) =>
          Promise.all([
            tx.conversation.updateMany({ where: { id: fixtures.conversationA }, data: { title: "hijacked" } }),
            tx.goal.updateMany({ where: { id: fixtures.goalA }, data: { content: "hijacked" } }),
            tx.caseNote.updateMany({ where: { id: fixtures.caseNoteA }, data: { body: "hijacked" } }),
            tx.sageMemory.updateMany({ where: { id: fixtures.memoryA }, data: { confidence: 0.01 } }),
            tx.studentAlert.updateMany({ where: { id: fixtures.alertA }, data: { status: "dismissed" } }),
          ]),
        );
        assert.equal(conv.count, 0, "Conversation");
        assert.equal(goal.count, 0, "Goal");
        assert.equal(note.count, 0, "CaseNote");
        assert.equal(memory.count, 0, "SageMemory");
        assert.equal(alert.count, 0, "StudentAlert");
      });
    });

    describe("Connection / ConnectionEvent / OutboundMessage (Match & Connect Phase 4)", () => {
      // A Connection is the object that causes a student's information to
      // leave the program, so these cases guard the four specific loosenings
      // that would matter: letting a student read someone else's connection;
      // letting a student drive a status other than student_approved or
      // withdrawn; letting the append-only event log be edited; and letting a
      // student read OutboundMessage, which names the employer contact.
      let employerId = "";
      let leadId = "";
      let connectionA = "";
      let connectionC = "";
      let eventA = "";
      let messageA = "";
      let messageC = "";

      before(async () => {
        const employer = await db.employer.create({
          data: {
            name: `RLS Connect Employer ${fixtures.suffix}`,
            nameKey: `rls connect employer ${fixtures.suffix}`,
            county: "Raleigh",
            city: "Beckley",
          },
        });
        employerId = employer.id;

        const lead = await db.jobLead.create({
          data: {
            employerId,
            // Denormalised at write time so the student path can read a lead
            // without touching Employer, whose policy has no student branch.
            employerName: employer.name,
            title: "Production Associate",
            location: "Beckley, WV",
            source: "manual",
            status: "open",
          },
        });
        leadId = lead.id;

        const [a, c] = await Promise.all([
          db.connection.create({
            data: {
              studentId: fixtures.studentA,
              jobLeadId: leadId,
              employerId,
              proposedById: fixtures.teacher,
              proposedVia: "teacher",
              status: "proposed",
            },
          }),
          // Student C belongs to Teacher B's class, so this row is the
          // cross-teacher and cross-student control.
          db.connection.create({
            data: {
              studentId: fixtures.studentC,
              jobLeadId: leadId,
              employerId,
              proposedById: fixtures.teacherB,
              proposedVia: "teacher",
              status: "sent",
            },
          }),
        ]);
        connectionA = a.id;
        connectionC = c.id;

        const event = await db.connectionEvent.create({
          data: {
            connectionId: connectionA,
            fromStatus: null,
            toStatus: "proposed",
            actorType: "teacher",
            actorId: fixtures.teacher,
          },
        });
        eventA = event.id;

        // One message per connection, so the teacher cases can prove the
        // outbound_message_read scoping in BOTH directions: each teacher sees
        // their own student's row and not the other's. A single seeded row
        // could pass a broken policy by accident.
        const [msgA, msgC] = await Promise.all([
          db.outboundMessage.create({
            data: {
              channel: "email",
              toKind: "employer_contact",
              toId: "contact-rls-test-a",
              templateKey: "connect.employer_packet",
              body: "packet email body for A",
              connectionId: connectionA,
              employerId,
            },
          }),
          db.outboundMessage.create({
            data: {
              channel: "email",
              toKind: "employer_contact",
              toId: "contact-rls-test-c",
              templateKey: "connect.employer_packet",
              body: "packet email body for C",
              connectionId: connectionC,
              employerId,
            },
          }),
        ]);
        messageA = msgA.id;
        messageC = msgC.id;
      });

      after(async () => {
        // Deleted child-first, deliberately. Connection's FKs to JobLead,
        // Employer and proposedBy are Restrict, not Cascade — a disclosure
        // record has to outlive every party to it — so deleting the employer
        // while a Connection points at it now FAILS instead of quietly taking
        // the connection with it. That is the behaviour under test elsewhere;
        // here it just means the fixture tears down in order.
        await db.outboundMessage.deleteMany({ where: { employerId } });
        await db.connectionEvent.deleteMany({
          where: { connection: { jobLeadId: leadId } },
        });
        await db.connection.deleteMany({ where: { jobLeadId: leadId } });
        await db.jobLead.deleteMany({ where: { id: leadId } });
        await db.employer.deleteMany({ where: { id: employerId } });
      });

      it("a student reads their OWN connection and nobody else's", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.connection.findMany({
            where: { id: { in: [connectionA, connectionC] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(rows.map((row) => row.id), [connectionA]);
      });

      it("a teacher reads connections for students they manage, and no others", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.connection.findMany({
            where: { id: { in: [connectionA, connectionC] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(
          rows.map((row) => row.id),
          [connectionA],
          "connection_read must keep its managed_student_ids() gate",
        );
      });

      it("a student may move their OWN proposal to student_approved", async () => {
        const updated = await asRole("student", fixtures.studentA, (tx) =>
          tx.connection.updateMany({
            where: { id: connectionA },
            data: { status: "student_approved" },
          }),
        );
        assert.equal(updated.count, 1);
        // Put it back for the cases below.
        await db.connection.update({
          where: { id: connectionA },
          data: { status: "proposed" },
        });
      });

      it("a student may withdraw their own connection", async () => {
        const updated = await asRole("student", fixtures.studentA, (tx) =>
          tx.connection.updateMany({ where: { id: connectionA }, data: { status: "withdrawn" } }),
        );
        assert.equal(updated.count, 1);
        await db.connection.update({ where: { id: connectionA }, data: { status: "proposed" } });
      });

      it("a student may NOT drive any other status — sent, hired, viewed, not_now", async () => {
        // THROWS, it does not return count 0 — the same mechanism as the
        // teacher RETARGET case above. connection_update's USING admits the
        // student's OWN row, so the row IS matched; the new status then fails
        // WITH CHECK, and a WITH CHECK violation raises 42501 rather than
        // filtering the row out.
        //
        // Contrast the cross-student case below, which DOES return count 0: a
        // student fails USING on somebody else's row, so nothing is matched and
        // there is nothing left to check. Expecting a count here (as the first
        // cut did) tests for the one outcome this policy cannot produce.
        for (const status of ["sent", "hired", "viewed", "not_now", "interested"]) {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.connection.updateMany({ where: { id: connectionA }, data: { status } }),
              ),
            /row-level security/i,
            `connection_update's WITH CHECK must refuse a student writing "${status}"`,
          );

          // The rejection aborts its transaction, so the row must still be
          // "proposed". Without this the test would pass on a policy that threw
          // AFTER writing — and the loop's later iterations would be starting
          // from a status the student had already managed to set.
          const after = await db.connection.findUnique({
            where: { id: connectionA },
            select: { status: true },
          });
          assert.equal(
            after?.status,
            "proposed",
            `the student moved the connection to "${status}" before being refused`,
          );
        }
      });

      it("a student cannot touch another student's connection at all", async () => {
        // Count 0, not a throw: Student A fails connection_update's USING on
        // Student C's row, so the row is never matched and no WITH CHECK is
        // reached. "withdrawn" would even be a legal status for its owner —
        // which is the point, the refusal here is about whose row it is.
        const updated = await asRole("student", fixtures.studentA, (tx) =>
          tx.connection.updateMany({ where: { id: connectionC }, data: { status: "withdrawn" } }),
        );
        assert.equal(updated.count, 0);
      });

      it("a student's own UPDATE must LEAVE 'proposed' — standing still is refused", async () => {
        // connection_update's WITH CHECK is written on the row the student
        // leaves behind, not on the change they made, so an update that keeps
        // the status at 'proposed' fails it even though the student owns the
        // row and 'proposed' is where it already was. That is deliberate: the
        // only two things a student may do to a connection are approve it and
        // withdraw it, and "edit it in place" is neither.
        //
        // A throw, not count 0: USING passes (it is their row), so the row IS
        // matched and Postgres evaluates WITH CHECK against the new version.
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.connection.updateMany({
                where: { id: connectionA },
                data: { responseReason: "let me add a note" },
              }),
            ),
          /row-level security/i,
          "a student was able to edit their connection without moving it",
        );
      });

      it("the DATABASE alone would let a student rewrite the packet — the app is the guard", async () => {
        // This case pins a LIMIT, not a protection, and it is here so that
        // nobody reads connection_update and concludes the frozen packet is
        // safe at this layer. RLS is row-level, never column-level: a student
        // whose UPDATE lands on their own row and leaves 'student_approved'
        // behind may change any other column in the same statement, `packet`
        // included. Postgres offers no role-conditional column privilege that
        // would help — column GRANTs are per database role, and vq_app is
        // every application role at once.
        //
        // The real guard is the approve route, which builds the packet from
        // server-side data and never accepts one from the request body. If
        // that ever changes, this test still passes and the product breaks —
        // which is exactly why the fact is written down here rather than
        // assumed.
        const forged = { includedFields: ["everything"], endorsement: "hire me" };
        const updated = await asRole("student", fixtures.studentA, (tx) =>
          tx.connection.updateMany({
            where: { id: connectionA },
            data: { status: "student_approved", packet: forged },
          }),
        );
        assert.equal(updated.count, 1, "the student's own approval was refused");

        const after = await db.connection.findUnique({
          where: { id: connectionA },
          select: { packet: true },
        });
        assert.deepEqual(
          after?.packet,
          forged,
          "the database rejected the packet rewrite — if this now fails, the column IS protected here and the migration comment must be corrected",
        );

        await db.connection.update({
          where: { id: connectionA },
          data: { status: "proposed", packet: Prisma.DbNull },
        });
      });

      it("a student may insert their OWN proposal, and only in 'proposed'", async () => {
        // The bounded student branch that makes propose_connection possible
        // without an admin bypass. Uses studentB, who has no row on this lead.
        //
        // The write shape here is the REAL one `proposeConnection` emits, not
        // a minimal row: the packet is assembled before the insert and written
        // in it, so a policy that happened to admit a bare row while rejecting
        // the one the app actually sends would pass a thinner test and fail in
        // production. `classId` is included for the same reason.
        const created = await asRole("student", fixtures.studentB, (tx) =>
          tx.connection.create({
            data: {
              studentId: fixtures.studentB,
              jobLeadId: leadId,
              employerId,
              proposedById: fixtures.studentB,
              proposedVia: "sage",
              status: "proposed",
              packet: { includedFields: ["resume"], endorsement: "" },
              classId: null,
            },
            select: { id: true },
          }),
        );
        assert.ok(created.id);
        await db.connection.delete({ where: { id: created.id } });

        // Any other starting status is refused, so a student cannot insert a
        // row that is already approved (or already sent).
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentB, (tx) =>
              tx.connection.create({
                data: {
                  studentId: fixtures.studentB,
                  jobLeadId: leadId,
                  employerId,
                  proposedById: fixtures.studentB,
                  proposedVia: "sage",
                  status: "student_approved",
                },
              }),
            ),
          /row-level security/i,
        );
      });

      it("a student cannot insert a connection for someone else", async () => {
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentB, (tx) =>
              tx.connection.create({
                data: {
                  studentId: fixtures.studentA,
                  jobLeadId: leadId,
                  employerId,
                  proposedById: fixtures.studentB,
                  proposedVia: "sage",
                  status: "proposed",
                },
              }),
            ),
          /row-level security/i,
        );
      });

      it("ConnectionEvent is APPEND-ONLY: no update and no delete, for anyone", async () => {
        // A THROW, not count 0, and the difference is the whole point of the
        // guard being doubled. Two mechanisms are stacked here:
        //
        //   1. No UPDATE or DELETE policy exists, so with RLS on no row is
        //      ever matched for those commands, for any role including admin.
        //      On its own that yields a silent `count: 0` — which reads like
        //      "there was nothing to update" rather than "you may not".
        //   2. The privileges are REVOKED from vq_app, so the statement is
        //      rejected outright with 42501 before any row is considered.
        //
        // The regex accepts either message because the mechanisms overlap and
        // Postgres reports whichever it reaches first; what must never happen
        // is a call that succeeds, or one that quietly reports zero rows.
        for (const role of ["student", "teacher", "admin"] as const) {
          const actor =
            role === "student"
              ? fixtures.studentA
              : role === "teacher"
                ? fixtures.teacher
                : fixtures.admin;
          await assert.rejects(
            () =>
              asRole(role, actor, (tx) =>
                tx.connectionEvent.updateMany({ where: { id: eventA }, data: { note: "rewritten" } }),
              ),
            /permission denied|row-level security/i,
            `${role} was able to edit the audit trail`,
          );

          await assert.rejects(
            () =>
              asRole(role, actor, (tx) =>
                tx.connectionEvent.deleteMany({ where: { id: eventA } }),
              ),
            /permission denied|row-level security/i,
            `${role} was able to delete an audit row`,
          );
        }

        // And the row is still exactly as it was written.
        const after = await db.connectionEvent.findUnique({
          where: { id: eventA },
          select: { note: true },
        });
        assert.equal(after?.note ?? null, null, "the audit row was modified");
      });

      it("OutboundMessage is append-only too, and a Connection cannot be deleted", async () => {
        // The same shape as ConnectionEvent, for the same reason: these are the
        // records of what left the program. Connection keeps UPDATE (its whole
        // life is status transitions) but loses DELETE — a disclosure record is
        // closed or withdrawn, never removed.
        await assert.rejects(
          () =>
            asRole("teacher", fixtures.teacher, (tx) =>
              tx.outboundMessage.updateMany({ where: { id: messageA }, data: { status: "edited" } }),
            ),
          /permission denied|row-level security/i,
          "a teacher was able to rewrite the outbound message log",
        );

        await assert.rejects(
          () =>
            asRole("admin", fixtures.admin, (tx) =>
              tx.outboundMessage.deleteMany({ where: { id: messageA } }),
            ),
          /permission denied|row-level security/i,
          "an admin was able to delete from the outbound message log",
        );

        await assert.rejects(
          () =>
            asRole("admin", fixtures.admin, (tx) =>
              tx.connection.deleteMany({ where: { id: connectionA } }),
            ),
          /permission denied|row-level security/i,
          "an admin was able to delete a disclosure record",
        );

        const stillThere = await db.connection.findUnique({
          where: { id: connectionA },
          select: { id: true },
        });
        assert.ok(stillThere, "the connection was deleted");
      });

      it("a student reads the events on their own connection", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.connectionEvent.findMany({ where: { id: eventA }, select: { id: true } }),
        );
        assert.deepEqual(rows.map((row) => row.id), [eventA]);
      });

      it("a student reads NO OutboundMessage rows — that log names the employer contact", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.outboundMessage.findMany({ select: { id: true } }),
        );
        assert.deepEqual(rows, [], "OutboundMessage is staff-read only");
      });

      it("a teacher reads OutboundMessage only for students they manage", async () => {
        // The scoping that outbound_message_read exists for. The first cut
        // admitted any role in ('admin','teacher') to every row, so one
        // student's message log — which names them, their employer and what
        // was said about them — was readable by staff with no relationship to
        // them at all. Asserted in both directions, so a policy that simply
        // returned everything cannot pass.
        const mine = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.outboundMessage.findMany({
            where: { id: { in: [messageA, messageC] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(
          mine.map((row) => row.id),
          [messageA],
          "a teacher must not read the message log of a student they do not manage",
        );

        const theirs = await asRole("teacher", fixtures.teacherB, (tx) =>
          tx.outboundMessage.findMany({
            where: { id: { in: [messageA, messageC] } },
            select: { id: true },
          }),
        );
        assert.deepEqual(
          theirs.map((row) => row.id),
          [messageC],
          "the other teacher must still read their own student's row",
        );
      });

      it("an unattached OutboundMessage row is admin-only", async () => {
        // connectionId is nullable (the FK is SET NULL, and Phase 5's nudges
        // may have no connection at all). There is no student to scope such a
        // row by, so it falls to admin rather than to every teacher —
        // "unscoped therefore visible to all staff" is the exact default this
        // policy replaced.
        const orphan = await db.outboundMessage.create({
          data: {
            channel: "sms",
            toKind: "student",
            toId: "unattached-rls-test",
            templateKey: "connect.nudge",
            body: "no connection attached",
          },
          select: { id: true },
        });

        try {
          const teacherRows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.outboundMessage.findMany({ where: { id: orphan.id }, select: { id: true } }),
          );
          assert.deepEqual(teacherRows, [], "a teacher read an unattached message row");

          const adminRows = await asRole("admin", fixtures.admin, (tx) =>
            tx.outboundMessage.findMany({ where: { id: orphan.id }, select: { id: true } }),
          );
          assert.deepEqual(adminRows.map((row) => row.id), [orphan.id]);
        } finally {
          await db.outboundMessage.deleteMany({ where: { id: orphan.id } });
        }
      });

      it("a student cannot INSERT an OutboundMessage, even one addressed to themselves", async () => {
        // This is the invariant that forces the SMS sender onto prismaAdmin
        // (src/lib/nudges/sms-policy.ts): the nudge runner impersonates the
        // student for their own rows, and if that context could write this
        // table the outbound log would stop being a staff-only audit trail.
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.outboundMessage.create({
                data: {
                  channel: "sms",
                  toKind: "student",
                  toId: fixtures.studentA,
                  templateKey: "weekly_jobs",
                  body: "SPOKES: forged. Reply STOP to stop.",
                },
              }),
            ),
          /row-level security/i,
        );
      });

      it("a student reads and revokes their OWN SMS consent, and nobody else's", async () => {
        // Phase 5 adds smsConsentAt / smsRevokedAt to NotificationPreference,
        // which already has notification_preference_access. Pinned because the
        // settings page writes these as the student: a column that inherited
        // the wrong reach would let one student silence another's texts.
        const own = await asRole("student", fixtures.studentA, async (tx) => {
          const created = await tx.notificationPreference.create({
            data: {
              studentId: fixtures.studentA,
              channel: "sms",
              enabled: true,
              destination: "+13045550123",
              smsConsentAt: new Date(),
            },
          });
          return created.id;
        });

        const readBack = await asRole("student", fixtures.studentA, (tx) =>
          tx.notificationPreference.findMany({
            where: { id: own },
            select: { id: true, smsConsentAt: true },
          }),
        );
        assert.equal(readBack.length, 1);
        assert.ok(readBack[0].smsConsentAt, "the student can see their own consent stamp");

        const otherStudentSees = await asRole("student", fixtures.studentB, (tx) =>
          tx.notificationPreference.findMany({ where: { id: own }, select: { id: true } }),
        );
        assert.deepEqual(otherStudentSees, [], "another student must not see the row at all");

        const revoked = await asRole("student", fixtures.studentA, (tx) =>
          tx.notificationPreference.updateMany({
            where: { id: own },
            data: { enabled: false, smsRevokedAt: new Date() },
          }),
        );
        assert.equal(revoked.count, 1, "a student can always revoke their own consent");

        await db.notificationPreference.deleteMany({ where: { id: own } });
      });

      it("returns zero rows for all three tables with no RLS context", async () => {
        const [connections, events, messages] = await Promise.all([
          asRole(null, null, (tx) => tx.connection.findMany({ select: { id: true } })),
          asRole(null, null, (tx) => tx.connectionEvent.findMany({ select: { id: true } })),
          asRole(null, null, (tx) => tx.outboundMessage.findMany({ select: { id: true } })),
        ]);
        assert.deepEqual(connections, [], "Connection must be empty with no context");
        assert.deepEqual(events, [], "ConnectionEvent must be empty with no context");
        assert.deepEqual(messages, [], "OutboundMessage must be empty with no context");
      });
    });
  });
}
