import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import type { ReadinessBreakdown } from "@/lib/progression/readiness-score";
import ChatWindow from "@/components/chat/ChatWindow";
import { AmbientPanels } from "@/components/dashboard/AmbientPanels";

/**
 * Chat-first student home (Phase 4 redesign, user-approved 2026-06-09).
 *
 * The Sage conversation IS the home surface; the ambient rail carries the
 * old dashboard's vital signs and deep-links into full pages. The previous
 * dashboard is preserved at /dashboard/classic for one release.
 */

/** The lowest-scoring readiness dimension — the student's next gap. */
function findNextGap(breakdown: ReadinessBreakdown): string | null {
  let worst: { label: string; ratio: number } | null = null;
  for (const part of Object.values(breakdown)) {
    if (part.max === 0) continue;
    const ratio = part.score / part.max;
    if (ratio >= 1) continue;
    if (!worst || ratio < worst.ratio) worst = { label: part.label, ratio };
  }
  return worst?.label ?? null;
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;

  const now = new Date();
  const [goalCount, nextAppointment, tasks, alertCount, readinessData, incompleteOrientationItems] =
    await Promise.all([
      prisma.goal.count({
        where: { studentId: session.id, status: { in: [...GOAL_PLANNING_STATUSES] } },
      }),
      prisma.appointment.findFirst({
        where: { studentId: session.id, status: "scheduled", startsAt: { gte: now } },
        select: { id: true, title: true, startsAt: true, locationLabel: true },
        orderBy: { startsAt: "asc" },
      }),
      prisma.studentTask.findMany({
        where: { studentId: session.id, status: { in: ["open", "in_progress"] } },
        select: { id: true, title: true, dueAt: true },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        take: 3,
      }),
      prisma.studentAlert.count({ where: { studentId: session.id, status: "open" } }),
      fetchStudentReadinessData(session.id),
      prisma.orientationItem.findMany({
        where: {
          required: true,
          OR: [
            { progress: { none: { studentId: session.id } } },
            { progress: { some: { studentId: session.id, completed: false } } },
          ],
        },
        select: { id: true, label: true },
        orderBy: { sortOrder: "asc" },
        take: 3,
      }),
    ]);

  const { state, readiness, hasProgressionRecord } = readinessData;

  // Brand-new students still start at the welcome flow.
  if (goalCount === 0 && !hasProgressionRecord) {
    const convCount = await prisma.conversation.count({ where: { studentId: session.id } });
    if (convCount === 0) {
      redirect("/welcome");
    }
  }

  return (
    <div className="page-shell page-shell-wide">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:order-2 lg:col-span-1">
          <AmbientPanels
            readinessScore={readiness.score}
            nextGap={findNextGap(readiness.breakdown)}
            tasks={tasks.map((task) => ({
              ...task,
              dueAt: task.dueAt ? task.dueAt.toISOString() : null,
            }))}
            alertCount={alertCount}
            nextAppointment={
              nextAppointment
                ? {
                    title: nextAppointment.title,
                    startsAt: nextAppointment.startsAt.toISOString(),
                    locationLabel: nextAppointment.locationLabel,
                  }
                : null
            }
            incompleteOrientationItems={incompleteOrientationItems}
            orientationComplete={state.orientationComplete || false}
            resumeCreated={state.resumeCreated || false}
            level={state.level}
            currentStreak={state.currentStreak}
          />
        </div>
        <div className="surface-section overflow-hidden p-0 lg:order-1 lg:col-span-2">
          <ChatWindow />
        </div>
      </div>
    </div>
  );
}
