export interface AdvisorAvailabilityRecord {
  id: string;
  advisorId: string;
  advisorName: string;
  advisorEmail: string | null;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
  locationType: "virtual" | "in_person" | "phone";
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
  locationType: "virtual" | "in_person" | "phone";
  locationLabel: string | null;
  meetingUrl: string | null;
}

export interface BookableAdvisor {
  advisorId: string;
  advisorName: string;
  slots: BookableSlot[];
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
