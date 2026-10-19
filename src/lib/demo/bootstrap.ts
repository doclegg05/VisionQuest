import type { Prisma } from "@prisma/client";
import { invalidateChatContext } from "@/lib/cache";
import { prismaAdmin } from "@/lib/db";
import { WELCOME_COMPLETE_EVENT } from "@/lib/progression/welcome-routing";
import {
  DEMO_CLASS_CODE,
  DEMO_CLASS_NAME,
  DEMO_INSTRUCTOR_LOGIN,
  DEMO_INSTRUCTOR_NAME,
} from "./config";
import { STARTER_STUDENTS, type StarterStudentSpec } from "./starter-students";

/**
 * Creates the demo instructor, the demo class and the four starter students the
 * first time anyone asks for them, and reuses them afterwards.
 *
 * The sign-in route that calls this has no session, so every write goes through
 * `prismaAdmin`. The app client would find no rows and write none under RLS.
 */

export interface DemoClassroom {
  readonly instructorId: string;
  readonly instructorSessionVersion: number;
  readonly classId: string;
}

/**
 * Open slots for the demo instructor: Monday to Friday, 9:00 to 12:00, in
 * 30-minute slots. The slot builder compares `weekday` with `getUTCDay()`, so
 * 0 is Sunday and Monday to Friday is 1 to 5.
 */
const AVAILABILITY_WEEKDAYS = [1, 2, 3, 4, 5] as const;
const AVAILABILITY_START_MINUTES = 540;
const AVAILABILITY_END_MINUTES = 720;
const AVAILABILITY_SLOT_MINUTES = 30;
const AVAILABILITY_LOCATION_LABEL = "Demo meeting";
/** Fixed ids, so two first runs that both see no slots still end with five rows. */
const AVAILABILITY_ID_PREFIX = "demo-availability-";

/** The path a starter's welcome event records, as a real student's does. */
const STARTER_WELCOME_PATH = "dashboard";

/**
 * A starter is about eight statements. Prisma's 5 second default is tight for a
 * cold pooled connection, and a timeout here fails the visitor's first click.
 */
const STARTER_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

interface OrientationItemRef {
  id: string;
  sortOrder: number;
}

/** The ids of the first `ceil(share x n)` items by sortOrder (ties broken by id). */
function orientationItemIdsToComplete(items: readonly OrientationItemRef[], share: number): string[] {
  const count = Math.ceil(share * items.length);
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, count)
    .map((item) => item.id);
}

async function ensureInstructor(): Promise<{ id: string; sessionVersion: number }> {
  const instructor = await prismaAdmin.student.upsert({
    where: { studentId: DEMO_INSTRUCTOR_LOGIN },
    create: {
      studentId: DEMO_INSTRUCTOR_LOGIN,
      displayName: DEMO_INSTRUCTOR_NAME,
      role: "teacher",
      demoAccount: "instructor",
    },
    update: {},
    select: { id: true, role: true, demoAccount: true, sessionVersion: true },
  });

  // The sign-in route issues a session for whatever row this returns, with no
  // password. If a real account ever held this login, adopting it would hand
  // that account to every visitor, so stop instead.
  if (instructor.demoAccount !== "instructor" || instructor.role !== "teacher") {
    throw new Error("The demo instructor login belongs to an account that is not a demo instructor");
  }
  return { id: instructor.id, sessionVersion: instructor.sessionVersion };
}

async function ensureClass(instructorId: string): Promise<{ id: string }> {
  const demoClass = await prismaAdmin.spokesClass.upsert({
    where: { code: DEMO_CLASS_CODE },
    create: { code: DEMO_CLASS_CODE, name: DEMO_CLASS_NAME, createdById: instructorId },
    update: {},
    select: { id: true },
  });

  // Without this row the demo instructor sees no class at all.
  await prismaAdmin.spokesClassInstructor.upsert({
    where: { classId_instructorId: { classId: demoClass.id, instructorId } },
    create: { classId: demoClass.id, instructorId },
    update: {},
  });
  return demoClass;
}

/** Adds the weekly slots once. An instructor who already has any slot is left alone. */
async function ensureAvailability(advisorId: string): Promise<void> {
  const existing = await prismaAdmin.advisorAvailability.count({ where: { advisorId } });
  if (existing > 0) return;

  await prismaAdmin.advisorAvailability.createMany({
    data: AVAILABILITY_WEEKDAYS.map((weekday) => ({
      id: `${AVAILABILITY_ID_PREFIX}${weekday}`,
      advisorId,
      weekday,
      startMinutes: AVAILABILITY_START_MINUTES,
      endMinutes: AVAILABILITY_END_MINUTES,
      slotMinutes: AVAILABILITY_SLOT_MINUTES,
      locationType: "virtual",
      locationLabel: AVAILABILITY_LOCATION_LABEL,
    })),
    skipDuplicates: true,
  });
}

async function writeStarterProgress(
  tx: Prisma.TransactionClient,
  studentId: string,
  spec: StarterStudentSpec,
  items: readonly OrientationItemRef[],
): Promise<void> {
  const itemIds = orientationItemIdsToComplete(items, spec.orientationShare);
  if (itemIds.length > 0) {
    const completedAt = new Date();
    await tx.orientationProgress.createMany({
      data: itemIds.map((itemId) => ({ studentId, itemId, completed: true, completedAt })),
    });
  }

  // Each goal hangs under the one before it, so the teacher's goal tree nests.
  let parentId: string | null = null;
  for (const goal of spec.goals) {
    const created: { id: string } = await tx.goal.create({
      data: {
        studentId,
        level: goal.level,
        content: goal.content,
        status: goal.status,
        parentId,
      },
      select: { id: true },
    });
    parentId = created.id;
  }

  if (spec.welcomeComplete) {
    await tx.progressionEvent.create({
      data: {
        studentId,
        ...WELCOME_COMPLETE_EVENT,
        metadata: JSON.stringify({ path: STARTER_WELCOME_PATH }),
      },
    });
  }
}

/**
 * Creates one starter, its enrollment and its progress in one transaction, so a
 * failure part way leaves nothing behind and the next run starts that starter
 * over. A unique violation means another request created the starter first.
 * Nothing else in the transaction can collide, because every other row is keyed
 * by the new student's own id, so the violation can only be the student row,
 * and that request wrote the progress.
 *
 * `prismaAdmin` has no chat-context write-through (see its doc block in
 * db.ts), so the new student's cached Sage context is dropped by hand once the
 * rows are committed.
 */
async function createStarter(
  spec: StarterStudentSpec,
  classId: string,
  items: readonly OrientationItemRef[],
): Promise<void> {
  let studentId: string;
  try {
    studentId = await prismaAdmin.$transaction(async (tx) => {
      const student = await tx.student.create({
        data: {
          studentId: spec.login,
          displayName: spec.displayName,
          role: "student",
          demoAccount: "student",
        },
        select: { id: true },
      });
      await tx.studentClassEnrollment.create({
        data: { classId, studentId: student.id, status: "active" },
      });
      await writeStarterProgress(tx, student.id, spec, items);
      return student.id;
    }, STARTER_TRANSACTION_OPTIONS);
  } catch (error) {
    if (isUniqueViolation(error)) return;
    throw error;
  }
  invalidateChatContext(studentId);
}

/**
 * Creates the starters that are missing. The read only skips work; the unique
 * key on the login is what keeps two requests from both creating one.
 */
async function ensureStarters(classId: string): Promise<void> {
  const existing = await prismaAdmin.student.findMany({
    where: { studentId: { in: STARTER_STUDENTS.map((spec) => spec.login) } },
    select: { studentId: true },
  });
  const present = new Set(existing.map((row) => row.studentId));
  const missing = STARTER_STUDENTS.filter((spec) => !present.has(spec.login));
  if (missing.length === 0) return;

  const items = await prismaAdmin.orientationItem.findMany({ select: { id: true, sortOrder: true } });
  for (const spec of missing) {
    await createStarter(spec, classId, items);
  }
}

async function bootstrapOnce(): Promise<DemoClassroom> {
  const instructor = await ensureInstructor();
  const demoClass = await ensureClass(instructor.id);
  await ensureAvailability(instructor.id);
  await ensureStarters(demoClass.id);
  return {
    instructorId: instructor.id,
    instructorSessionVersion: instructor.sessionVersion,
    classId: demoClass.id,
  };
}

/**
 * Two requests that both find no demo rows race on the same unique keys, and
 * Prisma reports the loser as P2002. Run again once: the winner's rows are
 * there by then, so every upsert and check finds them.
 */
async function bootstrapWithOneRetry(): Promise<DemoClassroom> {
  try {
    return await bootstrapOnce();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return bootstrapOnce();
  }
}

let cached: Promise<DemoClassroom> | null = null;

/**
 * The demo instructor and class, created on first use. Later calls in the same
 * process answer from memory.
 */
export function ensureDemoClassroom(): Promise<DemoClassroom> {
  if (cached) return cached;

  const attempt = bootstrapWithOneRetry();
  cached = attempt;
  // A failed bootstrap must not be remembered, or one bad moment would break
  // the demo until the process restarts. The caller still sees the rejection;
  // this branch only clears the memo.
  attempt.catch(() => {
    if (cached === attempt) cached = null;
  });
  return attempt;
}

export function resetDemoClassroomCacheForTests(): void {
  cached = null;
}
