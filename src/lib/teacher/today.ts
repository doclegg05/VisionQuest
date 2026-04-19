import { prisma } from "@/lib/db";
import { type Session } from "@/lib/api-error";
import { buildManagedStudentWhere } from "@/lib/classroom";
import { normalizeProgramType, type ProgramType } from "@/lib/program-type";

export type PresenceState = "present" | "recent" | "away";

export interface TodayRosterEntry {
  studentId: string;
  id: string;
  name: string;
  programType: ProgramType;
  presence: PresenceState;
  lastActiveAt: Date | null;
  activeTask: { id: string; title: string; priority: string } | null;
  lastConversationAt: Date | null;
  openAlertCount: number;
  highSeverityAlertCount: number;
}

const PRESENT_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export function classifyPresence(lastActiveAt: Date | null, now: Date = new Date()): PresenceState {
  if (!lastActiveAt) return "away";
  const diff = now.getTime() - lastActiveAt.getTime();
  if (diff <= PRESENT_WINDOW_MS) return "present";
  if (diff <= RECENT_WINDOW_MS) return "recent";
  return "away";
}

/**
 * Returns a "today" roster for the teacher dashboard — every managed student
 * (optionally narrowed to a single class) with a presence signal and the
 * highest-priority open task. No new schema, no attendance tracking;
 * presence is derived from the most-recent Message or Conversation update.
 */
export async function getTodayRoster(
  session: Session,
  options: { classId?: string; now?: Date } = {},
): Promise<TodayRosterEntry[]> {
  const now = options.now ?? new Date();

  const students = await prisma.student.findMany({
    where: buildManagedStudentWhere(session, {
      classId: options.classId,
      includeInactiveAccounts: false,
    }),
    select: {
      id: true,
      studentId: true,
      displayName: true,
      classEnrollments: {
        where: { status: "active" },
        orderBy: { enrolledAt: "desc" },
        take: 1,
        select: { class: { select: { programType: true } } },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
      conversations: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { updatedAt: true },
      },
      assignedTasks: {
        where: { status: { not: "completed" } },
        orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
        take: 1,
        select: { id: true, title: true, priority: true },
      },
      alerts: {
        where: { status: "open" },
        select: { severity: true },
      },
    },
    orderBy: { displayName: "asc" },
  });

  return students.map((student) => {
    const lastMessageAt = student.messages[0]?.createdAt ?? null;
    const lastConversationAt = student.conversations[0]?.updatedAt ?? null;
    const lastActiveAt = mostRecent(lastMessageAt, lastConversationAt);
    const highSeverityAlertCount = student.alerts.filter(
      (alert) => alert.severity === "high" || alert.severity === "critical",
    ).length;

    return {
      id: student.id,
      studentId: student.studentId,
      name: student.displayName,
      programType: normalizeProgramType(student.classEnrollments[0]?.class.programType),
      presence: classifyPresence(lastActiveAt, now),
      lastActiveAt,
      activeTask: student.assignedTasks[0] ?? null,
      lastConversationAt,
      openAlertCount: student.alerts.length,
      highSeverityAlertCount,
    };
  });
}

function mostRecent(...values: Array<Date | null>): Date | null {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}
