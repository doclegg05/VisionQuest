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
import { PrismaClient } from "@prisma/client";

type Role = "student" | "teacher" | "admin";

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
  });
}
