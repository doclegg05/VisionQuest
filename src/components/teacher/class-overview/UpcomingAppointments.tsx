"use client";

import Link from "next/link";
import type { UpcomingAppointment } from "@/lib/teacher/dashboard";

export function UpcomingAppointments({
  appointments,
  formatAppointment,
}: {
  appointments: readonly UpcomingAppointment[];
  formatAppointment: (dateStr: string) => string;
}) {
  return (
    <section className="surface-section p-5" aria-labelledby="upcoming-appointments-heading">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-secondary)]">This week</p>
          <h2 id="upcoming-appointments-heading" className="mt-1 font-display text-2xl text-[var(--ink-strong)]">
            Upcoming appointments
          </h2>
        </div>
        <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--accent-secondary)]">
          {appointments.length} scheduled
        </span>
      </div>

      {appointments.length === 0 ? (
        <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          No appointments are scheduled in the next 7 days.
        </p>
      ) : (
        <ul className="space-y-3">
          {appointments.map((appointment) => (
            <li key={appointment.id}>
              <Link
                href={`/teacher/students/${appointment.student.id}`}
                className="block min-h-11 rounded-[1rem] border border-[var(--border)] bg-[var(--surface-muted)] p-4 transition-colors hover:border-[var(--border-strong)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold text-[var(--ink-strong)]">{appointment.title}</p>
                    <p className="mt-1 break-words text-xs text-[var(--ink-muted)]">
                      {appointment.student.displayName} · {appointment.student.studentId}
                    </p>
                  </div>
                  <span className="max-w-full rounded-full bg-[var(--surface-raised)] px-2.5 py-1 text-center text-xs font-semibold text-[var(--accent-secondary)]">
                    {appointment.locationLabel || appointment.locationType.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">{formatAppointment(appointment.startsAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
