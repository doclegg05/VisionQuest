import { prisma } from "@/lib/db";
import { countStudentVisibleAlerts } from "@/lib/student-alerts";
import { getStudentNextStep } from "@/lib/progression/student-next-step";
import type { StudentReadinessData } from "@/lib/progression/fetch-readiness-data";

export async function readSupport(studentId: string, readiness?: StudentReadinessData) {
  const [nextStep, alertCount, appointment, orientationItems] = await Promise.all([
    getStudentNextStep(studentId, readiness),
    countStudentVisibleAlerts(studentId),
    prisma.appointment.findFirst({ where: { studentId, status: "scheduled", startsAt: { gte: new Date() } }, orderBy: [{ startsAt: "asc" }, { id: "asc" }], select: { id: true, title: true, startsAt: true, locationLabel: true } }),
    prisma.orientationItem.findMany({ where: { required: true, OR: [
      { progress: { none: { studentId } } }, { progress: { some: { studentId, completed: false } } },
    ] }, orderBy: { sortOrder: "asc" }, take: 3, select: { id: true, label: true } }),
  ]);
  return { nextStep, alertCount, appointment: appointment ? { ...appointment, startsAt: appointment.startsAt.toISOString() } : null, orientationItems, fetchedAt: new Date().toISOString() };
}
export type DashboardSupport = Awaited<ReturnType<typeof readSupport>>;
