import { type Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { goalCountsTowardPlan } from "@/lib/goals";
import { parseState } from "@/lib/progression/engine";

/**
 * Coordinator drill-down: region, then instructor, then classroom, then a
 * roster of students. Read-only, and deliberately narrow.
 *
 * Every query goes through the RLS `prisma` client. Coordinator sessions run
 * as the `teacher` RLS role, which can read their region's classes,
 * enrollments and students and refuses transcripts, alerts and files, so the
 * database enforces the scope even if a filter here were wrong. The
 * `regionId` and `classId` filters below narrow the result to what was asked
 * for; they are not the access control. The routes check the region first.
 */

export interface RegionOverview {
  instructors: Array<{
    id: string;
    displayName: string;
    classes: Array<{ id: string; name: string; activeStudents: number }>;
  }>;
}

export interface RosterStudent {
  id: string;
  displayName: string;
  enrolledAt: Date;
  orientationComplete: boolean;
  goalsSet: number;
  goalsAchieved: number;
}

export interface ClassRoster {
  students: RosterStudent[];
}

/** The status that means a goal was achieved (src/lib/goals.ts). */
const GOAL_ACHIEVED_STATUS = "completed";

/**
 * Non-archived classes of one region, grouped under each instructor. A class
 * with two instructors appears under both. A class with none is left out:
 * this view is "who teaches what".
 */
export async function regionOverview(
  _session: Session,
  regionId: string,
): Promise<RegionOverview> {
  const classes = await prisma.spokesClass.findMany({
    where: { regionId, status: { not: "archived" } },
    select: {
      id: true,
      name: true,
      instructors: { select: { instructor: { select: { id: true, displayName: true } } } },
      _count: { select: { enrollments: { where: { status: "active" } } } },
    },
    orderBy: { name: "asc" },
  });

  const byInstructor = new Map<string, RegionOverview["instructors"][number]>();
  for (const spokesClass of classes) {
    const entry = {
      id: spokesClass.id,
      name: spokesClass.name,
      activeStudents: spokesClass._count.enrollments,
    };
    for (const { instructor } of spokesClass.instructors) {
      const existing = byInstructor.get(instructor.id);
      if (existing) {
        existing.classes.push(entry);
      } else {
        byInstructor.set(instructor.id, {
          id: instructor.id,
          displayName: instructor.displayName,
          classes: [entry],
        });
      }
    }
  }
  return { instructors: [...byInstructor.values()] };
}

/**
 * The region a class belongs to, or `found: false` when the class does not
 * exist or the caller's RLS scope hides it.
 */
export async function findClassRegion(
  classId: string,
): Promise<{ found: boolean; regionId: string | null }> {
  const row = await prisma.spokesClass.findUnique({
    where: { id: classId },
    select: { regionId: true },
  });
  return row ? { found: true, regionId: row.regionId } : { found: false, regionId: null };
}

/**
 * Orientation is complete by the rule the intervention queue and readiness
 * snapshot use (`buildReadinessSnapshot`): the progression state says so, or
 * every orientation item is done.
 */
function isOrientationComplete(
  progression: { state: string } | null,
  completedItems: number,
  totalItems: number,
): boolean {
  if (parseState(progression?.state ?? null).orientationComplete) return true;
  return totalItems > 0 && completedItems >= totalItems;
}

/**
 * Active students in one class with six fields each. No transcript, mood,
 * crisis, alert, file or chat data is selected.
 *
 * goalsSet counts goals in a planning status (active, in progress,
 * confirmed, blocked, completed), so proposed and abandoned goals are left
 * out. goalsAchieved counts status `completed`.
 */
export async function classRoster(_session: Session, classId: string): Promise<ClassRoster> {
  const [enrollments, orientationTotal] = await Promise.all([
    prisma.studentClassEnrollment.findMany({
      where: { classId, status: "active" },
      select: {
        enrolledAt: true,
        student: {
          select: {
            id: true,
            displayName: true,
            progression: { select: { state: true } },
            orientationProgress: { where: { completed: true }, select: { completed: true } },
            goals: { select: { status: true } },
          },
        },
      },
      orderBy: { student: { displayName: "asc" } },
    }),
    prisma.orientationItem.count(),
  ]);

  return {
    students: enrollments.map(({ enrolledAt, student }) => ({
      id: student.id,
      displayName: student.displayName,
      enrolledAt,
      orientationComplete: isOrientationComplete(
        student.progression,
        student.orientationProgress.length,
        orientationTotal,
      ),
      goalsSet: student.goals.filter((goal) => goalCountsTowardPlan(goal.status)).length,
      goalsAchieved: student.goals.filter((goal) => goal.status === GOAL_ACHIEVED_STATUS).length,
    })),
  };
}
