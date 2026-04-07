import { prisma } from "./db";

type AppointmentEmailContext = {
  title: string;
  startsAt: Date;
  locationType: string;
  locationLabel: string | null;
  meetingUrl: string | null;
  notes: string | null;
};

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

export function buildAppointmentEmailCopy(appointment: AppointmentEmailContext) {
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
