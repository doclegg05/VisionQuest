"use client";

import { useEffect, useState } from "react";
import { WEEKDAY_OPTIONS, formatMinutesLabel } from "@/lib/advising-ui";
import { useConfirm } from "@/components/ui/useConfirm";

interface AvailabilityBlock {
  id: string;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
  locationType: string;
  locationLabel: string | null;
  meetingUrl: string | null;
  active: boolean;
  startLabel: string;
  endLabel: string;
}

export default function AdvisingManager() {
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const [scheduledAppointments, setScheduledAppointments] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    weekday: "1",
    startTime: "09:00",
    endTime: "12:00",
    slotMinutes: "30",
    locationType: "virtual",
    locationLabel: "Zoom",
    meetingUrl: "",
  });
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    void fetchAvailability();
  }, []);

  async function fetchAvailability() {
    try {
      setLoading(true);
      const response = await fetch("/api/teacher/availability");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load availability.");
      }
      setBlocks(payload.blocks || []);
      setScheduledAppointments(payload.scheduledAppointments || 0);
      setError(null);
    } catch (err) {
      console.error("Failed to load advising settings:", err instanceof Error ? err.message : "Unknown error");
      setError(err instanceof Error ? err.message : "Failed to load availability.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setStatusMessage(null);

    try {
      const response = await fetch("/api/teacher/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          weekday: Number(form.weekday),
          slotMinutes: Number(form.slotMinutes),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not save this availability block.");
      }

      setShowForm(false);
      setForm({
        weekday: "1",
        startTime: "09:00",
        endTime: "12:00",
        slotMinutes: "30",
        locationType: "virtual",
        locationLabel: "Zoom",
        meetingUrl: "",
      });
      setStatusMessage("Availability block added.");
      await fetchAvailability();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Could not save this availability block.");
    }
  }

  async function handleDelete(id: string) {
    if (
      !(await confirm({
        title: "Remove this availability block?",
        message: "Students can no longer book times from it.",
        confirmLabel: "Remove",
      }))
    ) {
      return;
    }

    setStatusMessage(null);
    try {
      const response = await fetch(`/api/teacher/availability/${id}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not remove this availability block.");
      }

      setStatusMessage("Availability block removed.");
      await fetchAvailability();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Could not remove this availability block.");
    }
  }

  async function handleSendReminders() {
    setSendingReminders(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/teacher/appointments/reminders", {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not send reminders.");
      }
      setStatusMessage(`Sent ${payload.sent} reminder batch(es).`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Could not send reminders.");
    } finally {
      setSendingReminders(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading...</p>;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--badge-error-text)] mb-4">{error}</p>
        <button onClick={() => void fetchAvailability()} className="primary-button px-4 py-2 rounded-lg">
          Try Again
        </button>
      </div>
    );
  }

  const grouped = WEEKDAY_OPTIONS.map((weekday) => ({
    ...weekday,
    blocks: blocks.filter((block) => block.weekday === weekday.value),
  })).filter((weekday) => weekday.blocks.length > 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="theme-card rounded-xl p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Live office hours</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ink-strong)]">{blocks.length}</p>
          <p className="text-sm text-[var(--ink-muted)]">Availability blocks students can book from</p>
        </div>
        <div className="theme-card rounded-xl p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Scheduled</p>
          <p className="mt-2 text-2xl font-bold text-[var(--badge-success-text)]">{scheduledAppointments}</p>
          <p className="text-sm text-[var(--ink-muted)]">Upcoming advising appointments on your calendar</p>
        </div>
        <div className="theme-card rounded-xl p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Reminders</p>
          <button
            type="button"
            onClick={() => void handleSendReminders()}
            disabled={sendingReminders}
            className="mt-3 inline-flex rounded-full bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-green)]/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sendingReminders ? "Sending..." : "Send upcoming reminders"}
          </button>
        </div>
      </div>

      {statusMessage ? (
        <div className="rounded-xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] px-4 py-3 text-sm text-[var(--ink-strong)]">
          {statusMessage}
        </div>
      ) : null}

      {grouped.length === 0 ? (
        <div className="text-center text-[var(--ink-muted)] py-8 text-sm theme-card rounded-xl">
          No advising availability yet. Add office hours so students can self-book.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((weekday) => (
            <div key={weekday.value} className="theme-card rounded-xl p-4">
              <h3 className="text-sm font-semibold text-[var(--ink-strong)]">{weekday.label}</h3>
              <div className="mt-3 space-y-2">
                {weekday.blocks.map((block) => (
                  <div
                    key={block.id}
                    className="flex items-start justify-between gap-3 theme-card-subtle rounded-lg px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-[var(--ink-strong)]">
                        {formatMinutesLabel(block.startMinutes)} to {formatMinutesLabel(block.endMinutes)}
                      </p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        {block.slotMinutes}-minute slots • {block.locationLabel || block.locationType.replace("_", " ")}
                      </p>
                      {block.meetingUrl ? (
                        <p className="mt-1 text-xs text-[var(--badge-info-text)]">{block.meetingUrl}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(block.id)}
                      className="inline-flex items-center pointer-coarse:min-h-11 text-xs text-[var(--badge-error-text)] hover:underline px-2 py-1"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="theme-card rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--ink-strong)]">New Availability Block</h3>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Day</span>
              <select
                value={form.weekday}
                onChange={(event) => setForm((current) => ({ ...current, weekday: event.target.value }))}
                className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
              >
                {WEEKDAY_OPTIONS.map((weekday) => (
                  <option key={weekday.value} value={weekday.value}>
                    {weekday.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Start</span>
              <input
                type="time"
                value={form.startTime}
                onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))}
                className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
              />
            </label>

            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">End</span>
              <input
                type="time"
                value={form.endTime}
                onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))}
                className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
              />
            </label>

            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Slot length</span>
              <select
                value={form.slotMinutes}
                onChange={(event) => setForm((current) => ({ ...current, slotMinutes: event.target.value }))}
                className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
              >
                {[15, 30, 45, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm text-[var(--ink-muted)]">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Format</span>
              <select
                value={form.locationType}
                onChange={(event) => setForm((current) => ({ ...current, locationType: event.target.value }))}
                className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
              >
                <option value="virtual">Virtual</option>
                <option value="in_person">In person</option>
                <option value="phone">Phone</option>
              </select>
            </label>

            <label className="text-sm text-[var(--ink-muted)] md:col-span-2">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Location label</span>
              <input
                type="text"
                value={form.locationLabel}
                onChange={(event) => setForm((current) => ({ ...current, locationLabel: event.target.value }))}
                placeholder="Zoom, Room 201, Phone"
                className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
              />
            </label>
          </div>

          <label className="block text-sm text-[var(--ink-muted)]">
            <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Meeting link (optional)</span>
            <input
              type="url"
              value={form.meetingUrl}
              onChange={(event) => setForm((current) => ({ ...current, meetingUrl: event.target.value }))}
              className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              className="primary-button text-sm px-4 py-2 rounded-lg"
            >
              Add Availability
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-[var(--ink-muted)] px-4 py-2 hover:text-[var(--ink-strong)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-[var(--border-strong)] rounded-xl p-3 text-sm text-[var(--ink-muted)] hover:border-[var(--accent-blue)] hover:text-[var(--badge-info-text)] transition-colors"
        >
          + Add Office Hours
        </button>
      )}
      {confirmDialog}
    </div>
  );
}
