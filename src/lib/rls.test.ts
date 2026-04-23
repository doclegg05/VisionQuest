/**
 * RLS policy integration tests — verifies that migration
 * `20260423120000_rls_policy_recovery` enforces the intended access matrix
 * when queries run as the `vq_app` role.
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
  studentA: string;
  studentB: string;
  teacher: string;
  admin: string;
  classAlpha: string;
  conversationA: string;
  conversationB: string;
  goalA: string;
  goalB: string;
  caseNoteA: string;
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
      studentA: "",
      studentB: "",
      teacher: "",
      admin: "",
      classAlpha: "",
      conversationA: "",
      conversationB: "",
      goalA: "",
      goalB: "",
      caseNoteA: "",
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
    }

    async function destroyFixtures(): Promise<void> {
      // Cascades on Student delete clean up Conversation, Goal, CaseNote,
      // StudentClassEnrollment, etc. SpokesClassInstructor is covered by the
      // class delete cascade.
      await db.spokesClass.deleteMany({ where: { id: fixtures.classAlpha } });
      await db.student.deleteMany({
        where: { id: { in: [fixtures.studentA, fixtures.studentB, fixtures.teacher, fixtures.admin] } },
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
          /row.level security|violates|permission/i,
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
  });
}
