import { prisma } from "./db";

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

export interface AdvisorAvailabilityRecord {
  id: string;
  advisorId: string;
  advisorName: string;
  advisorEmail: string | null;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
  locationType: AvailabilityLocationType;
  locationLabel: string | null;
  meetingUrl: string | null;
  active: boolean;
}

export interface ScheduledAdvisorAppointment {
  advisorId: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

export interface BookableSlot {
  key: string;
  startsAt: string;
  endsAt: string;
  locationType: AvailabilityLocationType;
  locationLabel: string | null;
  meetingUrl: string | null;
}

export interface BookableAdvisor {
  advisorId: string;
  advisorName: string;
  slots: BookableSlot[];
}

interface AlertDescriptor {
  alertKey: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
}

interface AlertInputs {
  tasks: Array<{
    id: string;
    title: string;
    dueAt: Date | null;
  }>;
  appointments: Array<{
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
  }>;
  signals?: {
    studentId?: string;
    studentCreatedAt?: Date | null;
    lastActivityAt?: Date | null;
    applicationCount?: number;
    eventRegistrationCount?: number;
    certification?: {
      status: string | null;
      startedAt: Date | null;
      lastProgressAt: Date | null;
      completedRequiredCount: number;
      requiredCount: number;
    } | null;
  };
  now?: Date;
}

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

function formatAlertDate(value: Date) {
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function latestDate(...values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

export function buildStudentAlertDescriptors({
  tasks,
  appointments,
  signals,
  now = new Date(),
}: AlertInputs): AlertDescriptor[] {
  const alerts: AlertDescriptor[] = [];

  for (const task of tasks) {
    if (!task.dueAt || task.dueAt >= now) continue;

    const hoursOverdue = (now.getTime() - task.dueAt.getTime()) / 36e5;
    alerts.push({
      alertKey: `overdue_task:${task.id}`,
      type: "overdue_task",
      severity: hoursOverdue >= 48 ? "high" : "medium",
      title: "Overdue follow-up task",
      summary: `"${task.title}" was due ${formatAlertDate(task.dueAt)}.`,
      sourceType: "task",
      sourceId: task.id,
    });
  }

  for (const appointment of appointments) {
    if (appointment.endsAt >= now) continue;

    alerts.push({
      alertKey: `missed_appointment:${appointment.id}`,
      type: "missed_appointment",
      severity: "high",
      title: "Past-due appointment follow-up",
      summary: `"${appointment.title}" ended ${formatAlertDate(appointment.endsAt)} and still needs a status update.`,
      sourceType: "appointment",
      sourceId: appointment.id,
    });
  }

  const studentKey = signals?.studentId || "student";
  const lastActivityAt = latestDate(signals?.lastActivityAt, signals?.studentCreatedAt);
  if (lastActivityAt) {
    const inactiveDays = (now.getTime() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24);
    if (inactiveDays >= 7) {
      alerts.push({
        alertKey: `inactive_student:${studentKey}`,
        type: "inactive_student",
        severity: inactiveDays >= 14 ? "high" : "medium",
        title: "Low recent activity",
        summary: `No recorded student activity since ${formatAlertDate(lastActivityAt)}.`,
        sourceType: "student",
        sourceId: signals?.studentId || studentKey,
      });
    }
  }

  if (
    signals?.studentCreatedAt &&
    (signals.applicationCount || 0) === 0 &&
    (signals.eventRegistrationCount || 0) === 0
  ) {
    const daysSinceEnrollment =
      (now.getTime() - signals.studentCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceEnrollment >= 21) {
      alerts.push({
        alertKey: `career_inactive:${studentKey}`,
        type: "career_inactive",
        severity: daysSinceEnrollment >= 45 ? "high" : "medium",
        title: "Career activity still needs momentum",
        summary: `No job applications or event registrations have been recorded since enrollment on ${formatAlertDate(signals.studentCreatedAt)}.`,
        sourceType: "student",
        sourceId: signals?.studentId || studentKey,
      });
    }
  }

  const certification = signals?.certification;
  if (
    certification &&
    certification.status !== "completed" &&
    certification.requiredCount > 0 &&
    certification.completedRequiredCount < certification.requiredCount
  ) {
    const referenceDate = latestDate(certification.lastProgressAt, certification.startedAt, signals?.studentCreatedAt);
    if (referenceDate) {
      const stalledDays = (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
      if (stalledDays >= 14) {
        alerts.push({
          alertKey: `certification_stalled:${studentKey}`,
          type: "certification_stalled",
          severity: stalledDays >= 28 ? "high" : "medium",
          title: "Certification progress has stalled",
          summary: `Certification progress has not advanced since ${formatAlertDate(referenceDate)}.`,
          sourceType: "certification",
          sourceId: signals?.studentId || studentKey,
        });
      }
    }
  }

  return alerts;
}

export function formatMinutesLabel(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${minutes.toString().padStart(2, "0")} ${suffix}`;
}

export function minutesFromTimeInput(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, hoursText, minutesText] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
}

export function timeInputFromMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
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

function withMinutes(day: Date, totalMinutes: number) {
  const value = new Date(day);
  value.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
  return value;
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && startB < endA;
}

export function buildBookableAdvisorSlots({
  advisors,
  appointments,
  now = new Date(),
  days = 14,
  maxSlotsPerAdvisor = 12,
  minimumLeadMinutes = 60,
}: {
  advisors: AdvisorAvailabilityRecord[];
  appointments: ScheduledAdvisorAppointment[];
  now?: Date;
  days?: number;
  maxSlotsPerAdvisor?: number;
  minimumLeadMinutes?: number;
}): BookableAdvisor[] {
  const minimumLeadTime = now.getTime() + minimumLeadMinutes * 60 * 1000;
  const firstDay = startOfDay(now);
  const scheduledByAdvisor = new Map<string, ScheduledAdvisorAppointment[]>();

  for (const appointment of appointments) {
    const existing = scheduledByAdvisor.get(appointment.advisorId) || [];
    existing.push(appointment);
    scheduledByAdvisor.set(appointment.advisorId, existing);
  }

  const advisorMap = new Map<string, BookableAdvisor>();

  for (const block of advisors) {
    if (!block.active) continue;

    const current = advisorMap.get(block.advisorId) || {
      advisorId: block.advisorId,
      advisorName: block.advisorName,
      slots: [],
    };

    for (let offset = 0; offset < days; offset += 1) {
      const day = addDays(firstDay, offset);
      if (day.getDay() !== block.weekday) continue;

      for (
        let minute = block.startMinutes;
        minute + block.slotMinutes <= block.endMinutes;
        minute += block.slotMinutes
      ) {
        const startsAt = withMinutes(day, minute);
        const endsAt = withMinutes(day, minute + block.slotMinutes);

        if (startsAt.getTime() <= minimumLeadTime) continue;

        const advisorAppointments = scheduledByAdvisor.get(block.advisorId) || [];
        const hasConflict = advisorAppointments.some((appointment) =>
          overlaps(startsAt, endsAt, appointment.startsAt, appointment.endsAt)
        );
        if (hasConflict) continue;

        current.slots.push({
          key: `${block.id}:${startsAt.toISOString()}`,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          locationType: block.locationType,
          locationLabel: block.locationLabel,
          meetingUrl: block.meetingUrl,
        });
      }
    }

    advisorMap.set(block.advisorId, current);
  }

  return Array.from(advisorMap.values())
    .map((advisor) => ({
      ...advisor,
      slots: advisor.slots
        .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
        .slice(0, maxSlotsPerAdvisor),
    }))
    .filter((advisor) => advisor.slots.length > 0)
    .sort((left, right) => left.advisorName.localeCompare(right.advisorName));
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

async function getAppointmentEmailContext(appointmentId: string) {
  return prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      title: true,
      description: true,
      startsAt: true,
      endsAt: true,
      locationType: true,
      locationLabel: true,
      meetingUrl: true,
      notes: true,
      student: {
        select: {
          displayName: true,
          email: true,
        },
      },
      advisor: {
        select: {
          displayName: true,
          email: true,
        },
      },
    },
  });
}

type AppointmentEmailContext = {
  title: string;
  startsAt: Date;
  locationType: string;
  locationLabel: string | null;
  meetingUrl: string | null;
  notes: string | null;
};

function buildAppointmentEmailCopy(appointment: AppointmentEmailContext) {
  const when = appointment.startsAt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const where = appointment.locationLabel || appointment.locationType.replace("_", " ");
  const optionalLink = appointment.meetingUrl ? `\nJoin link: ${appointment.meetingUrl}` : "";
  const optionalNotes = appointment.notes ? `\nNotes: ${appointment.notes}` : "";

  return {
    when,
    where,
    optionalLink,
    optionalNotes,
  };
}

export async function sendAppointmentConfirmation(appointmentId: string) {
  const { isEmailDeliveryConfigured, sendEmail } = await import("./email");
  if (!isEmailDeliveryConfigured()) {
    return { sent: false, reason: "email_not_configured" as const };
  }

  const appointment = await getAppointmentEmailContext(appointmentId);
  if (!appointment) {
    return { sent: false, reason: "missing_appointment" as const };
  }

  const emailCopy = buildAppointmentEmailCopy(appointment);
  const recipients = [
    appointment.student.email
      ? {
          to: appointment.student.email,
          subject: `Visionquest appointment confirmed: ${appointment.title}`,
          text:
            `Hi ${appointment.student.displayName},\n\n` +
            `Your advising appointment "${appointment.title}" is confirmed for ${emailCopy.when}.\n` +
            `Location: ${emailCopy.where}` +
            `${emailCopy.optionalLink}${emailCopy.optionalNotes}\n\n` +
            `Advisor: ${appointment.advisor.displayName}\n\nSee you there.`,
        }
      : null,
    appointment.advisor.email
      ? {
          to: appointment.advisor.email,
          subject: `Visionquest appointment booked: ${appointment.title}`,
          text:
            `Hi ${appointment.advisor.displayName},\n\n` +
            `${appointment.student.displayName} has an appointment scheduled for ${emailCopy.when}.\n` +
            `Location: ${emailCopy.where}` +
            `${emailCopy.optionalLink}${emailCopy.optionalNotes}\n\n` +
            `Title: ${appointment.title}`,
        }
      : null,
  ].filter((entry): entry is { to: string; subject: string; text: string } => Boolean(entry));

  if (recipients.length === 0) {
    return { sent: false, reason: "missing_recipient_email" as const };
  }

  for (const recipient of recipients) {
    await sendEmail(recipient);
  }

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      confirmationSentAt: new Date(),
    },
  });

  return { sent: true as const, recipientCount: recipients.length };
}

export async function sendPendingAppointmentReminders({
  now = new Date(),
  lookAheadHours = 24,
}: {
  now?: Date;
  lookAheadHours?: number;
} = {}) {
  const { isEmailDeliveryConfigured, sendEmail } = await import("./email");
  if (!isEmailDeliveryConfigured()) {
    return { sent: 0, skipped: 0, reason: "email_not_configured" as const };
  }

  const upperBound = new Date(now.getTime() + lookAheadHours * 60 * 60 * 1000);
  const appointments = await prisma.appointment.findMany({
    where: {
      status: "scheduled",
      reminderSentAt: null,
      startsAt: {
        gte: now,
        lte: upperBound,
      },
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      locationType: true,
      locationLabel: true,
      meetingUrl: true,
      notes: true,
      student: {
        select: {
          displayName: true,
          email: true,
        },
      },
      advisor: {
        select: {
          displayName: true,
          email: true,
        },
      },
    },
  });

  let sent = 0;
  let skipped = 0;

  for (const appointment of appointments) {
    const emailCopy = buildAppointmentEmailCopy(appointment);
    const recipients = [
      appointment.student.email
        ? {
            to: appointment.student.email,
            subject: `Reminder: ${appointment.title} is coming up`,
            text:
              `Hi ${appointment.student.displayName},\n\n` +
              `This is a reminder that "${appointment.title}" starts ${emailCopy.when}.\n` +
              `Location: ${emailCopy.where}` +
              `${emailCopy.optionalLink}${emailCopy.optionalNotes}\n\n` +
              `Advisor: ${appointment.advisor.displayName}`,
          }
        : null,
      appointment.advisor.email
        ? {
            to: appointment.advisor.email,
            subject: `Reminder: ${appointment.title} starts soon`,
            text:
              `Hi ${appointment.advisor.displayName},\n\n` +
              `This is a reminder that "${appointment.title}" with ${appointment.student.displayName} starts ${emailCopy.when}.\n` +
              `Location: ${emailCopy.where}` +
              `${emailCopy.optionalLink}${emailCopy.optionalNotes}`,
          }
        : null,
    ].filter((entry): entry is { to: string; subject: string; text: string } => Boolean(entry));

    if (recipients.length === 0) {
      skipped += 1;
      continue;
    }

    for (const recipient of recipients) {
      await sendEmail(recipient);
    }

    await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        reminderSentAt: now,
      },
    });

    sent += 1;
  }

  return { sent, skipped };
}

export async function syncStudentAlerts(studentId: string) {
  const now = new Date();

  const [tasks, appointments, studentSignals, existing] = await prisma.$transaction([
    prisma.studentTask.findMany({
      where: {
        studentId,
        status: { in: ["open", "in_progress"] },
        dueAt: { not: null, lt: now },
      },
      select: { id: true, title: true, dueAt: true },
    }),
    prisma.appointment.findMany({
      where: {
        studentId,
        OR: [
          {
            status: "scheduled",
            endsAt: { lt: now },
          },
          {
            status: "missed",
          },
        ],
      },
      select: { id: true, title: true, startsAt: true, endsAt: true },
    }),
    prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        createdAt: true,
        conversations: {
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        goals: {
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        portfolioItems: {
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        files: {
          select: { uploadedAt: true },
          orderBy: { uploadedAt: "desc" },
          take: 1,
        },
        appointments: {
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        assignedTasks: {
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        applications: {
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        eventRegistrations: {
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        certifications: {
          where: { certType: "ready-to-work" },
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            requirements: {
              select: {
                completed: true,
                completedAt: true,
                verifiedAt: true,
                template: {
                  select: {
                    required: true,
                  },
                },
              },
            },
          },
          take: 1,
        },
        _count: {
          select: {
            applications: true,
            eventRegistrations: true,
          },
        },
      },
    }),
    prisma.studentAlert.findMany({
      where: {
        studentId,
        status: "open",
        type: {
          in: [
            "overdue_task",
            "missed_appointment",
            "inactive_student",
            "career_inactive",
            "certification_stalled",
          ],
        },
      },
      select: { id: true, alertKey: true },
    }),
  ]);

  const certification = studentSignals?.certifications[0];
  const requiredCertificationRequirements = certification?.requirements.filter(
    (requirement) => requirement.template.required
  ) || [];
  const lastCertificationProgressAt = latestDate(
    certification?.completedAt || null,
    certification?.startedAt || null,
    ...requiredCertificationRequirements.flatMap((requirement) => [
      requirement.completedAt,
      requirement.verifiedAt,
    ])
  );
  const lastActivityAt = latestDate(
    studentSignals?.createdAt || null,
    studentSignals?.conversations[0]?.updatedAt || null,
    studentSignals?.goals[0]?.updatedAt || null,
    studentSignals?.portfolioItems[0]?.updatedAt || null,
    studentSignals?.files[0]?.uploadedAt || null,
    studentSignals?.appointments[0]?.updatedAt || null,
    studentSignals?.assignedTasks[0]?.updatedAt || null,
    studentSignals?.applications[0]?.updatedAt || null,
    studentSignals?.eventRegistrations[0]?.updatedAt || null
  );
  const desiredAlerts = buildStudentAlertDescriptors({
    tasks,
    appointments,
    signals: studentSignals
      ? {
          studentId,
          studentCreatedAt: studentSignals.createdAt,
          lastActivityAt,
          applicationCount: studentSignals._count.applications,
          eventRegistrationCount: studentSignals._count.eventRegistrations,
          certification: certification
            ? {
                status: certification.status,
                startedAt: certification.startedAt,
                lastProgressAt: lastCertificationProgressAt,
                completedRequiredCount: requiredCertificationRequirements.filter(
                  (requirement) => requirement.completed || Boolean(requirement.verifiedAt)
                ).length,
                requiredCount: requiredCertificationRequirements.length,
              }
            : null,
        }
      : undefined,
    now,
  });
  const desiredKeys = new Set(desiredAlerts.map((alert) => alert.alertKey));
  const staleAlertIds = existing
    .filter((alert) => !desiredKeys.has(alert.alertKey))
    .map((alert) => alert.id);

  await prisma.$transaction(async (tx) => {
    for (const alert of desiredAlerts) {
      await tx.studentAlert.upsert({
        where: { alertKey: alert.alertKey },
        update: {
          severity: alert.severity,
          status: "open",
          title: alert.title,
          summary: alert.summary,
          sourceType: alert.sourceType,
          sourceId: alert.sourceId,
          detectedAt: now,
          resolvedAt: null,
        },
        create: {
          studentId,
          alertKey: alert.alertKey,
          type: alert.type,
          severity: alert.severity,
          status: "open",
          title: alert.title,
          summary: alert.summary,
          sourceType: alert.sourceType,
          sourceId: alert.sourceId,
          detectedAt: now,
        },
      });
    }

    if (staleAlertIds.length > 0) {
      await tx.studentAlert.updateMany({
        where: { id: { in: staleAlertIds } },
        data: {
          status: "resolved",
          resolvedAt: now,
        },
      });
    }
  });
}

export async function syncAlertsForStudents(studentIds: string[], batchSize: number = 4) {
  for (let index = 0; index < studentIds.length; index += batchSize) {
    const batch = studentIds.slice(index, index + batchSize);
    await Promise.all(batch.map((studentId) => syncStudentAlerts(studentId)));
  }
}
