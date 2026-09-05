#!/usr/bin/env node

/**
 * E2E fixture seed — the browser-level test users behind
 * e2e/a11y-authenticated.spec.ts, e2e/student-journey.spec.ts, and
 * e2e/teacher-loop.spec.ts.
 *
 * Idempotent upserts on marker logins/emails (e2e-* / *@test.local), so
 * re-runs are safe on a shared database. Everything it creates is removable
 * with `--clean`.
 *
 * What it seeds:
 *   - one test teacher (role "teacher")
 *   - one "established" test student: enrolled in a marker class, two
 *     orientation progress rows (one complete, one pending teacher
 *     verification — the Progress-tab verify surface), one confirmed goal
 *   - one "day-1" journey student: enrolled, but with NO goals,
 *     conversations, progression, or orientation progress, so /welcome
 *     renders (the dashboard redirects brand-new students there)
 *   - on an empty OrientationItem table (hermetic CI Postgres), marker
 *     quick-win-eligible items so the welcome flow's "first wins" step is
 *     deterministic; on a populated database the real items are used
 *
 * A `.ts` entry run via tsx (like scripts/seed-progression-edges.ts): a
 * `.mjs` entry importing named exports from `.ts` modules fails to link
 * under the repo's tsx/Node loader combination (see the #145 fix note in
 * seed-progression-edges.ts). Being `.ts` lets this script use the REAL
 * `hashPassword` from src/lib/auth.ts instead of duplicating scrypt params.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/seed-e2e-users.ts
 *   DATABASE_URL="..." npx tsx scripts/seed-e2e-users.ts --clean
 *   DATABASE_URL="..." npx tsx scripts/seed-e2e-users.ts --allow-remote
 *
 * W4: this seed creates accounts with passwords hard-coded in this repo
 * (e2e/fixtures.ts), so it refuses to run against anything that doesn't
 * look local or CI-scoped — see src/lib/e2e-seed-guard.ts. Pass
 * --allow-remote to override (prints a loud warning naming the host).
 */

import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import {
  E2E_CLASS,
  E2E_JOURNEY_STUDENT,
  E2E_STUDENT,
  E2E_TEACHER,
} from "../e2e/fixtures";
import { resetStudentToDayOne } from "../e2e/helpers/db";
import { assertSafeE2eSeedTarget } from "../src/lib/e2e-seed-guard";

// Already-set process env always wins over .env.local — @next/env never
// overrides existing variables, so CI / inline DATABASE_URL overrides work.
loadEnvConfig(process.cwd(), true);

/** Marker prefix on orientation items this script may create. */
const MARKER_ITEM_PREFIX = "E2E ";

/**
 * Mirrors the quick-win filter in src/app/(student)/welcome/page.tsx —
 * labels containing one of these are quick-win candidates.
 */
const QUICK_WIN_LABEL_FRAGMENTS = [
  "rights and responsibilities",
  "dress code",
  "code of conduct",
  "attendance",
] as const;

/**
 * Markers created only when the database lacks the coverage the specs need
 * (i.e. the hermetic CI Postgres). Labels are chosen against the REAL
 * eligibility predicates:
 *   - the first keyword-maps to the Ready-to-Work attendance-verification
 *     form (downloadable, unsigned) → quick-win eligible, and contains the
 *     "attendance" quick-win fragment;
 *   - the second maps to no form → an instructor-led honor-system item,
 *     which is what the pending-verification fixture row belongs on.
 */
const MARKER_ITEMS = [
  {
    label: "E2E Review Ready to Work Attendance Verification",
    description: "E2E fixture — review the attendance verification form.",
  },
  {
    label: "E2E Program Handbook Review",
    description: "E2E fixture — instructor-led honor-system step.",
  },
] as const;

function isQuickWinLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return QUICK_WIN_LABEL_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set — pass it inline or provide .env.local.",
    );
  }

  const allowRemote = process.argv.includes("--allow-remote");
  // Refuses a non-local, non-CI target BEFORE any connection is opened —
  // see src/lib/e2e-seed-guard.ts for why (git-committed credentials).
  assertSafeE2eSeedTarget(databaseUrl, { allowRemote });

  // Real auth helpers (scrypt) — imported lazily so env is loaded before
  // src/lib/db.ts (a transitive import of auth.ts) initializes.
  const { hashPassword } = await import("../src/lib/auth");
  const { hashSecurityAnswers } = await import("../src/lib/security-question-auth");
  const { isSignatureRequiredItem, isVerificationRequiredItem } = await import(
    "../src/lib/orientation-step-resources"
  );

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const clean = process.argv.includes("--clean");

  try {
    if (clean) {
      // Connections FIRST, and not because of the student's own row.
      //
      // `Connection.studentId` cascades, so a student's own connections would
      // go with them. `Connection.proposedById` does NOT — it is RESTRICT,
      // because a disclosure record has to outlive every party to it. A
      // self-proposed connection (the Sage path writes proposedById =
      // studentId) therefore points at the same Student row through both, and
      // Postgres enforces the RESTRICT regardless of the CASCADE: the delete
      // below fails outright rather than cascading.
      //
      // Deleting them here is safe in a way it would not be in production —
      // these are marker fixtures on a hermetic or explicitly local database,
      // which this script refuses to run against anything else.
      const fixtureLogins = [
        E2E_TEACHER.login,
        E2E_STUDENT.login,
        E2E_JOURNEY_STUDENT.login,
      ];
      const fixtureStudents = await prisma.student.findMany({
        where: { studentId: { in: fixtureLogins } },
        select: { id: true },
      });
      const fixtureIds = fixtureStudents.map((row) => row.id);
      if (fixtureIds.length > 0) {
        await prisma.connection.deleteMany({
          where: {
            OR: [
              { studentId: { in: fixtureIds } },
              { proposedById: { in: fixtureIds } },
              { sentById: { in: fixtureIds } },
            ],
          },
        });
      }

      // Student cascades wipe goals/progress/enrollments/alerts.
      const students = await prisma.student.deleteMany({
        where: { studentId: { in: fixtureLogins } },
      });
      const classes = await prisma.spokesClass.deleteMany({
        where: { code: E2E_CLASS.code },
      });
      const items = await prisma.orientationItem.deleteMany({
        where: { label: { startsWith: MARKER_ITEM_PREFIX } },
      });
      console.log(
        `Cleaned e2e fixtures: ${students.count} users, ${classes.count} classes, ${items.count} marker orientation items.`,
      );
      return;
    }

    // ── Users ────────────────────────────────────────────────────────────
    const teacher = await prisma.student.upsert({
      where: { studentId: E2E_TEACHER.login },
      update: {
        email: E2E_TEACHER.email,
        displayName: E2E_TEACHER.displayName,
        passwordHash: hashPassword(E2E_TEACHER.password).hash,
        role: "teacher",
        isActive: true,
      },
      create: {
        studentId: E2E_TEACHER.login,
        email: E2E_TEACHER.email,
        displayName: E2E_TEACHER.displayName,
        passwordHash: hashPassword(E2E_TEACHER.password).hash,
        role: "teacher",
      },
    });

    const student = await prisma.student.upsert({
      where: { studentId: E2E_STUDENT.login },
      update: {
        email: E2E_STUDENT.email,
        displayName: E2E_STUDENT.displayName,
        passwordHash: hashPassword(E2E_STUDENT.password).hash,
        role: "student",
        isActive: true,
      },
      create: {
        studentId: E2E_STUDENT.login,
        email: E2E_STUDENT.email,
        displayName: E2E_STUDENT.displayName,
        passwordHash: hashPassword(E2E_STUDENT.password).hash,
      },
    });

    const journeyStudent = await prisma.student.upsert({
      where: { studentId: E2E_JOURNEY_STUDENT.login },
      update: {
        email: E2E_JOURNEY_STUDENT.email,
        displayName: E2E_JOURNEY_STUDENT.displayName,
        passwordHash: hashPassword(E2E_JOURNEY_STUDENT.password).hash,
        role: "student",
        isActive: true,
      },
      create: {
        studentId: E2E_JOURNEY_STUDENT.login,
        email: E2E_JOURNEY_STUDENT.email,
        displayName: E2E_JOURNEY_STUDENT.displayName,
        passwordHash: hashPassword(E2E_JOURNEY_STUDENT.password).hash,
      },
    });

    // ── Recovery questions ───────────────────────────────────────────────
    // The (student) layout forces /recovery-setup before ANY student page
    // when the 3-question recovery set is missing, so seeded users need a
    // configured set or every authenticated spec bounces there. Hashed with
    // the real helper (scrypt over the normalized answer).
    const recoveryAnswers = hashSecurityAnswers({
      birth_city: "Testville",
      elementary_school: "Test Elementary",
      favorite_teacher: "Testy",
    });
    for (const user of [teacher, student, journeyStudent]) {
      for (const answer of recoveryAnswers) {
        await prisma.securityQuestionAnswer.upsert({
          where: {
            studentId_questionKey: {
              studentId: user.id,
              questionKey: answer.questionKey,
            },
          },
          update: { answerHash: answer.answerHash },
          create: {
            studentId: user.id,
            questionKey: answer.questionKey,
            answerHash: answer.answerHash,
          },
        });
      }
    }

    // ── Class + instructor + enrollments ─────────────────────────────────
    const spokesClass = await prisma.spokesClass.upsert({
      where: { code: E2E_CLASS.code },
      update: { name: E2E_CLASS.name, status: "active", archivedAt: null },
      create: {
        code: E2E_CLASS.code,
        name: E2E_CLASS.name,
        description: "E2E fixture class — safe to delete via seed-e2e-users.ts --clean.",
        createdById: teacher.id,
      },
    });

    await prisma.spokesClassInstructor.upsert({
      where: {
        classId_instructorId: { classId: spokesClass.id, instructorId: teacher.id },
      },
      update: {},
      create: { classId: spokesClass.id, instructorId: teacher.id },
    });

    for (const enrollee of [student, journeyStudent]) {
      await prisma.studentClassEnrollment.upsert({
        where: {
          classId_studentId: { classId: spokesClass.id, studentId: enrollee.id },
        },
        update: { status: "active", archivedAt: null, archiveReason: null },
        create: { classId: spokesClass.id, studentId: enrollee.id },
      });
    }

    // ── Orientation items ────────────────────────────────────────────────
    // Quick-win eligible = label matches the welcome page's fragments AND is
    // neither signature- nor verification-gated (same predicates the page
    // uses). The journey spec needs >= 1 eligible item so the welcome flow's
    // "first wins" step deterministically offers a quick win; it also needs
    // >= 2 items total for the established student's progress pair. Note:
    // on the canonical seed data exactly ONE item qualifies ("Review Ready
    // to Work Attendance Verification") — the other three quick-win label
    // families are all signature-gated since the P0-1 fix.
    let items = await prisma.orientationItem.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, label: true },
    });

    const eligible = (list: typeof items) =>
      list.filter(
        (item) =>
          isQuickWinLabel(item.label) &&
          !isSignatureRequiredItem(item.label) &&
          !isVerificationRequiredItem(item.label),
      );

    if (eligible(items).length < 1 || items.length < 2) {
      let sortOrder = 9001;
      for (const marker of MARKER_ITEMS) {
        const exists = items.some((item) => item.label === marker.label);
        if (!exists) {
          await prisma.orientationItem.create({
            data: { ...marker, required: true, sortOrder: sortOrder },
          });
        }
        sortOrder += 1;
      }
      items = await prisma.orientationItem.findMany({
        orderBy: { sortOrder: "asc" },
        select: { id: true, label: true },
      });
    }

    const quickWinItems = eligible(items);
    if (quickWinItems.length < 1 || items.length < 2) {
      throw new Error(
        "Could not establish a quick-win-eligible orientation item plus a second item — the welcome-flow journey spec would be nondeterministic.",
      );
    }

    // ── Established student: orientation progress + confirmed goal ───────
    const [firstItem, secondItem] = items;
    const now = new Date();

    await prisma.orientationProgress.upsert({
      where: { studentId_itemId: { studentId: student.id, itemId: firstItem.id } },
      update: { completed: true, completedAt: now },
      create: { studentId: student.id, itemId: firstItem.id, completed: true, completedAt: now },
    });

    // Pending teacher verification — renders the "Student marked done —
    // verify" surface on the teacher's Progress tab (#orientation-review).
    await prisma.orientationProgress.upsert({
      where: { studentId_itemId: { studentId: student.id, itemId: secondItem.id } },
      update: {
        completed: false,
        completedAt: null,
        verificationStatus: "pending",
        verifiedBy: null,
        verifiedAt: null,
      },
      create: {
        studentId: student.id,
        itemId: secondItem.id,
        completed: false,
        verificationStatus: "pending",
      },
    });

    // Goal has no natural unique key — find-by-marker-content, else create.
    const goalContent = "E2E: Land a stable IT support job";
    const existingGoal = await prisma.goal.findFirst({
      where: { studentId: student.id, content: goalContent },
      select: { id: true },
    });
    if (existingGoal) {
      await prisma.goal.update({
        where: { id: existingGoal.id },
        data: { status: "confirmed", confirmedAt: now, confirmedBy: teacher.id },
      });
    } else {
      await prisma.goal.create({
        data: {
          studentId: student.id,
          level: "bhag",
          content: goalContent,
          status: "confirmed",
          confirmedAt: now,
          confirmedBy: teacher.id,
        },
      });
    }

    // ── Journey student: reset to true day-1 state ───────────────────────
    // /welcome renders only for students with zero goals, conversations, and
    // progression; the quick-win step needs their orientation progress empty.
    await resetStudentToDayOne(prisma, journeyStudent.id);

    // ── Login rate limits ────────────────────────────────────────────────
    // /api/auth/login allows 10 attempts per IP per 15 min; repeated local
    // suite runs from one machine would trip it. This seed only ever targets
    // e2e databases (hermetic CI Postgres / dev), so reset login buckets.
    const rl = await prisma.rateLimitEntry.deleteMany({
      where: { key: { startsWith: "login:" } },
    });

    console.log("E2E fixtures ready:");
    console.log(`  teacher    ${E2E_TEACHER.login} (${teacher.id})`);
    console.log(`  student    ${E2E_STUDENT.login} (${student.id})`);
    console.log(`  journey    ${E2E_JOURNEY_STUDENT.login} (${journeyStudent.id})`);
    console.log(`  class      ${E2E_CLASS.code} (${spokesClass.id})`);
    console.log(`  quick-win-eligible orientation items: ${quickWinItems.length}`);
    console.log(`  login rate-limit buckets cleared: ${rl.count}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("E2E seed failed:", error);
  process.exitCode = 1;
});
