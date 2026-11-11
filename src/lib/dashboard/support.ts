import type { Prisma } from "@prisma/client";
import type { StudentNextStepResult } from "@/lib/progression/student-next-step";

/** The student's next scheduled appointment. Live: nothing invalidates a cached copy. */
export function nextAppointmentQuery(studentId: string, now = new Date()) {
  return {
    where: { studentId, status: "scheduled", startsAt: { gte: now } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, startsAt: true, locationLabel: true },
  } satisfies Prisma.AppointmentFindFirstArgs;
}

/** Up to three required orientation items the student has not finished. */
export function orientationItemsQuery(studentId: string) {
  return {
    where: { required: true, OR: [
      { progress: { none: { studentId } } }, { progress: { some: { studentId, completed: false } } },
    ] },
    orderBy: { sortOrder: "asc" }, take: 3, select: { id: true, label: true },
  } satisfies Prisma.OrientationItemFindManyArgs;
}

export interface SupportFacts {
  readonly nextStep: StudentNextStepResult;
  readonly alertCount: number;
  readonly appointment: { id: string; title: string; startsAt: Date; locationLabel: string | null } | null;
  readonly orientationItems: readonly { id: string; label: string }[];
}

/** The advising region from facts already read. Pure. */
export function supportFromFacts(facts: SupportFacts, now = new Date()) {
  const { nextStep, alertCount, appointment } = facts;
  return {
    nextStep, alertCount,
    appointment: appointment ? { ...appointment, startsAt: appointment.startsAt.toISOString() } : null,
    orientationItems: [...facts.orientationItems],
    fetchedAt: now.toISOString(),
  };
}
export type DashboardSupport = ReturnType<typeof supportFromFacts>;
