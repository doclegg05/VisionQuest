"use client";

import { useEffect, useState } from "react";
import { WEEKDAY_OPTIONS, formatMinutesLabel } from "@/lib/advising-ui";

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
      console.error("Failed to load advising settings:", err);
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
    if (!confirm("Remove this availability block?")) return;

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

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error}</p>
        <button onClick={() => void fetchAvailability()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
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
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-gray-400">Live office hours</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{blocks.length}</p>
          <p className="text-sm text-gray-500">Availability blocks students can book from</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-gray-400">Scheduled</p>
          <p className="mt-2 text-2xl font-bold text-teal-700">{scheduledAppointments}</p>
          <p className="text-sm text-gray-500">Upcoming advising appointments on your calendar</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-gray-400">Reminders</p>
          <button
            type="button"
            onClick={() => void handleSendReminders()}
            disabled={sendingReminders}
            className="mt-3 inline-flex rounded-full bg-[var(--ink-strong)] px-4 py-2 text-sm font-semibold text-white hover:bg-[rgba(16,37,62,0.9)] disabled:cursor-not-allowed disabled:opacity-60"
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
        <div className="text-center text-gray-400 py-8 text-sm bg-white rounded-xl border border-gray-200">
          No advising availability yet. Add office hours so students can self-book.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((weekday) => (
            <div key={weekday.value} className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700">{weekday.label}</h3>
              <div className="mt-3 space-y-2">
                {weekday.blocks.map((block) => (
                  <div
                    key={block.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {formatMinutesLabel(block.startMinutes)} to {formatMinutesLabel(block.endMinutes)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {block.slotMinutes}-minute slots • {block.locationLabel || block.locationType.replace("_", " ")}
                      </p>
                      {block.meetingUrl ? (
                        <p className="mt-1 text-xs text-blue-600">{block.meetingUrl}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(block.id)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
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
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">New Availability Block</h3>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-sm text-gray-600">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">Day</span>
              <select
                value={form.weekday}
                onChange={(event) => setForm((current) => ({ ...current, weekday: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {WEEKDAY_OPTIONS.map((weekday) => (
                  <option key={weekday.value} value={weekday.value}>
                    {weekday.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-gray-600">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">Start</span>
              <input
                type="time"
                value={form.startTime}
                onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="text-sm text-gray-600">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">End</span>
              <input
                type="time"
                value={form.endTime}
                onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="text-sm text-gray-600">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">Slot length</span>
              <select
                value={form.slotMinutes}
                onChange={(event) => setForm((current) => ({ ...current, slotMinutes: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="text-sm text-gray-600">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">Format</span>
              <select
                value={form.locationType}
                onChange={(event) => setForm((current) => ({ ...current, locationType: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="virtual">Virtual</option>
                <option value="in_person">In person</option>
                <option value="phone">Phone</option>
              </select>
            </label>

            <label className="text-sm text-gray-600 md:col-span-2">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-gray-400">Location label</span>
              <input
                type="text"
                value={form.locationLabel}
                onChange={(event) => setForm((current) => ({ ...current, locationLabel: event.target.value }))}
                placeholder="Zoom, Room 201, Phone"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>

          <input
            type="url"
            value={form.meetingUrl}
            onChange={(event) => setForm((current) => ({ ...current, meetingUrl: event.target.value }))}
            placeholder="Optional meeting link"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add Availability
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-gray-500 px-4 py-2 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-gray-300 rounded-xl p-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          + Add Office Hours
        </button>
      )}
    </div>
  );
}
