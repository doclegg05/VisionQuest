"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface EventItem {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  virtualUrl: string | null;
  capacity: number | null;
  registrationRequired: boolean;
  status: string;
  registrationCount: number;
  registration: {
    id: string;
    status: string;
    registeredAt: string;
  } | null;
}

export default function EventsHub({ events }: { events: EventItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function toggleRegistration(eventId: string, registered: boolean) {
    setBusyId(eventId);
    setMessage(null);

    try {
      const response = await fetch(`/api/events/${eventId}/register`, {
        method: registered ? "DELETE" : "POST",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not update your registration.");
      }

      setMessage(registered ? "Registration cancelled." : "You are registered.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update your registration.");
    } finally {
      setBusyId(null);
    }
  }

  const upcomingCount = events.filter((event) => new Date(event.endsAt).getTime() >= Date.now()).length;
  const registeredCount = events.filter((event) => Boolean(event.registration)).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="surface-section p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Upcoming</p>
          <p className="mt-2 text-3xl font-bold text-[var(--ink-strong)]">{upcomingCount}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Career fairs, workshops, and hiring events ahead.</p>
        </div>
        <div className="surface-section p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Registered</p>
          <p className="mt-2 text-3xl font-bold text-[var(--accent-secondary)]">{registeredCount}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Events you&apos;ve committed to attending.</p>
        </div>
        <div className="surface-section p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Momentum</p>
          <p className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">Show up where opportunity gathers</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Register early so teachers can help you prepare for each event.
          </p>
        </div>
      </div>

      {message ? (
        <div className="surface-section border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] p-4 text-sm text-[var(--ink-strong)]">
          {message}
        </div>
      ) : null}

      {events.length === 0 ? (
        <div className="surface-section p-8 text-center text-[var(--ink-muted)]">
          No events are scheduled yet.
        </div>
      ) : (
        <div className="space-y-4">
          {events.map((event) => {
            const isRegistered = Boolean(event.registration);
            const eventIsPast = new Date(event.endsAt).getTime() < Date.now();
            return (
              <div id={`event-${event.id}`} key={event.id} className="surface-section p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-2xl text-[var(--ink-strong)]">{event.title}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        event.status === "scheduled"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-[var(--surface-interactive)] text-[var(--ink-strong)]"
                      }`}>
                        {event.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      {new Date(event.startsAt).toLocaleString()} to {new Date(event.endsAt).toLocaleString()}
                    </p>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">
                      {event.location || "Location to be announced"}
                      {event.capacity ? ` • ${event.registrationCount}/${event.capacity} registered` : ` • ${event.registrationCount} registered`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {event.virtualUrl ? (
                      <a
                        href={event.virtualUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-[rgba(18,38,63,0.12)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-raised)]"
                      >
                        Open link
                      </a>
                    ) : null}
                    {event.registrationRequired && !eventIsPast ? (
                      <button
                        type="button"
                        onClick={() => void toggleRegistration(event.id, isRegistered)}
                        disabled={busyId === event.id}
                        className={`rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                          isRegistered
                            ? "border border-[rgba(18,38,63,0.12)] text-[var(--ink-strong)] hover:bg-[var(--surface-raised)]"
                            : "primary-button"
                        }`}
                      >
                        {busyId === event.id
                          ? "Saving..."
                          : isRegistered
                            ? "Cancel RSVP"
                            : "Register"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {event.description ? (
                  <p className="mt-4 text-sm leading-7 text-[var(--ink-muted)]">{event.description}</p>
                ) : null}

                {event.registration?.registeredAt ? (
                  <p className="mt-3 text-xs text-[var(--ink-muted)]">
                    Registered {new Date(event.registration.registeredAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
