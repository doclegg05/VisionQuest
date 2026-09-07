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
 * A negative WRITE case uses `createMany`, never `create` (#23). Prisma's
 * `create` issues a RETURNING, which the USING clause filters, so a `create`
 * that throws under a foreign context may only be proving the READ policy —
 * the WITH CHECK clause could be absent and the test would still pass.
 * `createMany` returns no rows, so a rejection there is the WITH CHECK clause
 * and nothing else. The one deliberate exception is the SageOperation pair
 * below, which keeps a `create` case ALONGSIDE its `createMany` case precisely
 * to show the difference: the `create` is refused by the read policy while the
 * `createMany` succeeds, which is the F17 gap.
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

import { takeSendLock, tryTakeRunLock } from "./nudges/advisory-locks";
import { ADVISORY_LOCK_CLASS } from "./nudges/sms-policy-shared";

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
              tx.goal.createMany({
                data: [{ studentId: fixtures.studentB, level: "daily", content: "forged" }],
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
              tx.notification.createMany({
                data: [{ studentId: fixtures.teacher, ...staffNotification }],
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
              tx.auditLog.createMany({ data: [directWrite(fixtures.studentA, "student")] }),
            ),
          /row-level security/i,
        );
      });

      it("teacher cannot insert an audit row through the app role (DB-03 shape)", async () => {
        await assert.rejects(
          () =>
            asRole("teacher", fixtures.teacher, (tx) =>
              tx.auditLog.createMany({ data: [directWrite(fixtures.teacher, "teacher")] }),
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
              tx.coachingArc.createMany({
                // Distinct arcType so @@unique([studentId, arcType]) cannot be
                // what rejects this; only the policy may.
                data: [{ studentId: fixtures.studentB, arcType: "rlstest_forged" }],
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
              tx.studentAlert.createMany({
                data: [{
                  studentId: fixtures.studentB,
                  alertKey: `rlstest-alert-forged-${fixtures.suffix}`,
                  type: "wellbeing_concern",
                  title: "forged",
                  summary: "forged",
                }],
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
              tx.studentWorkProfile.createMany({
                data: [{ studentId: fixtures.studentB, availability: {} }],
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

    describe("CareerAssessmentSnapshot (career_assessment_snapshot_access)", () => {
      // Adopted from prod drift by migration
      // 20260907150000_adopt_career_assessment_snapshot (F8). The table existed
      // in production for six weeks with NO row-level security at all, holding
      // one student's formal interest-profiler results per row. These cases are
      // the proof that the adoption actually scoped it, not just that the
      // migration ran: every one of them passes trivially on a table with RLS
      // disabled ONLY for the "sees own" read, and fails outright for the rest.
      before(async () => {
        await db.careerAssessmentSnapshot.createMany({
          data: [
            {
              id: `${fixtures.suffix}-snapA`,
              studentId: fixtures.studentA,
              instrument: "onet_mini_ip_30",
              source: "onet_mini_ip",
              riasecScoresRaw: "{}",
              riasecScoresNormalized: "{}",
            },
            {
              id: `${fixtures.suffix}-snapC`,
              studentId: fixtures.studentC,
              instrument: "onet_mini_ip_30",
              source: "manual_entry",
              riasecScoresRaw: "{}",
              riasecScoresNormalized: "{}",
            },
          ],
        });
      });

      it("student sees only own snapshots", async () => {
        const rows = await asRole("student", fixtures.studentA, (tx) =>
          tx.careerAssessmentSnapshot.findMany({
            where: { studentId: { in: [fixtures.studentA, fixtures.studentC] } },
            select: { studentId: true },
          }),
        );
        assert.deepEqual(rows.map((r) => r.studentId), [fixtures.studentA]);
      });

      it("student cannot insert a snapshot for another student", async () => {
        // `createMany`, not `create`, and that is load-bearing. Prisma's
        // `create` ends in RETURNING, which Postgres filters through the USING
        // clause — so a `create` is refused even when WITH CHECK would have
        // admitted the row, and the case would pass for the wrong reason if the
        // WITH CHECK student branch were ever widened. `createMany` returns no
        // rows, so only WITH CHECK can refuse it. (Verified by mutation: with
        // the student branch of WITH CHECK widened to a bare role check, the
        // `create` form still passed and this form goes red.)
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentA, (tx) =>
              tx.careerAssessmentSnapshot.createMany({
                data: [
                  {
                    id: `${fixtures.suffix}-snapEvil`,
                    studentId: fixtures.studentB,
                    instrument: "onet_mini_ip_30",
                    source: "manual_entry",
                    riasecScoresRaw: "{}",
                    riasecScoresNormalized: "{}",
                  },
                ],
              }),
            ),
          /row-level security/i,
        );
      });

      it("student cannot delete another student's snapshot", async () => {
        // A USING-clause exclusion on DELETE reports zero rows rather than
        // throwing (see the two shapes documented in .claude/MEMORY.md), so
        // this asserts the count, not a rejection.
        const removed = await asRole("student", fixtures.studentA, (tx) =>
          tx.careerAssessmentSnapshot.deleteMany({
            where: { id: `${fixtures.suffix}-snapC` },
          }),
        );
        assert.equal(removed.count, 0, "Student C's snapshot is not Student A's to delete");
      });

      it("teacher sees managed students' snapshots only", async () => {
        const rows = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.careerAssessmentSnapshot.findMany({
            where: { studentId: { in: [fixtures.studentA, fixtures.studentC] } },
            select: { studentId: true },
          }),
        );
        assert.deepEqual(rows.map((r) => r.studentId), [fixtures.studentA], "Student C is Teacher B's");
      });

      it("admin sees every snapshot", async () => {
        // Pins the `app.current_role = 'admin'` branch of the USING clause.
        // Without this case that branch can be deleted with every other case in
        // this block still green — admins would simply see nothing, silently,
        // and the offboarding export and any future staff review surface would
        // come back empty rather than refused.
        const rows = await asRole("admin", fixtures.admin, (tx) =>
          tx.careerAssessmentSnapshot.findMany({
            where: { studentId: { in: [fixtures.studentA, fixtures.studentC] } },
            select: { studentId: true },
            orderBy: { studentId: "asc" },
          }),
        );
        // Compared as a set, so a later case adding another of Student A's
        // snapshots cannot turn this red for the wrong reason.
        assert.deepEqual(
          [...new Set(rows.map((r) => r.studentId))].sort(),
          [fixtures.studentA, fixtures.studentC].sort(),
          "admin must see both students' snapshots",
        );
      });

      it("teacher can insert a snapshot for a managed student", async () => {
        // `source: "manual_entry"` is a staff-entered result, so the teacher
        // branch of the WITH CHECK clause is load-bearing, not incidental.
        // Deleting it would break instructor entry; this is the case that
        // notices.
        const created = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.careerAssessmentSnapshot.create({
            data: {
              id: `${fixtures.suffix}-snapByTeacher`,
              studentId: fixtures.studentA,
              instrument: "onet_mini_ip_30",
              source: "manual_entry",
              riasecScoresRaw: "{}",
              riasecScoresNormalized: "{}",
            },
            select: { studentId: true },
          }),
        );
        assert.equal(created.studentId, fixtures.studentA);
      });

      it("teacher cannot insert a snapshot for an unmanaged student", async () => {
        // And this is the case that notices if that same branch is WIDENED to a
        // bare role check: a teacher would be able to write assessment results
        // onto any student in the program. Student C is Teacher B's.
        //
        // `createMany` for the reason spelled out on the student case above —
        // this exact case was first written with `create` and stayed GREEN
        // against a deliberately widened WITH CHECK, because the USING clause
        // refused the RETURNING. It was pinning the read side and reporting the
        // write side.
        await assert.rejects(
          () =>
            asRole("teacher", fixtures.teacher, (tx) =>
              tx.careerAssessmentSnapshot.createMany({
                data: [
                  {
                    id: `${fixtures.suffix}-snapCrossClass`,
                    studentId: fixtures.studentC,
                    instrument: "onet_mini_ip_30",
                    source: "manual_entry",
                    riasecScoresRaw: "{}",
                    riasecScoresNormalized: "{}",
                  },
                ],
              }),
            ),
          /row-level security/i,
        );
      });

      it("coordinator sees nothing (the policy names no coordinator branch)", async () => {
        const rows = await asRole("coordinator" as Role, fixtures.teacher, (tx) =>
          tx.careerAssessmentSnapshot.findMany({ select: { studentId: true } }),
        );
        assert.deepEqual(rows, [], "coordinator must fail closed until the role is region-scoped");
      });

      it("returns zero rows with no RLS context", async () => {
        // Unfiltered on purpose: one row is a leak. This is the case that was
        // false for this table in production before the adoption migration.
        const rows = await asRole(null, null, (tx) =>
          tx.careerAssessmentSnapshot.findMany({ select: { studentId: true } }),
        );
        assert.deepEqual(rows, [], "CareerAssessmentSnapshot must be empty with no context");
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
              tx.employer.createMany({
                data: [{
                  name: `forged ${fixtures.suffix}`,
                  nameKey: `forged ${fixtures.suffix}`,
                  county: "Raleigh",
                  city: "Beckley",
                }],
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

        // Scoped to THIS test's own five leads rather than asserting the whole
        // table. The query is deliberately unfiltered by id — that is the
        // production shape — but the assertion must not be, or any other row
        // in the database reds it. That is not hypothetical: the benchmark
        // cohort seeds `cbenchlead*` rows which are open and program-wide, so
        // this case fails if the cohort is seeded before the RLS suite runs.
        // CI orders those steps safely today; this makes a reorder harmless
        // instead of mysterious. (The advisory-lock block at the end of this
        // file documents that same ordering dependency from the other side.)
        const ownLeads = new Set([
          leadProgramWide,
          leadProgramWideClosed,
          leadAlphaOpen,
          leadAlphaClosed,
          leadBetaOpen,
        ]);
        const mine = rows.filter((row) => ownLeads.has(row.id));
        assert.deepEqual(
          mine.map((row) => row.id).sort(),
          [leadProgramWide, leadAlphaOpen].sort(),
          "open + (program-wide or my class); the closed and other-class leads must not appear",
        );
        assert.ok(
          mine.every((row) => row.employerName.length > 0),
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
              tx.jobLead.createMany({
                data: [{
                  employerId,
                  employerName: "forged",
                  title: "forged",
                  location: "Beckley, WV",
                  source: "manual",
                  sourceRef: `rls-forged-${fixtures.suffix}`,
                  classId: null,
                }],
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
              tx.jobLead.createMany({
                data: [{
                  employerId,
                  employerName: "RLS Test Employer",
                  title: "Cross-class forgery",
                  location: "Beckley, WV",
                  source: "manual",
                  sourceRef: `rls-cross-${fixtures.suffix}`,
                  classId: fixtures.classBeta,
                }],
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
              tx.sageOperation.createMany({
                data: [
                  {
                    ...ledgerRow(`rlstest-op-forged-${fixtures.suffix}`, fixtures.studentB, fixtures.studentB),
                    actorType: "student",
                  },
                ],
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

      it("a student CANNOT withdraw a connection once it is a hire", async () => {
        // The security fix, at the layer that has to hold even if the app
        // forgets. `Connection.applicationId` names an accepted,
        // instructor-verified Application, and the row feeds the placement
        // bridge, the grant KPI report and the DoHS export — so "take this
        // back" on a job the student actually got would leave two records of
        // one event disagreeing, with the funnel counting them as both placed
        // and not.
        //
        // Expressed in USING rather than WITH CHECK because WITH CHECK cannot
        // see the OLD row: "withdrawn is fine unless you WERE hired" is only
        // sayable by refusing to match a hired row at all. That also changes
        // the failure shape — the row is never matched, so this is a silent
        // count 0 rather than a 42501, and the read-back is what proves it.
        for (const status of ["hired", "started", "retained_60"] as const) {
          await db.connection.update({ where: { id: connectionA }, data: { status } });

          const updated = await asRole("student", fixtures.studentA, (tx) =>
            tx.connection.updateMany({
              where: { id: connectionA },
              data: { status: "withdrawn" },
            }),
          );
          assert.equal(
            updated.count,
            0,
            `a student withdrew a "${status}" connection`,
          );

          const after = await db.connection.findUnique({
            where: { id: connectionA },
            select: { status: true },
          });
          assert.equal(
            after?.status,
            status,
            `a verified placement was rewritten from "${status}"`,
          );
        }

        // Staff keep their route: a hire recorded in error is fixable by the
        // person who can also unverify the Application.
        const closed = await asRole("teacher", fixtures.teacher, (tx) =>
          tx.connection.updateMany({ where: { id: connectionA }, data: { status: "closed" } }),
        );
        assert.equal(closed.count, 1, "an instructor could not close a bad hire");

        await db.connection.update({
          where: { id: connectionA },
          data: { status: "proposed" },
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
              tx.connection.createMany({
                data: [{
                  studentId: fixtures.studentB,
                  jobLeadId: leadId,
                  employerId,
                  proposedById: fixtures.studentB,
                  proposedVia: "sage",
                  status: "student_approved",
                }],
              }),
            ),
          /row-level security/i,
        );
      });

      it("a student cannot insert a connection for someone else", async () => {
        await assert.rejects(
          () =>
            asRole("student", fixtures.studentB, (tx) =>
              tx.connection.createMany({
                data: [{
                  studentId: fixtures.studentA,
                  jobLeadId: leadId,
                  employerId,
                  proposedById: fixtures.studentB,
                  proposedVia: "sage",
                  status: "proposed",
                }],
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
              tx.outboundMessage.createMany({
                data: [{
                  channel: "sms",
                  toKind: "student",
                  toId: fixtures.studentA,
                  templateKey: "weekly_jobs",
                  body: "SPOKES: forged. Reply STOP to stop.",
                }],
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

      it("refuses a ResumeVersion or CoverLetter that names NO opening", async () => {
        // The CHECK constraints, exercised as the table OWNER — this is not an
        // RLS property, it is a shape the database must refuse for every
        // writer, including one that never reads tailor-application.ts.
        //
        // A row with neither key is the quiet half of the bug: it is invisible
        // to every packet and every application view, so the tailoring looks
        // like it simply did not happen, which is exactly how the original
        // P2003 failure hid.
        //
        // SCOPE NOTE: the BOTH-keys half of the same constraint is not
        // exercised here, because reaching it needs a real `JobListing`, which
        // needs a JobClassConfig and a scrape batch this suite does not build
        // — and with a fabricated id the FK fires first, so the assertion
        // would pass for the wrong reason. `assertExactlyOneOpening` covers it
        // at the unit level (tailor-application.columns.test.ts), and the
        // constraint text below is the same predicate for both halves.
        await assert.rejects(
          () =>
            db.resumeVersion.create({
              data: {
                studentId: fixtures.studentA,
                version: 1,
                content: {},
                jobListingId: null,
                jobLeadId: null,
              },
            }),
          /violates check constraint/i,
          "a ResumeVersion belonging to no opening was accepted",
        );

        await assert.rejects(
          () =>
            db.coverLetter.create({
              data: {
                studentId: fixtures.studentA,
                version: 1,
                content: "x",
                jobListingId: null,
                jobLeadId: null,
              },
            }),
          /violates check constraint/i,
          "a CoverLetter belonging to no opening was accepted",
        );

        // And the valid shape still inserts, so the constraint is not simply
        // refusing everything.
        const ok = await db.resumeVersion.create({
          data: {
            studentId: fixtures.studentA,
            version: 99,
            content: {},
            jobLeadId: leadId,
          },
          select: { id: true },
        });
        await db.resumeVersion.delete({ where: { id: ok.id } });
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

    // =====================================================================
    // D6 — coverage for the remaining policy-bearing tables.
    //
    // `rls-coverage` (config/benchmarks/rls-coverage.json) counts a table as
    // covered only when at least one it() attributed to it asserts a NON-empty
    // result and at least one asserts an EMPTY/rejected one. Before this
    // section 19 of 93 policy-bearing tables cleared that bar; `Message`,
    // `SpokesRecord` and `Certification` — three of the most sensitive tables
    // in the product — had no case at all.
    //
    // Every table below gets exactly that pair, written against the policy SQL
    // actually installed (read out of pg_policies, not out of a migration file,
    // so a later migration that ALTERed a policy is what is being pinned):
    //
    //   positive — the role the policy admits reads the row it owns/manages,
    //              and NOT the neighbouring row it does not.
    //   negative — the role the policy excludes either reads zero rows (a
    //              USING exclusion) or is refused with 42501 (a WITH CHECK
    //              violation). Which of the two is asserted follows the clause
    //              type in play, never the shape of the nearest existing test:
    //              a USING exclusion on UPDATE/DELETE reports zero rows
    //              affected and does NOT throw.
    //
    // Every negative write case uses `createMany`, never `create`: `create`
    // issues a RETURNING that the USING clause filters, so a `create` that
    // throws may only prove the READ policy. `createMany` returns no rows, so
    // a rejection there is the WITH CHECK clause and nothing else (#23).
    //
    // Fixture rows are created as `postgres` (RLS is not in force at the top
    // level), share the run's `fixtures.suffix`, and carry a `d6-` id prefix so
    // the teardown below can find them without a second bookkeeping list.
    describe("policy-bearing table coverage (D6)", () => {
      /** Deterministic, per-run, greppable id for a fixture row. */
      const d6 = (name: string) => `d6-${fixtures.suffix}-${name}`;
      /** Everything this section creates lives under this prefix. */
      const d6Prefix = () => `d6-${fixtures.suffix}-`;

      const ids = {
        opportunity: "",
        careerEvent: "",
        orientationItem: "",
        certTemplate: "",
        checklistTemplate: "",
        moduleTemplate: "",
        formTemplate: "",
        pathwayActive: "",
        pathwayInactive: "",
        progressionEdge: "",
        region: "",
        lmsLink: "",
        sageSnippet: "",
        docBoth: "",
        docTeacher: "",
        chunkBoth: "",
        chunkTeacher: "",
        employer: "",
        jobLead: "",
        jobConfigAlpha: "",
        jobConfigBeta: "",
        listingAlpha: "",
        listingBeta: "",
        scrapeRunAlpha: "",
        scrapeResultAlpha: "",
        classRequirementAlpha: "",
        classRequirementBeta: "",
        role: "",
        permission: "",
        rolePermission: "",
        goalC: "",
        recordA: "",
        recordC: "",
        certA: "",
        certC: "",
        campaignA: "",
        campaignC: "",
        wagerA: "",
        wagerC: "",
        memoryEdge: "",
      };

      before(async () => {
        // ---- Global / catalog rows (no owner column; policies key off role).
        const [opp, evt, orient, certTpl, checkTpl, modTpl, formTpl, region] = await Promise.all([
          db.opportunity.create({
            data: { id: d6("opp"), title: "RLS Opportunity", company: "Acme WV" },
          }),
          db.careerEvent.create({
            data: {
              id: d6("event"),
              title: "RLS Career Fair",
              startsAt: new Date("2026-10-01T14:00:00Z"),
              endsAt: new Date("2026-10-01T16:00:00Z"),
            },
          }),
          db.orientationItem.create({ data: { id: d6("orient"), label: "RLS orientation item" } }),
          db.certTemplate.create({ data: { id: d6("certtpl"), label: "RLS cert requirement" } }),
          db.spokesChecklistTemplate.create({
            data: { id: d6("checktpl"), label: "RLS checklist", category: "intake" },
          }),
          db.spokesModuleTemplate.create({ data: { id: d6("modtpl"), label: "RLS module" } }),
          db.formTemplate.create({
            data: { id: d6("formtpl"), title: "RLS form", schema: {}, status: "active" },
          }),
          db.region.create({ data: { id: d6("region"), name: "RLS Region", code: d6("rgn") } }),
        ]);
        ids.opportunity = opp.id;
        ids.careerEvent = evt.id;
        ids.orientationItem = orient.id;
        ids.certTemplate = certTpl.id;
        ids.checklistTemplate = checkTpl.id;
        ids.moduleTemplate = modTpl.id;
        ids.formTemplate = formTpl.id;
        ids.region = region.id;

        await db.lmsLink.create({
          data: { id: d6("lms"), title: "RLS LMS", url: "https://example.test", category: "lms" },
        });
        ids.lmsLink = d6("lms");

        await db.sageSnippet.create({
          data: { id: d6("snippet"), question: "q", answer: "a", authorId: fixtures.teacher },
        });
        ids.sageSnippet = d6("snippet");

        await db.pathway.createMany({
          data: [
            { id: d6("pathway-on"), label: "RLS pathway (active)", active: true },
            { id: d6("pathway-off"), label: "RLS pathway (retired)", active: false },
          ],
        });
        ids.pathwayActive = d6("pathway-on");
        ids.pathwayInactive = d6("pathway-off");

        await db.progressionEdge.create({
          data: { id: d6("edge"), fromId: d6("node-from"), toId: d6("node-to") },
        });
        ids.progressionEdge = d6("edge");

        // ---- ProgramDocument / DocumentChunk: the audience column is the
        // policy, so both audiences exist or the negative proves nothing.
        await db.programDocument.createMany({
          data: [
            {
              id: d6("doc-both"),
              title: "RLS doc (BOTH)",
              storageKey: d6("doc-both-key"),
              category: "STUDENT_RESOURCE",
              audience: "BOTH",
            },
            {
              id: d6("doc-teacher"),
              title: "RLS doc (TEACHER)",
              storageKey: d6("doc-teacher-key"),
              category: "TEACHER_GUIDE",
              audience: "TEACHER",
            },
          ],
        });
        ids.docBoth = d6("doc-both");
        ids.docTeacher = d6("doc-teacher");
        await db.documentChunk.createMany({
          data: [
            { id: d6("chunk-both"), documentId: ids.docBoth, chunkIndex: 0, content: "public chunk" },
            {
              id: d6("chunk-teacher"),
              documentId: ids.docTeacher,
              chunkIndex: 0,
              content: "staff-only chunk",
            },
          ],
        });
        ids.chunkBoth = d6("chunk-both");
        ids.chunkTeacher = d6("chunk-teacher");

        // ---- Employer + JobLead: only here because ResumeVersion and
        // CoverLetter carry a CHECK constraint requiring one opening.
        const employer = await db.employer.create({
          data: {
            id: d6("employer"),
            name: `D6 Employer ${fixtures.suffix}`,
            nameKey: d6("employer-key"),
            county: "Raleigh",
            city: "Beckley",
          },
        });
        ids.employer = employer.id;
        const lead = await db.jobLead.create({
          data: {
            id: d6("lead"),
            employerId: employer.id,
            employerName: employer.name,
            title: "D6 lead",
            location: "Beckley, WV",
            source: "manual",
            sourceRef: d6("lead-ref"),
            classId: null,
          },
        });
        ids.jobLead = lead.id;

        // ---- Class-scoped job board: one config per class (classId is unique).
        await db.jobClassConfig.createMany({
          data: [
            { id: d6("jcc-alpha"), classId: fixtures.classAlpha, region: "Beckley, WV" },
            { id: d6("jcc-beta"), classId: fixtures.classBeta, region: "Beckley, WV" },
          ],
        });
        ids.jobConfigAlpha = d6("jcc-alpha");
        ids.jobConfigBeta = d6("jcc-beta");

        const listingBase = {
          location: "Beckley, WV",
          description: "d6",
          url: "https://example.test/job",
          source: "manual",
          sourceType: "manual",
          scrapeBatchId: d6("batch"),
        };
        await db.jobListing.createMany({
          data: [
            {
              id: d6("listing-alpha"),
              title: "Alpha listing",
              company: "Acme",
              sourceId: d6("listing-alpha-src"),
              classConfigId: ids.jobConfigAlpha,
              ...listingBase,
            },
            {
              id: d6("listing-beta"),
              title: "Beta listing",
              company: "Acme",
              sourceId: d6("listing-beta-src"),
              classConfigId: ids.jobConfigBeta,
              ...listingBase,
            },
          ],
        });
        ids.listingAlpha = d6("listing-alpha");
        ids.listingBeta = d6("listing-beta");

        await db.jobScrapeRun.create({
          data: { id: d6("scrape-run"), classConfigId: ids.jobConfigAlpha },
        });
        ids.scrapeRunAlpha = d6("scrape-run");
        await db.jobScrapeSourceResult.create({
          data: { id: d6("scrape-result"), scrapeRunId: ids.scrapeRunAlpha, source: "manual" },
        });
        ids.scrapeResultAlpha = d6("scrape-result");

        await db.classRequirement.createMany({
          data: [
            {
              id: d6("classreq-alpha"),
              classId: fixtures.classAlpha,
              itemType: "certification",
              itemId: "ready-to-work",
              title: "Alpha requirement",
            },
            {
              id: d6("classreq-beta"),
              classId: fixtures.classBeta,
              itemType: "certification",
              itemId: "ready-to-work",
              title: "Beta requirement",
            },
          ],
        });
        ids.classRequirementAlpha = d6("classreq-alpha");
        ids.classRequirementBeta = d6("classreq-beta");

        // ---- Admin-only tables.
        const [role, permission] = await Promise.all([
          db.role.create({
            data: { id: d6("role"), name: d6("role-name"), displayName: "D6 role", hierarchyLevel: 4 },
          }),
          db.permission.create({
            data: { id: d6("perm"), key: d6("perm-key"), namespace: "d6", displayName: "D6 perm" },
          }),
        ]);
        ids.role = role.id;
        ids.permission = permission.id;
        await db.rolePermission.create({
          data: { id: d6("roleperm"), roleId: role.id, permissionId: permission.id },
        });
        ids.rolePermission = d6("roleperm");

        await Promise.all([
          db.systemConfig.create({ data: { id: d6("cfg"), key: d6("cfg-key"), value: "d6" } }),
          db.backgroundJob.create({ data: { id: d6("job"), type: "d6", payload: "{}" } }),
          db.grantGoal.create({
            data: {
              id: d6("grantgoal"),
              regionId: ids.region,
              programType: "spokes",
              metric: "placements",
              targetValue: 10,
              periodStart: new Date("2026-07-01T00:00:00Z"),
              periodEnd: new Date("2027-06-30T00:00:00Z"),
            },
          }),
          db.grantKpiSnapshot.create({
            data: {
              id: d6("kpi"),
              programYear: `FY-${fixtures.suffix}`,
              snapshotDate: new Date("2026-09-01T00:00:00Z"),
              metrics: "{}",
              counts: "{}",
            },
          }),
          db.rateLimitEntry.create({
            data: { key: d6("ratelimit"), resetTime: new Date("2027-01-01T00:00:00Z") },
          }),
          db.sageConfirmationUse.create({
            data: { tokenHash: d6("tokenhash"), expiresAt: new Date("2027-01-01T00:00:00Z") },
          }),
          db.webhookSubscription.create({
            data: { id: d6("webhook"), url: "https://example.test/hook", secret: "s" },
          }),
          db.regionCoordinator.create({
            data: { regionId: ids.region, coordinatorId: fixtures.admin },
          }),
        ]);

        // ---- Student-owned rows: one for Student A, one for Student C.
        // C belongs to Teacher B's class, so "A must not see C's row" doubles
        // as the classroom-isolation assertion for the teacher branch.
        const goalC = await db.goal.create({
          data: { id: d6("goal-c"), studentId: fixtures.studentC, level: "weekly", content: "C's goal" },
        });
        ids.goalC = goalC.id;

        await db.message.createMany({
          data: [
            {
              id: d6("msg-a"),
              conversationId: fixtures.conversationA,
              studentId: fixtures.studentA,
              role: "user",
              content: "A's message",
            },
            {
              id: d6("msg-c"),
              conversationId: fixtures.conversationC,
              studentId: fixtures.studentC,
              role: "user",
              content: "C's message",
            },
          ],
        });

        await db.moodEntry.createMany({
          data: [
            { id: d6("mood-a"), studentId: fixtures.studentA, score: 4, source: "chat" },
            { id: d6("mood-c"), studentId: fixtures.studentC, score: 2, source: "chat" },
          ],
        });

        await db.certification.createMany({
          data: [
            { id: d6("cert-a"), studentId: fixtures.studentA },
            { id: d6("cert-c"), studentId: fixtures.studentC },
          ],
        });
        ids.certA = d6("cert-a");
        ids.certC = d6("cert-c");
        await db.certRequirement.createMany({
          data: [
            { id: d6("certreq-a"), certificationId: ids.certA, templateId: ids.certTemplate },
            { id: d6("certreq-c"), certificationId: ids.certC, templateId: ids.certTemplate },
          ],
        });

        const uploadBase = { mimeType: "application/pdf", sizeBytes: 10 };
        await db.fileUpload.createMany({
          data: [
            {
              id: d6("file-a"),
              studentId: fixtures.studentA,
              filename: "a.pdf",
              storageKey: d6("file-a-key"),
              ...uploadBase,
            },
            {
              id: d6("file-c"),
              studentId: fixtures.studentC,
              filename: "c.pdf",
              storageKey: d6("file-c-key"),
              ...uploadBase,
            },
          ],
        });

        await db.formSubmission.createMany({
          data: [
            {
              id: d6("sub-a"),
              studentId: fixtures.studentA,
              formId: "rls-form",
              fileId: d6("file-a"),
            },
            {
              id: d6("sub-c"),
              studentId: fixtures.studentC,
              formId: "rls-form",
              fileId: d6("file-c"),
            },
          ],
        });

        await db.formResponse.createMany({
          data: [
            {
              id: d6("resp-a"),
              templateId: ids.formTemplate,
              studentId: fixtures.studentA,
              answers: {},
            },
            {
              id: d6("resp-c"),
              templateId: ids.formTemplate,
              studentId: fixtures.studentC,
              answers: {},
            },
          ],
        });

        await db.formAssignment.createMany({
          data: [
            {
              id: d6("assign-a"),
              templateId: ids.formTemplate,
              scope: "student",
              targetId: fixtures.studentA,
            },
            {
              id: d6("assign-c"),
              templateId: ids.formTemplate,
              scope: "student",
              targetId: fixtures.studentC,
            },
          ],
        });

        await db.resumeData.createMany({
          data: [
            { id: d6("resume-a"), studentId: fixtures.studentA, data: "{}" },
            { id: d6("resume-c"), studentId: fixtures.studentC, data: "{}" },
          ],
        });

        await db.resumeVersion.createMany({
          data: [
            {
              id: d6("rv-a"),
              studentId: fixtures.studentA,
              version: 1,
              content: {},
              jobLeadId: ids.jobLead,
            },
            {
              id: d6("rv-c"),
              studentId: fixtures.studentC,
              version: 1,
              content: {},
              jobLeadId: ids.jobLead,
            },
          ],
        });

        await db.coverLetter.createMany({
          data: [
            {
              id: d6("cl-a"),
              studentId: fixtures.studentA,
              version: 1,
              content: "A",
              jobLeadId: ids.jobLead,
            },
            {
              id: d6("cl-c"),
              studentId: fixtures.studentC,
              version: 1,
              content: "C",
              jobLeadId: ids.jobLead,
            },
          ],
        });

        await db.application.createMany({
          data: [
            { id: d6("app-a"), studentId: fixtures.studentA, opportunityId: ids.opportunity },
            { id: d6("app-c"), studentId: fixtures.studentC, opportunityId: ids.opportunity },
          ],
        });

        await db.studentSavedJob.createMany({
          data: [
            { id: d6("saved-a"), studentId: fixtures.studentA, jobListingId: ids.listingAlpha },
            { id: d6("saved-c"), studentId: fixtures.studentC, jobListingId: ids.listingBeta },
          ],
        });

        await db.careerDiscovery.createMany({
          data: [
            { id: d6("disc-a"), studentId: fixtures.studentA },
            { id: d6("disc-c"), studentId: fixtures.studentC },
          ],
        });

        await db.visionBoardItem.createMany({
          data: [
            { id: d6("vision-a"), studentId: fixtures.studentA, type: "note" },
            { id: d6("vision-c"), studentId: fixtures.studentC, type: "note" },
          ],
        });

        await db.studentTask.createMany({
          data: [
            {
              id: d6("task-a"),
              studentId: fixtures.studentA,
              createdById: fixtures.teacher,
              title: "A's task",
            },
            {
              id: d6("task-c"),
              studentId: fixtures.studentC,
              createdById: fixtures.teacherB,
              title: "C's task",
            },
          ],
        });

        await db.appointment.createMany({
          data: [
            {
              id: d6("appt-a"),
              studentId: fixtures.studentA,
              advisorId: fixtures.teacher,
              title: "A's advising",
              startsAt: new Date("2026-10-05T14:00:00Z"),
              endsAt: new Date("2026-10-05T14:30:00Z"),
            },
            {
              id: d6("appt-c"),
              studentId: fixtures.studentC,
              advisorId: fixtures.teacherB,
              title: "C's advising",
              startsAt: new Date("2026-10-05T14:00:00Z"),
              endsAt: new Date("2026-10-05T14:30:00Z"),
            },
          ],
        });

        await db.advisorAvailability.createMany({
          data: [
            {
              id: d6("avail-t"),
              advisorId: fixtures.teacher,
              weekday: 1,
              startMinutes: 540,
              endMinutes: 600,
            },
            {
              id: d6("avail-tb"),
              advisorId: fixtures.teacherB,
              weekday: 2,
              startMinutes: 540,
              endMinutes: 600,
              active: false,
            },
          ],
        });

        await db.llmCallLog.createMany({
          data: [
            { id: d6("llm-a"), studentId: fixtures.studentA, callSite: "d6", model: "test" },
            { id: d6("llm-c"), studentId: fixtures.studentC, callSite: "d6", model: "test" },
          ],
        });

        await db.sageInsight.createMany({
          data: [
            { id: d6("insight-a"), studentId: fixtures.studentA, category: "goal", content: "A" },
            { id: d6("insight-c"), studentId: fixtures.studentC, category: "goal", content: "C" },
          ],
        });

        await db.progression.createMany({
          data: [
            { id: d6("prog-a"), studentId: fixtures.studentA, state: "{}" },
            { id: d6("prog-c"), studentId: fixtures.studentC, state: "{}" },
          ],
        });

        await db.progressionEvent.createMany({
          data: [
            {
              id: d6("progevt-a"),
              studentId: fixtures.studentA,
              eventType: "goal_completed",
              sourceType: "goal",
              sourceId: fixtures.goalA,
              xp: 10,
            },
            {
              id: d6("progevt-c"),
              studentId: fixtures.studentC,
              eventType: "goal_completed",
              sourceType: "goal",
              sourceId: ids.goalC,
              xp: 10,
            },
          ],
        });

        await db.portfolioItem.createMany({
          data: [
            { id: d6("port-a"), studentId: fixtures.studentA, title: "A's project" },
            { id: d6("port-c"), studentId: fixtures.studentC, title: "C's project" },
          ],
        });

        await db.publicCredentialPage.createMany({
          data: [
            { id: d6("cred-a"), studentId: fixtures.studentA, slug: d6("cred-a-slug") },
            { id: d6("cred-c"), studentId: fixtures.studentC, slug: d6("cred-c-slug") },
          ],
        });

        await db.orientationProgress.createMany({
          data: [
            { id: d6("orientprog-a"), studentId: fixtures.studentA, itemId: ids.orientationItem },
            { id: d6("orientprog-c"), studentId: fixtures.studentC, itemId: ids.orientationItem },
          ],
        });

        await db.goalResourceLink.createMany({
          data: [
            {
              id: d6("grl-a"),
              goalId: fixtures.goalA,
              studentId: fixtures.studentA,
              resourceType: "document",
              resourceId: ids.docBoth,
              title: "A's resource",
            },
            {
              id: d6("grl-c"),
              goalId: ids.goalC,
              studentId: fixtures.studentC,
              resourceType: "document",
              resourceId: ids.docBoth,
              title: "C's resource",
            },
          ],
        });

        await db.eventRegistration.createMany({
          data: [
            { id: d6("reg-a"), studentId: fixtures.studentA, eventId: ids.careerEvent },
            { id: d6("reg-c"), studentId: fixtures.studentC, eventId: ids.careerEvent },
          ],
        });

        await db.careerCampaign.createMany({
          data: [
            { id: d6("camp-a"), studentId: fixtures.studentA },
            { id: d6("camp-c"), studentId: fixtures.studentC },
          ],
        });
        ids.campaignA = d6("camp-a");
        ids.campaignC = d6("camp-c");
        await db.campaignStep.createMany({
          data: [
            { id: d6("step-a"), campaignId: ids.campaignA, stage: "discover", proposedActions: {} },
            { id: d6("step-c"), campaignId: ids.campaignC, stage: "discover", proposedActions: {} },
          ],
        });

        // ---- SpokesRecord and its three children.
        await db.spokesRecord.createMany({
          data: [
            { id: d6("rec-a"), studentId: fixtures.studentA, firstName: "Student", lastName: "A" },
            { id: d6("rec-c"), studentId: fixtures.studentC, firstName: "Student", lastName: "C" },
          ],
        });
        ids.recordA = d6("rec-a");
        ids.recordC = d6("rec-c");
        await db.spokesChecklistProgress.createMany({
          data: [
            { id: d6("chk-a"), recordId: ids.recordA, templateId: ids.checklistTemplate },
            { id: d6("chk-c"), recordId: ids.recordC, templateId: ids.checklistTemplate },
          ],
        });
        await db.spokesModuleProgress.createMany({
          data: [
            {
              id: d6("mod-a"),
              recordId: ids.recordA,
              templateId: ids.moduleTemplate,
              completedAt: new Date("2026-09-01T00:00:00Z"),
            },
            {
              id: d6("mod-c"),
              recordId: ids.recordC,
              templateId: ids.moduleTemplate,
              completedAt: new Date("2026-09-01T00:00:00Z"),
            },
          ],
        });
        await db.spokesEmploymentFollowUp.createMany({
          data: [
            {
              id: d6("follow-a"),
              recordId: ids.recordA,
              checkpointMonths: 1,
              status: "employed",
              checkedAt: new Date("2026-09-01T00:00:00Z"),
            },
            {
              id: d6("follow-c"),
              recordId: ids.recordC,
              checkpointMonths: 1,
              status: "employed",
              checkedAt: new Date("2026-09-01T00:00:00Z"),
            },
          ],
        });

        // ---- Wager / WagerVerdict (read-only policies, student branch keyed
        // off app.current_student_id).
        const wagerBase = {
          wagerType: "goal_completion",
          targetType: "goal",
          hypothesis: "h",
          predictedOutcome: "yes",
          horizonAt: new Date("2026-12-01T00:00:00Z"),
        };
        await db.wager.createMany({
          data: [
            { id: d6("wager-a"), studentId: fixtures.studentA, targetId: fixtures.goalA, ...wagerBase },
            { id: d6("wager-c"), studentId: fixtures.studentC, targetId: ids.goalC, ...wagerBase },
          ],
        });
        ids.wagerA = d6("wager-a");
        ids.wagerC = d6("wager-c");
        await db.wagerVerdict.createMany({
          data: [
            {
              id: d6("verdict-a"),
              wagerId: ids.wagerA,
              outcome: "hit",
              result: "done",
              resolvedBy: fixtures.teacher,
              evidence: {},
            },
            {
              id: d6("verdict-c"),
              wagerId: ids.wagerC,
              outcome: "miss",
              result: "not done",
              resolvedBy: fixtures.teacherB,
              evidence: {},
            },
          ],
        });

        // ---- SagePanel, ConsentRecord, PasswordResetToken,
        // SecurityQuestionAnswer, FailedExtraction, SageMemoryEdge.
        await db.sagePanel.createMany({
          data: [
            {
              id: d6("panel-a"),
              studentId: fixtures.studentA,
              panelDate: new Date("2026-09-01T00:00:00Z"),
              spec: {},
            },
            {
              id: d6("panel-c"),
              studentId: fixtures.studentC,
              panelDate: new Date("2026-09-01T00:00:00Z"),
              spec: {},
            },
          ],
        });

        await db.consentRecord.createMany({
          data: [
            {
              id: d6("consent-a"),
              studentId: fixtures.studentA,
              scope: "cloud_file_processing",
              recordedBy: fixtures.studentA,
            },
            {
              id: d6("consent-c"),
              studentId: fixtures.studentC,
              scope: "cloud_file_processing",
              recordedBy: fixtures.studentC,
            },
          ],
        });

        await db.passwordResetToken.createMany({
          data: [
            {
              id: d6("reset-a"),
              studentId: fixtures.studentA,
              tokenHash: d6("reset-a-hash"),
              expiresAt: new Date("2027-01-01T00:00:00Z"),
            },
            {
              id: d6("reset-c"),
              studentId: fixtures.studentC,
              tokenHash: d6("reset-c-hash"),
              expiresAt: new Date("2027-01-01T00:00:00Z"),
            },
          ],
        });

        await db.securityQuestionAnswer.createMany({
          data: [
            {
              id: d6("secq-a"),
              studentId: fixtures.studentA,
              questionKey: "first_pet",
              answerHash: "x",
            },
            {
              id: d6("secq-c"),
              studentId: fixtures.studentC,
              questionKey: "first_pet",
              answerHash: "x",
            },
          ],
        });

        await db.failedExtraction.createMany({
          data: [
            {
              id: d6("failed-a"),
              studentId: fixtures.studentA,
              extractorKey: "memory",
              payload: "{}",
              error: "boom",
              attempts: 1,
            },
            {
              id: d6("failed-c"),
              studentId: fixtures.studentC,
              extractorKey: "memory",
              payload: "{}",
              error: "boom",
              attempts: 1,
            },
          ],
        });

        // Edge FROM Student A's memory TO Student B's: the read policy keys off
        // the `fromId` memory's subject only, so this is the row that shows
        // whether that is the clause actually in force.
        await db.sageMemoryEdge.create({
          data: {
            id: d6("memedge"),
            fromId: fixtures.memoryA,
            toId: fixtures.memoryB,
            predicate: "relates_to",
            evidence: "d6",
          },
        });
        ids.memoryEdge = d6("memedge");
      });

      after(async () => {
        // Teardown order matters: children first, then the rows they point at.
        // Everything created above carries the `d6-<suffix>-` id prefix, except
        // RateLimitEntry (keyed by `key`), SageConfirmationUse (keyed by
        // `tokenHash`) and RegionCoordinator (composite key, cascades from
        // Region). Rows with a Student FK would cascade at the outer teardown
        // anyway; deleting them here keeps a mid-run failure from leaving them.
        const p = { startsWith: d6Prefix() };
        await db.wagerVerdict.deleteMany({ where: { id: p } });
        await db.wager.deleteMany({ where: { id: p } });
        await db.spokesChecklistProgress.deleteMany({ where: { id: p } });
        await db.spokesModuleProgress.deleteMany({ where: { id: p } });
        await db.spokesEmploymentFollowUp.deleteMany({ where: { id: p } });
        await db.spokesRecord.deleteMany({ where: { id: p } });
        await db.campaignStep.deleteMany({ where: { id: p } });
        await db.careerCampaign.deleteMany({ where: { id: p } });
        await db.certRequirement.deleteMany({ where: { id: p } });
        await db.certification.deleteMany({ where: { id: p } });
        await db.sageMemoryEdge.deleteMany({ where: { id: p } });
        await db.documentChunk.deleteMany({ where: { id: p } });
        await db.programDocument.deleteMany({ where: { id: p } });
        await db.rolePermission.deleteMany({ where: { id: p } });
        await db.role.deleteMany({ where: { id: p } });
        await db.permission.deleteMany({ where: { id: p } });
        await db.grantGoal.deleteMany({ where: { id: p } });
        await db.grantKpiSnapshot.deleteMany({ where: { id: p } });
        await db.region.deleteMany({ where: { id: p } });
        await db.rateLimitEntry.deleteMany({ where: { key: p } });
        await db.sageConfirmationUse.deleteMany({ where: { tokenHash: p } });
        await db.webhookSubscription.deleteMany({ where: { id: p } });
        await db.backgroundJob.deleteMany({ where: { id: p } });
        await db.systemConfig.deleteMany({ where: { id: p } });
        await db.formSubmission.deleteMany({ where: { id: p } });
        await db.formResponse.deleteMany({ where: { id: p } });
        await db.formAssignment.deleteMany({ where: { id: p } });
        await db.formTemplate.deleteMany({ where: { id: p } });
        await db.studentSavedJob.deleteMany({ where: { id: p } });
        await db.jobScrapeSourceResult.deleteMany({ where: { id: p } });
        await db.jobScrapeRun.deleteMany({ where: { id: p } });
        await db.jobListing.deleteMany({ where: { id: p } });
        await db.jobClassConfig.deleteMany({ where: { id: p } });
        await db.classRequirement.deleteMany({ where: { id: p } });
        await db.application.deleteMany({ where: { id: p } });
        await db.eventRegistration.deleteMany({ where: { id: p } });
        await db.careerEvent.deleteMany({ where: { id: p } });
        await db.opportunity.deleteMany({ where: { id: p } });
        await db.orientationProgress.deleteMany({ where: { id: p } });
        await db.orientationItem.deleteMany({ where: { id: p } });
        await db.spokesChecklistTemplate.deleteMany({ where: { id: p } });
        await db.spokesModuleTemplate.deleteMany({ where: { id: p } });
        await db.certTemplate.deleteMany({ where: { id: p } });
        await db.resumeVersion.deleteMany({ where: { id: p } });
        await db.coverLetter.deleteMany({ where: { id: p } });
        await db.jobLead.deleteMany({ where: { id: p } });
        await db.employer.deleteMany({ where: { id: p } });
        await db.pathway.deleteMany({ where: { id: p } });
        await db.progressionEdge.deleteMany({ where: { id: p } });
        await db.lmsLink.deleteMany({ where: { id: p } });
        await db.sageSnippet.deleteMany({ where: { id: p } });
      });

      // ---- Family 1: student-owned rows. Every policy here is the same
      // shape — admin OR studentId = app.current_user_id OR (teacher AND
      // studentId IN managed_student_ids(...)) — over both USING and WITH
      // CHECK. Student A owns one row, Student C (Teacher B's student) the
      // other, so the read case doubles as classroom isolation.
      describe("student-owned tables", () => {
        it("Message: a student reads their own message and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.message.findMany({
              where: { id: { in: [d6("msg-a"), d6("msg-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("msg-a")]);
        });

        it("Message: a student cannot write a message onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.message.createMany({
                  data: [
                    {
                      conversationId: fixtures.conversationC,
                      studentId: fixtures.studentC,
                      role: "user",
                      content: "forged",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("MoodEntry: a student reads their own mood entry and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.moodEntry.findMany({
              where: { id: { in: [d6("mood-a"), d6("mood-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("mood-a")]);
        });

        it("MoodEntry: a student cannot write a mood entry onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.moodEntry.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      score: 1,
                      source: "chat",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("Certification: a student reads their own certification and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.certification.findMany({
              where: { id: { in: [d6("cert-a"), d6("cert-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("cert-a")]);
        });

        it("Certification: a student cannot write a certification onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.certification.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      certType: "d6-forged",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("FileUpload: a student reads their own file upload and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.fileUpload.findMany({
              where: { id: { in: [d6("file-a"), d6("file-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("file-a")]);
        });

        it("FileUpload: a student cannot write a file upload onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.fileUpload.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      filename: "forged.pdf",
                      mimeType: "application/pdf",
                      sizeBytes: 1,
                      storageKey: d6("forged-file"),
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("FormSubmission: a student reads their own signed form submission and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.formSubmission.findMany({
              where: { id: { in: [d6("sub-a"), d6("sub-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("sub-a")]);
        });

        it("FormSubmission: a student cannot write a signed form submission onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.formSubmission.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      formId: "d6-forged",
                      fileId: d6("file-a"),
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("FormResponse: a student reads their own form response and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.formResponse.findMany({
              where: { id: { in: [d6("resp-a"), d6("resp-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("resp-a")]);
        });

        it("FormResponse: a student cannot write a form response onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.formResponse.createMany({
                  data: [
                    {
                      templateId: ids.formTemplate,
                      studentId: fixtures.studentC,
                      answers: { forged: true },
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("ResumeData: a student reads their own resume and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.resumeData.findMany({
              where: { id: { in: [d6("resume-a"), d6("resume-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("resume-a")]);
        });

        it("ResumeData: a student cannot write a resume onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.resumeData.createMany({
                  data: [
                    {
                      studentId: fixtures.studentB,
                      data: "{}",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("ResumeVersion: a student reads their own resume version and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.resumeVersion.findMany({
              where: { id: { in: [d6("rv-a"), d6("rv-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("rv-a")]);
        });

        it("ResumeVersion: a student cannot write a resume version onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.resumeVersion.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      version: 99,
                      content: {},
                      jobLeadId: ids.jobLead,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("CoverLetter: a student reads their own cover letter and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.coverLetter.findMany({
              where: { id: { in: [d6("cl-a"), d6("cl-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("cl-a")]);
        });

        it("CoverLetter: a student cannot write a cover letter onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.coverLetter.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      version: 99,
                      content: "forged",
                      jobLeadId: ids.jobLead,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("Application: a student reads their own job application and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.application.findMany({
              where: { id: { in: [d6("app-a"), d6("app-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("app-a")]);
        });

        it("Application: a student cannot write a job application onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.application.createMany({
                  data: [
                    {
                      studentId: fixtures.studentB,
                      opportunityId: ids.opportunity,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("StudentSavedJob: a student reads their own saved job and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.studentSavedJob.findMany({
              where: { id: { in: [d6("saved-a"), d6("saved-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("saved-a")]);
        });

        it("StudentSavedJob: a student cannot write a saved job onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.studentSavedJob.createMany({
                  data: [
                    {
                      studentId: fixtures.studentB,
                      jobListingId: ids.listingAlpha,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("CareerDiscovery: a student reads their own career discovery and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.careerDiscovery.findMany({
              where: { id: { in: [d6("disc-a"), d6("disc-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("disc-a")]);
        });

        it("CareerDiscovery: a student cannot write a career discovery onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.careerDiscovery.createMany({
                  data: [
                    {
                      studentId: fixtures.studentB,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("VisionBoardItem: a student reads their own vision board item and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.visionBoardItem.findMany({
              where: { id: { in: [d6("vision-a"), d6("vision-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("vision-a")]);
        });

        it("VisionBoardItem: a student cannot write a vision board item onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.visionBoardItem.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      type: "note",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("StudentTask: a student reads their own task and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.studentTask.findMany({
              where: { id: { in: [d6("task-a"), d6("task-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("task-a")]);
        });

        it("StudentTask: a student cannot write a task onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.studentTask.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      createdById: fixtures.studentA,
                      title: "forged",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("Appointment: a student reads their own appointment and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.appointment.findMany({
              where: { id: { in: [d6("appt-a"), d6("appt-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("appt-a")]);
        });

        it("Appointment: a student cannot write a appointment onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.appointment.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      advisorId: fixtures.teacherB,
                      title: "forged",
                      startsAt: new Date("2026-11-05T14:00:00Z"),
                      endsAt: new Date("2026-11-05T14:30:00Z"),
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("LlmCallLog: a student reads their own AI call ledger row and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.llmCallLog.findMany({
              where: { id: { in: [d6("llm-a"), d6("llm-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("llm-a")]);
        });

        it("LlmCallLog: a student cannot write a AI call ledger row onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.llmCallLog.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      callSite: "forged",
                      model: "test",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("SageInsight: a student reads their own Sage insight and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.sageInsight.findMany({
              where: { id: { in: [d6("insight-a"), d6("insight-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("insight-a")]);
        });

        it("SageInsight: a student cannot write a Sage insight onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.sageInsight.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      category: "goal",
                      content: "forged",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("Progression: a student reads their own progression state and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.progression.findMany({
              where: { id: { in: [d6("prog-a"), d6("prog-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("prog-a")]);
        });

        it("Progression: a student cannot write a progression state onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.progression.createMany({
                  data: [
                    {
                      studentId: fixtures.studentB,
                      state: "{}",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("ProgressionEvent: a student reads their own XP event and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.progressionEvent.findMany({
              where: { id: { in: [d6("progevt-a"), d6("progevt-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("progevt-a")]);
        });

        it("ProgressionEvent: a student cannot write a XP event onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.progressionEvent.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      eventType: "forged",
                      sourceType: "goal",
                      sourceId: ids.goalC,
                      xp: 999,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("PortfolioItem: a student reads their own portfolio item and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.portfolioItem.findMany({
              where: { id: { in: [d6("port-a"), d6("port-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("port-a")]);
        });

        it("PortfolioItem: a student cannot write a portfolio item onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.portfolioItem.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                      title: "forged",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("PublicCredentialPage: a student reads their own public credential page and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.publicCredentialPage.findMany({
              where: { id: { in: [d6("cred-a"), d6("cred-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("cred-a")]);
        });

        it("PublicCredentialPage: a student cannot write a public credential page onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.publicCredentialPage.createMany({
                  data: [
                    {
                      studentId: fixtures.studentB,
                      slug: d6("forged-slug"),
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("OrientationProgress: a student reads their own orientation progress row and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.orientationProgress.findMany({
              where: { id: { in: [d6("orientprog-a"), d6("orientprog-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("orientprog-a")]);
        });

        it("OrientationProgress: a student cannot write a orientation progress row onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.orientationProgress.createMany({
                  data: [
                    {
                      studentId: fixtures.studentB,
                      itemId: ids.orientationItem,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("GoalResourceLink: a student reads their own goal resource link and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.goalResourceLink.findMany({
              where: { id: { in: [d6("grl-a"), d6("grl-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("grl-a")]);
        });

        it("GoalResourceLink: a student cannot write a goal resource link onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.goalResourceLink.createMany({
                  data: [
                    {
                      goalId: ids.goalC,
                      studentId: fixtures.studentC,
                      resourceType: "document",
                      resourceId: ids.docBoth,
                      title: "forged",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("EventRegistration: a student reads their own event registration and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.eventRegistration.findMany({
              where: { id: { in: [d6("reg-a"), d6("reg-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("reg-a")]);
        });

        it("EventRegistration: a student cannot write a event registration onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.eventRegistration.createMany({
                  data: [
                    {
                      studentId: fixtures.studentB,
                      eventId: ids.careerEvent,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("CareerCampaign: a student reads their own career campaign and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.careerCampaign.findMany({
              where: { id: { in: [d6("camp-a"), d6("camp-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("camp-a")]);
        });

        it("CareerCampaign: a student cannot write a career campaign onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.careerCampaign.createMany({
                  data: [
                    {
                      studentId: fixtures.studentC,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("SpokesRecord: a student reads their own SPOKES record and not another student's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.spokesRecord.findMany({
              where: { id: { in: [d6("rec-a"), d6("rec-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("rec-a")]);
        });

        it("SpokesRecord: ANY teacher reads an UNLINKED intake record, not only their own students'", async () => {
          // Pinning current behaviour, not endorsing it. spokes_record_access
          // reads `(teacher AND (studentId IN managed OR studentId IS NULL))`,
          // so a record entered before the student has an account is visible
          // to every instructor in the program, in any class or county — the
          // one branch of this policy that is not classroom-scoped. It exists
          // because intake happens before the login does. This case is here so
          // that narrowing it (or widening it further) has to be a deliberate
          // edit to a red test rather than a silent change of reach.
          const unlinked = d6("rec-unlinked");
          await db.spokesRecord.create({
            data: { id: unlinked, studentId: null, firstName: "Walk", lastName: "In" },
          });
          try {
            const rows = await asRole("teacher", fixtures.teacherB, (tx) =>
              tx.spokesRecord.findMany({
                where: { id: { in: [unlinked, d6("rec-a")] } },
                select: { id: true },
              }),
            );
            assert.deepEqual(
              rows.map((r) => r.id),
              [unlinked],
              "Teacher B instructs Class Beta only: the unlinked record is visible, Student A's is not",
            );
          } finally {
            await db.spokesRecord.deleteMany({ where: { id: unlinked } });
          }
        });

        it("SpokesRecord: a student cannot write a SPOKES record onto another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.spokesRecord.createMany({
                  data: [
                    {
                      studentId: fixtures.studentB,
                      firstName: "Forged",
                      lastName: "Record",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

      });

      // ---- Family 2: admin-only tables. `<table>_admin_only` is one ALL
      // policy whose USING and WITH CHECK are both `current_role = 'admin'`,
      // so the excluded role reads zero rows rather than being refused: the
      // negative here is a USING exclusion, not a 42501.
      describe("admin-only tables", () => {
        it("BackgroundJob: admin reads the job row", async () => {
          const rows = await asRole("admin", fixtures.admin, (tx) =>
            tx.backgroundJob.findMany({ where: { id: d6("job") }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("job")]);
        });

        it("BackgroundJob: a teacher reads no job rows", async () => {
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.backgroundJob.findMany({ where: { id: d6("job") }, select: { id: true } }),
          );
          assert.deepEqual(rows, [], "the job queue carries student payloads; staff must not read it");
        });

        it("GrantGoal: admin reads the grant goal", async () => {
          const rows = await asRole("admin", fixtures.admin, (tx) =>
            tx.grantGoal.findMany({ where: { id: d6("grantgoal") }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("grantgoal")]);
        });

        it("GrantGoal: a teacher reads no grant goals", async () => {
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.grantGoal.findMany({ where: { id: d6("grantgoal") }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });

        it("GrantKpiSnapshot: admin reads the KPI snapshot", async () => {
          const rows = await asRole("admin", fixtures.admin, (tx) =>
            tx.grantKpiSnapshot.findMany({ where: { id: d6("kpi") }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("kpi")]);
        });

        it("GrantKpiSnapshot: a teacher reads no KPI snapshots", async () => {
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.grantKpiSnapshot.findMany({ where: { id: d6("kpi") }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });

        it("Permission: admin reads the permission row", async () => {
          const rows = await asRole("admin", fixtures.admin, (tx) =>
            tx.permission.findMany({ where: { id: d6("perm") }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("perm")]);
        });

        it("Permission: a teacher reads no permission rows", async () => {
          // rbac.ts reads this table through prismaAdmin precisely because the
          // app role cannot see it (2026-09-06 hunt). This pins that fact.
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.permission.findMany({ where: { id: d6("perm") }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });

        it("Role: admin reads the role row", async () => {
          const rows = await asRole("admin", fixtures.admin, (tx) =>
            tx.role.findMany({ where: { id: d6("role") }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("role")]);
        });

        it("Role: a teacher reads no role rows", async () => {
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.role.findMany({ where: { id: d6("role") }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });

        it("RolePermission: admin reads the grant row", async () => {
          const rows = await asRole("admin", fixtures.admin, (tx) =>
            tx.rolePermission.findMany({ where: { id: d6("roleperm") }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("roleperm")]);
        });

        it("RolePermission: a teacher reads no grant rows", async () => {
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.rolePermission.findMany({ where: { id: d6("roleperm") }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });

        it("RegionCoordinator: admin reads the assignment", async () => {
          const rows = await asRole("admin", fixtures.admin, (tx) =>
            tx.regionCoordinator.findMany({
              where: { regionId: ids.region },
              select: { regionId: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.regionId), [ids.region]);
        });

        it("RegionCoordinator: a teacher reads no assignments", async () => {
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.regionCoordinator.findMany({
              where: { regionId: ids.region },
              select: { regionId: true },
            }),
          );
          assert.deepEqual(rows, []);
        });

        it("RateLimitEntry: admin reads the counter row", async () => {
          const rows = await asRole("admin", fixtures.admin, (tx) =>
            tx.rateLimitEntry.findMany({ where: { key: d6("ratelimit") }, select: { key: true } }),
          );
          assert.deepEqual(rows.map((r) => r.key), [d6("ratelimit")]);
        });

        it("RateLimitEntry: a student reads no counter rows", async () => {
          // Keys embed student ids, so a readable limiter table is a roster.
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.rateLimitEntry.findMany({ where: { key: d6("ratelimit") }, select: { key: true } }),
          );
          assert.deepEqual(rows, []);
        });

        it("SageConfirmationUse: admin reads the claim row", async () => {
          const rows = await asRole("admin", fixtures.admin, (tx) =>
            tx.sageConfirmationUse.findMany({
              where: { tokenHash: d6("tokenhash") },
              select: { tokenHash: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.tokenHash), [d6("tokenhash")]);
        });

        it("SageConfirmationUse: a student reads no claim rows", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.sageConfirmationUse.findMany({
              where: { tokenHash: d6("tokenhash") },
              select: { tokenHash: true },
            }),
          );
          assert.deepEqual(rows, []);
        });

        it("SystemConfig: admin reads the config row", async () => {
          const rows = await asRole("admin", fixtures.admin, (tx) =>
            tx.systemConfig.findMany({ where: { id: d6("cfg") }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("cfg")]);
        });

        it("SystemConfig: a teacher reads no config rows", async () => {
          // `ai_provider` and the class flag lists live here; a teacher who
          // could read them could read every flag the program runs on.
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.systemConfig.findMany({ where: { id: d6("cfg") }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });

        it("WebhookSubscription: admin reads the subscription", async () => {
          const rows = await asRole("admin", fixtures.admin, (tx) =>
            tx.webhookSubscription.findMany({ where: { id: d6("webhook") }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("webhook")]);
        });

        it("WebhookSubscription: a teacher reads no subscriptions", async () => {
          // The row carries a shared secret in a plain column.
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.webhookSubscription.findMany({ where: { id: d6("webhook") }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });
      });

      // ---- Family 3: catalog tables — readable by everyone (or by everyone
      // once a status/audience column says so), writable only by staff. The
      // negative is a WITH CHECK refusal, so it uses `createMany`.
      describe("catalog tables (public read, staff write)", () => {
        it("CareerEvent: a student reads the event", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.careerEvent.findMany({ where: { id: ids.careerEvent }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.careerEvent]);
        });

        it("CareerEvent: a student cannot create an event", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.careerEvent.createMany({
                  data: [
                    {
                      id: d6("forged-event"),
                      title: "forged",
                      startsAt: new Date("2026-11-01T14:00:00Z"),
                      endsAt: new Date("2026-11-01T15:00:00Z"),
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("CertTemplate: a student reads the cert requirement template", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.certTemplate.findMany({ where: { id: ids.certTemplate }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.certTemplate]);
        });

        it("CertTemplate: a teacher cannot create a cert template (admin-only write)", async () => {
          await assert.rejects(
            () =>
              asRole("teacher", fixtures.teacher, (tx) =>
                tx.certTemplate.createMany({ data: [{ id: d6("forged-certtpl"), label: "forged" }] }),
              ),
            /row-level security/i,
          );
        });

        it("LmsLink: a student reads the LMS link", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.lmsLink.findMany({ where: { id: ids.lmsLink }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.lmsLink]);
        });

        it("LmsLink: a student cannot create an LMS link", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.lmsLink.createMany({
                  data: [
                    {
                      id: d6("forged-lms"),
                      title: "forged",
                      url: "https://evil.test",
                      category: "lms",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("Opportunity: a student reads the opportunity", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.opportunity.findMany({ where: { id: ids.opportunity }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.opportunity]);
        });

        it("Opportunity: a student cannot create an opportunity", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.opportunity.createMany({
                  data: [{ id: d6("forged-opp"), title: "forged", company: "forged" }],
                }),
              ),
            /row-level security/i,
          );
        });

        it("OrientationItem: a student reads the orientation item", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.orientationItem.findMany({
              where: { id: ids.orientationItem },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.orientationItem]);
        });

        it("OrientationItem: a teacher cannot create an orientation item (admin-only write)", async () => {
          await assert.rejects(
            () =>
              asRole("teacher", fixtures.teacher, (tx) =>
                tx.orientationItem.createMany({
                  data: [{ id: d6("forged-orient"), label: "forged" }],
                }),
              ),
            /row-level security/i,
          );
        });

        it("Pathway: a student reads the active pathway and not the retired one", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.pathway.findMany({
              where: { id: { in: [ids.pathwayActive, ids.pathwayInactive] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.pathwayActive], "active = false is staff-only");
        });

        it("Pathway: a student cannot create a pathway", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.pathway.createMany({ data: [{ id: d6("forged-pathway"), label: "forged" }] }),
              ),
            /row-level security/i,
          );
        });

        it("ProgressionEdge: a student reads the prerequisite edge", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.progressionEdge.findMany({
              where: { id: ids.progressionEdge },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.progressionEdge]);
        });

        it("ProgressionEdge: a teacher cannot create an edge (admin-only write)", async () => {
          // The edge table gates journey steps; a teacher who could write one
          // could unlock a step for their whole class.
          await assert.rejects(
            () =>
              asRole("teacher", fixtures.teacher, (tx) =>
                tx.progressionEdge.createMany({
                  data: [{ id: d6("forged-edge"), fromId: d6("x"), toId: d6("y") }],
                }),
              ),
            /row-level security/i,
          );
        });

        it("Region: a student reads the region", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.region.findMany({ where: { id: ids.region }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.region]);
        });

        it("Region: a teacher cannot create a region (admin-only write)", async () => {
          await assert.rejects(
            () =>
              asRole("teacher", fixtures.teacher, (tx) =>
                tx.region.createMany({
                  data: [{ id: d6("forged-region"), name: "forged", code: d6("forged-rgn") }],
                }),
              ),
            /row-level security/i,
          );
        });

        it("SpokesChecklistTemplate: a student reads the checklist template", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.spokesChecklistTemplate.findMany({
              where: { id: ids.checklistTemplate },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.checklistTemplate]);
        });

        it("SpokesChecklistTemplate: a teacher cannot create a template (admin-only write)", async () => {
          await assert.rejects(
            () =>
              asRole("teacher", fixtures.teacher, (tx) =>
                tx.spokesChecklistTemplate.createMany({
                  data: [{ id: d6("forged-checktpl"), label: "forged", category: "intake" }],
                }),
              ),
            /row-level security/i,
          );
        });

        it("SpokesModuleTemplate: a student reads the module template", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.spokesModuleTemplate.findMany({
              where: { id: ids.moduleTemplate },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.moduleTemplate]);
        });

        it("SpokesModuleTemplate: a teacher cannot create a module template (admin-only write)", async () => {
          await assert.rejects(
            () =>
              asRole("teacher", fixtures.teacher, (tx) =>
                tx.spokesModuleTemplate.createMany({
                  data: [{ id: d6("forged-modtpl"), label: "forged" }],
                }),
              ),
            /row-level security/i,
          );
        });

        it("SageSnippet: a student reads the active snippet", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.sageSnippet.findMany({ where: { id: ids.sageSnippet }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.sageSnippet]);
        });

        it("SageSnippet: a student cannot create a snippet", async () => {
          // Snippets are answers Sage may repeat verbatim; a student-writable
          // snippet table is a prompt-injection surface aimed at other students.
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.sageSnippet.createMany({
                  data: [
                    {
                      id: d6("forged-snippet"),
                      question: "q",
                      answer: "forged",
                      authorId: fixtures.studentA,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("FormTemplate: a student reads the active template", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.formTemplate.findMany({ where: { id: ids.formTemplate }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.formTemplate]);
        });

        it("FormTemplate: a student cannot create a form template", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.formTemplate.createMany({
                  data: [{ id: d6("forged-formtpl"), title: "forged", schema: {} }],
                }),
              ),
            /row-level security/i,
          );
        });

        it("ProgramDocument: a student reads the BOTH-audience doc and not the TEACHER one", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.programDocument.findMany({
              where: { id: { in: [ids.docBoth, ids.docTeacher] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.docBoth], "audience is the policy");
        });

        it("ProgramDocument: a student cannot create a program document", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.programDocument.createMany({
                  data: [
                    {
                      id: d6("forged-doc"),
                      title: "forged",
                      storageKey: d6("forged-doc-key"),
                      category: "STUDENT_RESOURCE",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("DocumentChunk: a student reads chunks of a BOTH doc and not of a TEACHER doc", async () => {
          // The chunk table is what RAG retrieves from, so its policy — which
          // reaches through to the parent document's audience — is the one that
          // decides whether staff-only text can be quoted back to a student.
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.documentChunk.findMany({
              where: { id: { in: [ids.chunkBoth, ids.chunkTeacher] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.chunkBoth]);
        });

        it("DocumentChunk: a student cannot create a chunk", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.documentChunk.createMany({
                  data: [
                    {
                      id: d6("forged-chunk"),
                      documentId: ids.docBoth,
                      chunkIndex: 99,
                      content: "forged",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });
      });

      // ---- Family 4: class-scoped tables. The owner column is a class, so
      // reach is decided by enrolled_class_ids() for students and
      // instructor_class_ids() for teachers. Student A is in Class Alpha only;
      // Student C is in Class Beta only.
      describe("class-scoped tables", () => {
        it("SpokesClass: a student reads their own class and not the other one", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.spokesClass.findMany({
              where: { id: { in: [fixtures.classAlpha, fixtures.classBeta] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [fixtures.classAlpha]);
        });

        it("SpokesClass: a student cannot create a class", async () => {
          // The WITH CHECK clause names admin and teacher only — students are
          // absent from it even though they appear in USING.
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.spokesClass.createMany({
                  data: [{ id: d6("forged-class"), name: "forged", code: d6("forged-code") }],
                }),
              ),
            /row-level security/i,
          );
        });

        it("SpokesClassInstructor: a teacher reads their own instructor link", async () => {
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.spokesClassInstructor.findMany({
              where: { classId: { in: [fixtures.classAlpha, fixtures.classBeta] } },
              select: { classId: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.classId), [fixtures.classAlpha]);
        });

        it("SpokesClassInstructor: a teacher cannot add themselves to another class", async () => {
          // USING lets a teacher see their own link; WITH CHECK is admin-only,
          // so self-assignment — which would hand them a whole other roster —
          // is refused. Two different clauses, and only the write one is here.
          await assert.rejects(
            () =>
              asRole("teacher", fixtures.teacher, (tx) =>
                tx.spokesClassInstructor.createMany({
                  data: [{ classId: fixtures.classBeta, instructorId: fixtures.teacher }],
                }),
              ),
            /row-level security/i,
          );
        });

        it("StudentClassEnrollment: a student reads their own enrolment", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.studentClassEnrollment.findMany({
              where: { studentId: { in: [fixtures.studentA, fixtures.studentC] } },
              select: { studentId: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.studentId), [fixtures.studentA]);
        });

        it("StudentClassEnrollment: a student cannot enrol another student", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.studentClassEnrollment.createMany({
                  data: [{ classId: fixtures.classAlpha, studentId: fixtures.studentB }],
                }),
              ),
            /row-level security/i,
          );
        });

        it("ClassRequirement: a student reads their own class's requirement", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.classRequirement.findMany({
              where: { id: { in: [ids.classRequirementAlpha, ids.classRequirementBeta] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.classRequirementAlpha]);
        });

        it("ClassRequirement: a student cannot create a class requirement", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.classRequirement.createMany({
                  data: [
                    {
                      id: d6("forged-classreq"),
                      classId: fixtures.classAlpha,
                      itemType: "certification",
                      itemId: "forged",
                      title: "forged",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("JobClassConfig: a student reads their own class's job config", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.jobClassConfig.findMany({
              where: { id: { in: [ids.jobConfigAlpha, ids.jobConfigBeta] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.jobConfigAlpha]);
        });

        it("JobClassConfig: a student reads no config for a class they are not in", async () => {
          // A USING exclusion, asserted as zero rows rather than a throw:
          // classId is unique on this table, so a forged INSERT would race a
          // unique violation and could pass for the wrong reason.
          // Guard against a vacuous pass: a row that was never inserted is
          // excluded by absence, not by the policy. `db.` is the postgres
          // connection, so this read is not itself subject to RLS.
          const present = await db.jobClassConfig.count({ where: { id: ids.jobConfigBeta } });
          assert.equal(present, 1, "Class Beta's job config fixture is missing");
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.jobClassConfig.findMany({ where: { id: ids.jobConfigBeta }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });

        it("JobListing: a student reads their own class's listing and not the other class's", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.jobListing.findMany({
              where: { id: { in: [ids.listingAlpha, ids.listingBeta] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.listingAlpha]);
        });

        it("JobListing: a student cannot create a job listing", async () => {
          // WITH CHECK names teacher only — the student branch exists in USING
          // and nowhere else, so a student may browse but never publish.
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.jobListing.createMany({
                  data: [
                    {
                      id: d6("forged-listing"),
                      title: "forged",
                      company: "forged",
                      location: "Beckley, WV",
                      description: "forged",
                      url: "https://evil.test",
                      source: "manual",
                      sourceType: "manual",
                      sourceId: d6("forged-listing-src"),
                      scrapeBatchId: d6("forged-batch"),
                      classConfigId: ids.jobConfigAlpha,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("JobScrapeRun: a teacher reads the run for a class they instruct", async () => {
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.jobScrapeRun.findMany({ where: { id: ids.scrapeRunAlpha }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.scrapeRunAlpha]);
        });

        it("JobScrapeRun: a student reads no scrape runs, even for their own class", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.jobScrapeRun.findMany({ where: { id: ids.scrapeRunAlpha }, select: { id: true } }),
          );
          assert.deepEqual(rows, [], "the policy names admin and teacher only");
        });

        it("JobScrapeSourceResult: a teacher reads the source result for their class's run", async () => {
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.jobScrapeSourceResult.findMany({
              where: { id: ids.scrapeResultAlpha },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.scrapeResultAlpha]);
        });

        it("JobScrapeSourceResult: a student reads no source results", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.jobScrapeSourceResult.findMany({
              where: { id: ids.scrapeResultAlpha },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows, []);
        });
      });

      // ---- Family 5: tables with no owner column of their own, whose policy
      // reaches through a parent row (EXISTS ... WHERE parent.studentId = ...).
      // The negative always targets Student C's parent, so what is being pinned
      // is the join in the policy and not merely the row's own columns.
      describe("parent-derived tables", () => {
        it("CampaignStep: a student reads the step on their own campaign", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.campaignStep.findMany({
              where: { id: { in: [d6("step-a"), d6("step-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("step-a")]);
        });

        it("CampaignStep: a student cannot add a step to another student's campaign", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.campaignStep.createMany({
                  data: [
                    {
                      id: d6("forged-step"),
                      campaignId: ids.campaignC,
                      stage: "discover",
                      proposedActions: {},
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("CertRequirement: a student reads the requirement on their own certification", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.certRequirement.findMany({
              where: { id: { in: [d6("certreq-a"), d6("certreq-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("certreq-a")]);
        });

        it("CertRequirement: a student cannot add a requirement to another student's certification", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.certRequirement.createMany({
                  data: [
                    {
                      id: d6("forged-certreq"),
                      certificationId: ids.certC,
                      templateId: ids.certTemplate,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("SpokesChecklistProgress: a student reads the progress on their own SPOKES record", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.spokesChecklistProgress.findMany({
              where: { id: { in: [d6("chk-a"), d6("chk-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("chk-a")]);
        });

        it("SpokesChecklistProgress: a student cannot write progress onto another student's record", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.spokesChecklistProgress.createMany({
                  data: [
                    {
                      id: d6("forged-chk"),
                      recordId: ids.recordC,
                      templateId: ids.checklistTemplate,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("SpokesModuleProgress: a student reads the module progress on their own record", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.spokesModuleProgress.findMany({
              where: { id: { in: [d6("mod-a"), d6("mod-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("mod-a")]);
        });

        it("SpokesModuleProgress: a student cannot write module progress onto another student's record", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.spokesModuleProgress.createMany({
                  data: [
                    {
                      id: d6("forged-mod"),
                      recordId: ids.recordC,
                      templateId: ids.moduleTemplate,
                      completedAt: new Date("2026-09-02T00:00:00Z"),
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("SpokesEmploymentFollowUp: a student reads the follow-up on their own record", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.spokesEmploymentFollowUp.findMany({
              where: { id: { in: [d6("follow-a"), d6("follow-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("follow-a")]);
        });

        it("SpokesEmploymentFollowUp: a student cannot write a follow-up onto another student's record", async () => {
          // These rows are the DoHS/WIOA employment checkpoints a grant is
          // reported on, so a cross-student write is a reporting-integrity bug
          // as much as a privacy one.
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.spokesEmploymentFollowUp.createMany({
                  data: [
                    {
                      id: d6("forged-follow"),
                      recordId: ids.recordC,
                      checkpointMonths: 3,
                      status: "employed",
                      checkedAt: new Date("2026-09-02T00:00:00Z"),
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("SageMemoryEdge: a student reads an edge whose source memory is theirs", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.sageMemoryEdge.findMany({ where: { id: ids.memoryEdge }, select: { id: true } }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.memoryEdge]);
        });

        it("SageMemoryEdge: a student cannot create an edge", async () => {
          // The read policy has a student branch; the write policy does not.
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.sageMemoryEdge.createMany({
                  data: [
                    {
                      id: d6("forged-memedge"),
                      fromId: fixtures.memoryA,
                      toId: fixtures.memoryB,
                      predicate: "relates_to",
                      evidence: "forged",
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("WagerVerdict: a student reads the verdict on their own wager", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.wagerVerdict.findMany({
              where: { id: { in: [d6("verdict-a"), d6("verdict-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("verdict-a")]);
        });

        it("WagerVerdict: a student reads no verdict on another student's wager", async () => {
          // A read-only table: there is no INSERT/UPDATE/DELETE policy at all,
          // so the only assertable negative is the USING exclusion.
          // Guard against a vacuous pass: a row that was never inserted is
          // excluded by absence, not by the policy. `db.` is the postgres
          // connection, so this read is not itself subject to RLS.
          const present = await db.wagerVerdict.count({ where: { id: d6("verdict-c") } });
          assert.equal(present, 1, "Student C's verdict fixture is missing");
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.wagerVerdict.findMany({ where: { id: d6("verdict-c") }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });
      });

      // ---- Family 6: tables whose policy admits the student alone (no teacher
      // branch), or reads the student through app.current_student_id rather
      // than app.current_user_id, plus the one staff-only student table.
      describe("self-only and staff-only tables", () => {
        it("PasswordResetToken: a student reads their own reset token row", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.passwordResetToken.findMany({
              where: { id: { in: [d6("reset-a"), d6("reset-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("reset-a")]);
        });

        it("PasswordResetToken: a teacher reads no reset tokens, not even a managed student's", async () => {
          // The policy is admin OR self — deliberately no teacher branch, since
          // a readable token hash is an account-takeover primitive.
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.passwordResetToken.findMany({ where: { id: d6("reset-a") }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });

        it("SecurityQuestionAnswer: a student reads their own security answer row", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.securityQuestionAnswer.findMany({
              where: { id: { in: [d6("secq-a"), d6("secq-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("secq-a")]);
        });

        it("SecurityQuestionAnswer: a teacher reads no security answers", async () => {
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.securityQuestionAnswer.findMany({
              where: { id: d6("secq-a") },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows, [], "the answer hash is a second factor for reset; staff never see it");
        });

        it("ConsentRecord: a student reads their own consent record", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.consentRecord.findMany({
              where: { id: { in: [d6("consent-a"), d6("consent-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("consent-a")]);
        });

        it("ConsentRecord: a student cannot record consent for another student", async () => {
          // The student branch keys off app.current_student_id, not
          // app.current_user_id — a distinction only this family exercises.
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.consentRecord.createMany({
                  data: [
                    {
                      id: d6("forged-consent"),
                      studentId: fixtures.studentC,
                      scope: "cloud_file_processing",
                      recordedBy: fixtures.studentA,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("SagePanel: a student reads their own panel", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.sagePanel.findMany({
              where: { id: { in: [d6("panel-a"), d6("panel-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("panel-a")]);
        });

        it("SagePanel: a student reads no other student's panel", async () => {
          // sage_panel_read is the ONLY policy on this table, so with RLS in
          // force no role writes it through vq_app; the negative that exists
          // to be asserted is the read exclusion.
          // Guard against a vacuous pass: a row that was never inserted is
          // excluded by absence, not by the policy. `db.` is the postgres
          // connection, so this read is not itself subject to RLS.
          const present = await db.sagePanel.count({ where: { id: d6("panel-c") } });
          assert.equal(present, 1, "Student C's panel fixture is missing");
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.sagePanel.findMany({ where: { id: d6("panel-c") }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });

        it("Wager: a student reads their own wager", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.wager.findMany({
              where: { id: { in: [ids.wagerA, ids.wagerC] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [ids.wagerA]);
        });

        it("Wager: a student reads no other student's wager", async () => {
          // Guard against a vacuous pass: a row that was never inserted is
          // excluded by absence, not by the policy. `db.` is the postgres
          // connection, so this read is not itself subject to RLS.
          const present = await db.wager.count({ where: { id: ids.wagerC } });
          assert.equal(present, 1, "Student C's wager fixture is missing");
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.wager.findMany({ where: { id: ids.wagerC }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });

        it("AdvisorAvailability: a teacher reads their own slot and not an inactive one of another advisor", async () => {
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.advisorAvailability.findMany({
              where: { id: { in: [d6("avail-t"), d6("avail-tb")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("avail-t")]);
        });

        it("AdvisorAvailability: a teacher cannot create a slot for another advisor", async () => {
          await assert.rejects(
            () =>
              asRole("teacher", fixtures.teacher, (tx) =>
                tx.advisorAvailability.createMany({
                  data: [
                    {
                      id: d6("forged-avail"),
                      advisorId: fixtures.teacherB,
                      weekday: 3,
                      startMinutes: 540,
                      endMinutes: 600,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("FormAssignment: a student reads a form assigned to them and not one assigned to another student", async () => {
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.formAssignment.findMany({
              where: { id: { in: [d6("assign-a"), d6("assign-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("assign-a")]);
        });

        it("FormAssignment: a student cannot assign a form", async () => {
          await assert.rejects(
            () =>
              asRole("student", fixtures.studentA, (tx) =>
                tx.formAssignment.createMany({
                  data: [
                    {
                      id: d6("forged-assign"),
                      templateId: ids.formTemplate,
                      scope: "student",
                      targetId: fixtures.studentA,
                    },
                  ],
                }),
              ),
            /row-level security/i,
          );
        });

        it("FailedExtraction: a teacher reads a managed student's failed extraction", async () => {
          const rows = await asRole("teacher", fixtures.teacher, (tx) =>
            tx.failedExtraction.findMany({
              where: { id: { in: [d6("failed-a"), d6("failed-c")] } },
              select: { id: true },
            }),
          );
          assert.deepEqual(rows.map((r) => r.id), [d6("failed-a")]);
        });

        it("FailedExtraction: a student reads none of their own failed extractions", async () => {
          // The dead-letter row quotes the transcript that failed to parse and
          // is a staff review queue: the policy names admin and teacher only,
          // so the student branch is absent by design.
          const rows = await asRole("student", fixtures.studentA, (tx) =>
            tx.failedExtraction.findMany({ where: { id: d6("failed-a") }, select: { id: true } }),
          );
          assert.deepEqual(rows, []);
        });
      });
    });


    // -----------------------------------------------------------------------
    // The nudge advisory locks, as SQL.
    //
    // NOT an RLS case, and deliberately here anyway: this is the suite that
    // runs against a real, migrated Postgres, and it runs BEFORE the benchmark
    // cohort is seeded, so it is the only place in CI where a guard on this
    // SQL holds without depending on a fixture.
    //
    // What it guards: on 2026-09-05 both nudge locks were written as
    // `pg_try_advisory_xact_lock(<class>, hashtext(<key>))` with the class id
    // interpolated as a JavaScript number. Prisma binds that as bigint, and
    // Postgres has exactly two overloads — (bigint) and (int, int) — so
    // (bigint, integer) matched neither and raised 42883 on every call. The
    // run lock's catch turned that into `skipped: "run lock unavailable"`, and
    // `sendPolicySms`, being total, turned it into `refused: send_error` — so
    // the SMS nudge feature was completely dead while answering 200 and
    // logging one line. Every unit test in src/lib/nudges/ mocks `$queryRaw`
    // or `$executeRaw`, so none of them could see it; it took a real database.
    //
    // These cases CALL THE PRODUCTION FUNCTIONS — `tryTakeRunLock` and
    // `takeSendLock` from ./nudges/advisory-locks, the same two the runner and
    // the sender call — rather than re-typing their SQL here. That is the
    // whole point: a test carrying its own copy of the statement would have
    // stayed green through the outage it is meant to catch. Dropping a `::int`
    // in that module reds these cases; there is nowhere else the SQL lives.
    describe("nudge advisory locks (SQL shape, not RLS)", () => {
      const RUN_LOCK_KEY = "connect-nudges";

      it("takes the run lock through the function src/lib/nudges/schedule.ts calls", async () => {
        const locked = await db.$transaction((tx) => tryTakeRunLock(tx, RUN_LOCK_KEY));
        assert.equal(
          typeof locked,
          "boolean",
          "tryTakeRunLock must return a boolean. A 42883 here means the `::int` cast on " +
            "ADVISORY_LOCK_CLASS.nudgeRun was dropped from advisory-locks.ts — which silently kills " +
            "the entire hourly nudge sweep. Restore the cast; do not relax this test.",
        );
        assert.equal(locked, true, "an uncontended run lock must be granted");
      });

      it("takes the per-recipient send lock through the function sms-policy.ts calls", async () => {
        // The blocking form. Uncontended inside its own transaction, so it
        // returns at once; a 42883 here is the same outage on the per-message
        // path rather than on the sweep path.
        await db.$transaction((tx) => takeSendLock(tx, fixtures.studentA));
      });

      it("lets vq_app execute the lock functions, not only the admin role", async () => {
        // The sweep runs on `prismaAdmin` while the inbound reply path can
        // reach the send lock through the app client, so a missing EXECUTE
        // grant on either function would reproduce the same silent outage for
        // one caller and not the other. Cheap to pin, and genuinely
        // role-shaped — this is the one case here that belongs in an RLS suite
        // on its own merits.
        await asRole("student", fixtures.studentA, (tx) => takeSendLock(tx, fixtures.studentA));
        const locked = await asRole("student", fixtures.studentA, (tx) =>
          tryTakeRunLock(tx, `${RUN_LOCK_KEY}-vq-app-probe`),
        );
        assert.equal(typeof locked, "boolean", "vq_app must be able to take both nudge locks");
      });

      it("the uncast two-argument form still fails, which is why the cast exists", async () => {
        // A negative control, so this block documents its own reason for
        // existing rather than asserting a cast that a later reader cannot
        // justify and therefore deletes.
        let raised: unknown = null;
        try {
          await db.$transaction(
            async (tx) =>
              tx.$queryRaw<Array<{ locked: boolean }>>`
                SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_CLASS.nudgeRun}, hashtext(${RUN_LOCK_KEY})) AS locked
              `,
          );
        } catch (error) {
          raised = error;
        }
        assert.ok(
          raised !== null && String((raised as Error).message).includes("42883"),
          "The uncast form no longer raises 42883. That is not a failure of the fix — it means either " +
            "Prisma stopped binding a JavaScript number as bigint, or Postgres gained a (bigint, integer) " +
            "overload. Confirm which, then simplify the two call sites and this block together. Do NOT " +
            "delete this case and leave the casts unexplained.",
        );
      });
    });
  });
}
