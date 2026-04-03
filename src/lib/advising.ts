import { buildStudentAlertDescriptors, type AlertDescriptor } from "./advising-alerts";
import {
  sendAppointmentConfirmation,
  sendPendingAppointmentReminders,
} from "./advising-appointments";
import { syncInterventionNotifications } from "./advising-interventions";
import { loadStudentAlertSyncContext } from "./advising-sync-context";
import {
  applyStudentAlertSyncPlan,
  buildStudentAlertSyncPlan,
} from "./advising-sync";
import {
  buildBookableAdvisorSlots,
  formatMinutesLabel,
  minutesFromTimeInput,
  timeInputFromMinutes,
  type AdvisorAvailabilityRecord,
  type BookableAdvisor,
  type BookableSlot,
  type ScheduledAdvisorAppointment,
} from "./advising-scheduling";
import { prisma } from "./db";
import { logger } from "./logger";
export { buildStudentAlertDescriptors } from "./advising-alerts";
export {
  buildBookableAdvisorSlots,
  formatMinutesLabel,
  minutesFromTimeInput,
  timeInputFromMinutes,
} from "./advising-scheduling";
export {
  sendAppointmentConfirmation,
  sendPendingAppointmentReminders,
} from "./advising-appointments";

export const APPOINTMENT_STATUSES = ["scheduled", "completed", "cancelled", "missed"] as const;
export const TASK_STATUSES = ["open", "in_progress", "completed"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export const NOTE_CATEGORIES = ["general", "check_in", "risk", "career", "celebration"] as const;
export const NOTE_VISIBILITIES = ["teacher"] as const;
export const AVAILABILITY_LOCATION_TYPES = ["virtual", "in_person", "phone"] as const;
export const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];
export type AvailabilityLocationType = (typeof AVAILABILITY_LOCATION_TYPES)[number];

function isValueInSet<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value as T[number]);
}

export function isAppointmentStatus(value: string): value is AppointmentStatus {
  return isValueInSet(APPOINTMENT_STATUSES, value);
}

export function isTaskStatus(value: string): value is TaskStatus {
  return isValueInSet(TASK_STATUSES, value);
}

export function isTaskPriority(value: string): value is TaskPriority {
  return isValueInSet(TASK_PRIORITIES, value);
}

export function isNoteCategory(value: string): value is NoteCategory {
  return isValueInSet(NOTE_CATEGORIES, value);
}

export function isAvailabilityLocationType(value: string): value is AvailabilityLocationType {
  return isValueInSet(AVAILABILITY_LOCATION_TYPES, value);
}

function startOfDay(value: Date) {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day;
}

function addDays(value: Date, amount: number) {
  const day = new Date(value);
  day.setDate(day.getDate() + amount);
  return day;
}

export async function listBookableAdvisors({
  now = new Date(),
  days = 14,
  maxSlotsPerAdvisor = 12,
  minimumLeadMinutes = 60,
}: {
  now?: Date;
  days?: number;
  maxSlotsPerAdvisor?: number;
  minimumLeadMinutes?: number;
} = {}) {
  const upperBound = addDays(startOfDay(now), days + 1);
  const [blocks, appointments] = await Promise.all([
    prisma.advisorAvailability.findMany({
      where: {
        active: true,
        advisor: {
          role: "teacher",
        },
      },
      select: {
        id: true,
        advisorId: true,
        weekday: true,
        startMinutes: true,
        endMinutes: true,
        slotMinutes: true,
        locationType: true,
        locationLabel: true,
        meetingUrl: true,
        active: true,
        advisor: {
          select: {
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: [{ advisor: { displayName: "asc" } }, { weekday: "asc" }, { startMinutes: "asc" }],
    }),
    prisma.appointment.findMany({
      where: {
        status: "scheduled",
        startsAt: {
          gte: now,
          lte: upperBound,
        },
      },
      select: {
        advisorId: true,
        startsAt: true,
        endsAt: true,
        status: true,
      },
    }),
  ]);

  return buildBookableAdvisorSlots({
    advisors: blocks.map((block) => ({
      ...block,
      locationType: block.locationType as AvailabilityLocationType,
      advisorName: block.advisor.displayName,
      advisorEmail: block.advisor.email,
    })),
    appointments,
    now,
    days,
    maxSlotsPerAdvisor,
    minimumLeadMinutes,
  });
}

export async function syncStudentAlerts(studentId: string) {
  const now = new Date();
  const context = await loadStudentAlertSyncContext(studentId, now);
  const { existing } = context;
  const {
    studentSignals,
    goalEvidenceEntries,
    goalReviewItems,
    desiredAlerts,
  } = buildStudentAlertSyncPlan({
    studentId,
    now,
    context,
  });

  await applyStudentAlertSyncPlan({
    studentId,
    now,
    existing,
    desiredAlerts,
  });

  if (studentSignals) {
    try {
      await syncInterventionNotifications({
        studentId,
        studentName: studentSignals.displayName,
        studentLabel: studentSignals.studentId,
        studentEmail: studentSignals.email,
        alerts: desiredAlerts,
        evidenceEntries: goalEvidenceEntries,
        reviewQueue: goalReviewItems,
        now,
      });
    } catch (error) {
      logger.error("Failed to sync intervention notifications", {
        studentId,
        error: String(error),
      });
    }
  }
}

export async function syncAlertsForStudents(studentIds: string[], batchSize: number = 4) {
  for (let index = 0; index < studentIds.length; index += batchSize) {
    const batch = studentIds.slice(index, index + batchSize);
    await Promise.all(batch.map((studentId) => syncStudentAlerts(studentId)));
  }
}
