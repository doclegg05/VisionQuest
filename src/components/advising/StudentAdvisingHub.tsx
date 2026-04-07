"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface StudentAdvisingHubProps {
  alerts: Array<{
    id: string;
    severity: string;
    title: string;
    summary: string;
    detectedAt: string;
  }>;
  appointments: Array<{
    id: string;
    title: string;
    description: string | null;
    startsAt: string;
    endsAt: string;
    status: string;
    locationType: string;
    locationLabel: string | null;
    meetingUrl: string | null;
    notes: string | null;
    advisorName: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    dueAt: string | null;
    status: string;
    priority: string;
    completedAt: string | null;
    createdAt: string;
    createdByName: string;
  }>;
  bookableAdvisors: Array<{
    advisorId: string;
    advisorName: string;
    slots: Array<{
      key: string;
      startsAt: string;
      endsAt: string;
      locationType: string;
      locationLabel: string | null;
      meetingUrl: string | null;
    }>;
  }>;
}

export default function StudentAdvisingHub({
  alerts,
  appointments,
  tasks,
  bookableAdvisors,
}: StudentAdvisingHubProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookingPending, setBookingPending] = useState(false);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [bookingForm, setBookingForm] = useState(() => ({
    advisorId: bookableAdvisors[0]?.advisorId || "",
    startsAt: bookableAdvisors[0]?.slots[0]?.startsAt || "",
    title: "",
    description: "",
  }));

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const openTasks = tasks.filter((task) => task.status !== "completed");
  const completedTasks = tasks.filter((task) => task.status === "completed");
  const now = Date.now();
  const upcomingAppointments = appointments.filter((appointment) => new Date(appointment.endsAt).getTime() >= now);
  const pastAppointments = appointments.filter((appointment) => new Date(appointment.endsAt).getTime() < now);
  const selectedAdvisor = bookableAdvisors.find((advisor) => advisor.advisorId === bookingForm.advisorId) || bookableAdvisors[0] || null;
  const selectedSlot = selectedAdvisor?.slots.find((slot) => slot.startsAt === bookingForm.startsAt) || selectedAdvisor?.slots[0] || null;

  function updateTaskStatus(taskId: string, status: "open" | "completed") {
    setUpdatingTaskId(taskId);
    setError(null);
    setIsPending(true);
    void (async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Could not update the task.");
        }

        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update the task.");
      } finally {
        setUpdatingTaskId(null);
        setIsPending(false);
      }
    })();
  }

  async function bookAppointment() {
    if (!bookingForm.advisorId || !bookingForm.startsAt) return;

    setBookingPending(true);
    setBookingStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/appointments/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingForm),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not book the appointment.");
      }

      setBookingStatus("Appointment booked.");
      router.refresh();
    } catch (err) {
      setBookingStatus(err instanceof Error ? err.message : "Could not book the appointment.");
    } finally {
      setBookingPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="surface-section p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-[var(--ink-strong)]">Book Advising Time</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Reserve an open slot with a teacher without waiting for someone else to schedule it.
            </p>
          </div>
          <span className="rounded-full bg-[rgba(15,154,146,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-secondary)]">
            {bookableAdvisors.reduce((sum, advisor) => sum + advisor.slots.length, 0)} open slots
          </span>
        </div>

        {bookableAdvisors.length === 0 ? (
          <div className="mt-4 rounded-[1.2rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
            Your teachers haven&apos;t published bookable office hours yet. Check back soon or message staff directly.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 2xl:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-3 rounded-[1.2rem] border border-[rgba(18,38,63,0.1)] bg-[var(--surface-raised)] p-4">
              <label className="text-sm text-[var(--ink-muted)]">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Advisor
                </span>
                <select
                  value={selectedAdvisor?.advisorId || ""}
                  onChange={(event) => {
                    const nextAdvisor = bookableAdvisors.find((advisor) => advisor.advisorId === event.target.value);
                    setBookingForm((current) => ({
                      ...current,
                      advisorId: event.target.value,
                      startsAt: nextAdvisor?.slots[0]?.startsAt || "",
                    }));
                  }}
                  className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {bookableAdvisors.map((advisor) => (
                    <option key={advisor.advisorId} value={advisor.advisorId}>
                      {advisor.advisorName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-[var(--ink-muted)]">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  Time slot
                </span>
                <select
                  value={selectedSlot?.startsAt || ""}
                  onChange={(event) => setBookingForm((current) => ({ ...current, startsAt: event.target.value }))}
                  className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {(selectedAdvisor?.slots || []).map((slot) => (
                    <option key={slot.key} value={slot.startsAt}>
                      {dateFormatter.format(new Date(slot.startsAt))} • {slot.locationLabel || slot.locationType.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>

              <input
                type="text"
                value={bookingForm.title}
                onChange={(event) => setBookingForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Appointment title (optional)"
                className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <textarea
                value={bookingForm.description}
                onChange={(event) => setBookingForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="What would you like help with?"
                rows={4}
                className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <button
                type="button"
                disabled={bookingPending || !selectedAdvisor || !selectedSlot}
                onClick={() => void bookAppointment()}
                className="primary-button w-full px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bookingPending ? "Booking..." : "Book appointment"}
              </button>

              {bookingStatus ? (
                <p className="text-sm text-[var(--ink-muted)]">{bookingStatus}</p>
              ) : null}
            </div>

            <div className="rounded-[1.2rem] border border-[rgba(15,154,146,0.15)] bg-[rgba(15,154,146,0.08)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-secondary)]">
                Selected slot
              </p>
              {selectedSlot && selectedAdvisor ? (
                <>
                  <p className="mt-3 font-display text-2xl text-[var(--ink-strong)]">
                    {selectedAdvisor.advisorName}
                  </p>
                  <p className="mt-2 text-sm text-[var(--ink-muted)]">
                    {dateFormatter.format(new Date(selectedSlot.startsAt))}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    {selectedSlot.locationLabel || selectedSlot.locationType.replace("_", " ")}
                  </p>
                  {selectedSlot.meetingUrl ? (
                    <p className="mt-3 text-sm text-[var(--accent-strong)]">Link will be included in your confirmation.</p>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-sm text-[var(--ink-muted)]">
                  Choose an advisor and time slot to review the appointment details here.
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {error ? (
        <div className="surface-section border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 2xl:grid-cols-[1.1fr_0.9fr]">
        <section className="surface-section p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl text-[var(--ink-strong)]">Upcoming Appointments</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Meetings your advisors have scheduled with you.
              </p>
            </div>
            <span className="rounded-full bg-[rgba(15,154,146,0.1)] px-3 py-1 text-xs font-semibold text-[var(--accent-secondary)]">
              {upcomingAppointments.length} upcoming
            </span>
          </div>

          {upcomingAppointments.length === 0 ? (
            <div className="rounded-[1.2rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
              No upcoming advising appointments are on your calendar right now.
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingAppointments.map((appointment) => (
                <div
                  key={appointment.id}
                  className="rounded-[1.2rem] border border-[rgba(18,38,63,0.1)] bg-[var(--surface-raised)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-semibold text-[var(--ink-strong)]">{appointment.title}</p>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">
                        {dateFormatter.format(new Date(appointment.startsAt))}
                      </p>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">
                        With {appointment.advisorName}
                      </p>
                    </div>
                    <span className="max-w-full whitespace-normal rounded-full bg-[rgba(16,37,62,0.08)] px-3 py-1 text-center text-xs leading-4 font-semibold text-[var(--ink-strong)]">
                      {appointment.locationLabel || appointment.locationType.replace("_", " ")}
                    </span>
                  </div>
                  {appointment.description ? (
                    <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{appointment.description}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-3 text-sm">
                    {appointment.meetingUrl ? (
                      <a
                        href={appointment.meetingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-[var(--accent-strong)]"
                      >
                        Join meeting
                      </a>
                    ) : null}
                    {appointment.notes ? (
                      <span className="text-[var(--ink-muted)]">Note: {appointment.notes}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="surface-section p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl text-[var(--ink-strong)]">Attention Queue</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Items that need a response so nothing slips.
              </p>
            </div>
            <span className="rounded-full bg-[rgba(249,115,22,0.12)] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]">
              {alerts.length} open
            </span>
          </div>

          {alerts.length === 0 ? (
            <div className="rounded-[1.2rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
              You&apos;re caught up. New alerts will show up here when a follow-up becomes overdue.
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div key={alert.id} className="rounded-[1.2rem] border border-amber-200 bg-amber-50/80 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="break-words font-semibold text-[var(--ink-strong)]">{alert.title}</p>
                    <span className="rounded-full bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-amber-800">
                      {alert.severity}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{alert.summary}</p>
                  <p className="mt-2 text-xs text-[var(--ink-muted)]">
                    Detected {dateFormatter.format(new Date(alert.detectedAt))}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[1.1fr_0.9fr]">
        <section className="surface-section p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl text-[var(--ink-strong)]">Follow-Up Tasks</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Complete these actions to stay on track with your advisor.
              </p>
            </div>
            <span className="rounded-full bg-[rgba(16,37,62,0.08)] px-3 py-1 text-xs font-semibold text-[var(--ink-strong)]">
              {openTasks.length} open
            </span>
          </div>

          {tasks.length === 0 ? (
            <div className="rounded-[1.2rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
              No follow-up tasks have been assigned yet.
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => {
                const isCompleted = task.status === "completed";
                const dueLabel = task.dueAt
                  ? `Due ${dateFormatter.format(new Date(task.dueAt))}`
                  : "No due date";

                return (
                  <div
                    key={task.id}
                    className={`rounded-[1.2rem] border p-4 ${
                      isCompleted
                        ? "border-emerald-200 bg-emerald-50/70"
                        : "border-[rgba(18,38,63,0.1)] bg-[var(--surface-raised)]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-semibold text-[var(--ink-strong)]">{task.title}</p>
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">{dueLabel}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                          Added by {task.createdByName}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        task.priority === "high"
                          ? "bg-rose-100 text-rose-800"
                          : task.priority === "low"
                            ? "bg-[var(--surface-interactive)] text-[var(--ink-strong)]"
                            : "bg-amber-100 text-amber-800"
                      }`}>
                        {task.priority}
                      </span>
                    </div>

                    {task.description ? (
                      <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{task.description}</p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={isPending && updatingTaskId === task.id}
                        onClick={() => updateTaskStatus(task.id, isCompleted ? "open" : "completed")}
                        className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                          isCompleted
                            ? "bg-[var(--surface-raised)] text-[var(--ink-strong)] hover:bg-[var(--surface-interactive)]"
                            : "bg-[var(--ink-strong)] text-white hover:bg-[rgba(16,37,62,0.9)]"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {isPending && updatingTaskId === task.id
                          ? "Saving..."
                          : isCompleted
                            ? "Reopen task"
                            : "Mark complete"}
                      </button>
                      {task.completedAt ? (
                        <span className="text-xs text-[var(--ink-muted)]">
                          Completed {dateFormatter.format(new Date(task.completedAt))}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="surface-section p-5">
          <div className="mb-4">
            <h2 className="font-display text-2xl text-[var(--ink-strong)]">Recent History</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Past advising activity and recently completed items.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Past Appointments</h3>
              {pastAppointments.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--ink-muted)]">No past appointments yet.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {pastAppointments.slice(0, 5).map((appointment) => (
                    <div key={appointment.id} className="rounded-[1rem] border border-[rgba(18,38,63,0.1)] bg-[var(--surface-raised)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <p className="break-words text-sm font-semibold text-[var(--ink-strong)]">{appointment.title}</p>
                        <span className="text-xs text-[var(--ink-muted)]">
                          {dateFormatter.format(new Date(appointment.startsAt))}
                        </span>
                      </div>
                      <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                        {appointment.status}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Completed Tasks</h3>
              {completedTasks.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--ink-muted)]">You haven&apos;t completed any advising tasks yet.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {completedTasks.slice(0, 5).map((task) => (
                    <div key={task.id} className="rounded-[1rem] border border-emerald-200 bg-emerald-50/70 p-3">
                      <p className="break-words text-sm font-semibold text-[var(--ink-strong)]">{task.title}</p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        Completed {task.completedAt ? dateFormatter.format(new Date(task.completedAt)) : "recently"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
