"use client";

import { useEffect, useState } from "react";
import { useConfirm } from "@/components/ui/useConfirm";

interface Opportunity {
  id: string;
  title: string;
  company: string;
  type: string;
  location: string | null;
  url: string | null;
  description: string | null;
  status: string;
  deadline: string | null;
}

interface CareerEvent {
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
}

type CareerTab = "opportunities" | "events";

const OPPORTUNITY_TYPES = ["job", "internship", "apprenticeship", "fellowship", "event"];
const APPLICATION_STATUSES = ["open", "closed", "archived"];
const EVENT_STATUSES = ["scheduled", "completed", "cancelled", "archived"];
const FIELD_LABEL = "block text-sm font-medium text-[var(--ink-strong)]";

export default function CareerManager() {
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useState<CareerTab>("opportunities");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [events, setEvents] = useState<CareerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [editingOpportunityId, setEditingOpportunityId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [opportunityForm, setOpportunityForm] = useState({
    title: "",
    company: "",
    type: OPPORTUNITY_TYPES[0],
    location: "",
    url: "",
    description: "",
    deadline: "",
    status: APPLICATION_STATUSES[0],
  });
  const [eventForm, setEventForm] = useState({
    title: "",
    description: "",
    startsAt: "",
    endsAt: "",
    location: "",
    virtualUrl: "",
    capacity: "",
    registrationRequired: true,
    status: EVENT_STATUSES[0],
  });

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [opportunityResponse, eventResponse] = await Promise.all([
        fetch("/api/teacher/opportunities"),
        fetch("/api/teacher/events"),
      ]);
      const opportunitiesPayload = await opportunityResponse.json().catch(() => null);
      const eventsPayload = await eventResponse.json().catch(() => null);

      if (!opportunityResponse.ok) {
        throw new Error(opportunitiesPayload?.error || "Could not load opportunities.");
      }
      if (!eventResponse.ok) {
        throw new Error(eventsPayload?.error || "Could not load events.");
      }

      setOpportunities(opportunitiesPayload.opportunities || []);
      setEvents(eventsPayload.events || []);
      setError(null);
    } catch (err) {
      console.error("Failed to load career data:", err instanceof Error ? err.message : "Unknown error");
      setError(err instanceof Error ? err.message : "Could not load career data.");
    } finally {
      setLoading(false);
    }
  }

  function resetOpportunityForm() {
    setEditingOpportunityId(null);
    setOpportunityForm({
      title: "",
      company: "",
      type: OPPORTUNITY_TYPES[0],
      location: "",
      url: "",
      description: "",
      deadline: "",
      status: APPLICATION_STATUSES[0],
    });
  }

  function resetEventForm() {
    setEditingEventId(null);
    setEventForm({
      title: "",
      description: "",
      startsAt: "",
      endsAt: "",
      location: "",
      virtualUrl: "",
      capacity: "",
      registrationRequired: true,
      status: EVENT_STATUSES[0],
    });
  }

  async function saveOpportunity() {
    setStatusMessage(null);

    try {
      const response = await fetch("/api/teacher/opportunities", {
        method: editingOpportunityId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingOpportunityId
            ? { id: editingOpportunityId, ...opportunityForm }
            : opportunityForm
        ),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not save this opportunity.");
      }

      setStatusMessage(editingOpportunityId ? "Opportunity updated." : "Opportunity created.");
      resetOpportunityForm();
      await loadData();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Could not save this opportunity.");
    }
  }

  async function saveEvent() {
    setStatusMessage(null);

    try {
      const response = await fetch("/api/teacher/events", {
        method: editingEventId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingEventId
            ? { id: editingEventId, ...eventForm }
            : eventForm
        ),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not save this event.");
      }

      setStatusMessage(editingEventId ? "Event updated." : "Event created.");
      resetEventForm();
      await loadData();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Could not save this event.");
    }
  }

  async function deleteOpportunity(id: string) {
    if (
      !(await confirm({
        title: "Delete this opportunity?",
        message: "Student applications tracked for it are also removed.",
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    setStatusMessage(null);

    try {
      const response = await fetch("/api/teacher/opportunities", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not delete this opportunity.");
      }

      setStatusMessage("Opportunity deleted.");
      await loadData();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Could not delete this opportunity.");
    }
  }

  async function deleteEvent(id: string) {
    if (
      !(await confirm({
        title: "Delete this event?",
        message: "Student registrations for it are also removed.",
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    setStatusMessage(null);

    try {
      const response = await fetch("/api/teacher/events", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not delete this event.");
      }

      setStatusMessage("Event deleted.");
      await loadData();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Could not delete this event.");
    }
  }

  function startEditOpportunity(opportunity: Opportunity) {
    setEditingOpportunityId(opportunity.id);
    setOpportunityForm({
      title: opportunity.title,
      company: opportunity.company,
      type: opportunity.type,
      location: opportunity.location || "",
      url: opportunity.url || "",
      description: opportunity.description || "",
      deadline: opportunity.deadline ? opportunity.deadline.slice(0, 16) : "",
      status: opportunity.status,
    });
    setTab("opportunities");
  }

  function startEditEvent(event: CareerEvent) {
    setEditingEventId(event.id);
    setEventForm({
      title: event.title,
      description: event.description || "",
      startsAt: event.startsAt.slice(0, 16),
      endsAt: event.endsAt.slice(0, 16),
      location: event.location || "",
      virtualUrl: event.virtualUrl || "",
      capacity: event.capacity ? String(event.capacity) : "",
      registrationRequired: event.registrationRequired,
      status: event.status,
    });
    setTab("events");
  }

  if (loading) return <p className="text-sm text-[var(--ink-faint)]">Loading...</p>;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--badge-error-text)] mb-4">{error}</p>
        <button onClick={() => void loadData()} className="primary-button px-4 py-2 rounded-lg pointer-coarse:min-h-11">
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {confirmDialog}
      <div className="flex gap-1 bg-[var(--surface-interactive)] rounded-xl p-1">
        {[
          { key: "opportunities", label: "Opportunities" },
          { key: "events", label: "Events" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key as CareerTab)}
            className={`flex-1 inline-flex items-center justify-center py-2 text-sm font-medium rounded-lg transition-colors pointer-coarse:min-h-11 ${
              tab === item.key ? "bg-[var(--surface-raised)] text-[var(--ink-strong)] shadow-sm" : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {statusMessage ? (
        <div className="rounded-xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] px-4 py-3 text-sm text-[var(--ink-strong)]">
          {statusMessage}
        </div>
      ) : null}

      {tab === "opportunities" ? (
        <div className="space-y-4">
          <div className="theme-card rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
              {editingOpportunityId ? "Edit Opportunity" : "New Opportunity"}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1.5">
                <span className={FIELD_LABEL}>Title</span>
                <input
                  type="text"
                  value={opportunityForm.title}
                  onChange={(event) => setOpportunityForm((current) => ({ ...current, title: event.target.value }))}
                  className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
              </label>
              <label className="block space-y-1.5">
                <span className={FIELD_LABEL}>Company</span>
                <input
                  type="text"
                  value={opportunityForm.company}
                  onChange={(event) => setOpportunityForm((current) => ({ ...current, company: event.target.value }))}
                  className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block space-y-1.5">
                <span className={FIELD_LABEL}>Type</span>
                <select
                  value={opportunityForm.type}
                  onChange={(event) => setOpportunityForm((current) => ({ ...current, type: event.target.value }))}
                  className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                >
                  {OPPORTUNITY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className={FIELD_LABEL}>Location</span>
                <input
                  type="text"
                  value={opportunityForm.location}
                  onChange={(event) => setOpportunityForm((current) => ({ ...current, location: event.target.value }))}
                  className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
              </label>
              <label className="block space-y-1.5">
                <span className={FIELD_LABEL}>Deadline</span>
                <input
                  type="datetime-local"
                  value={opportunityForm.deadline}
                  onChange={(event) => setOpportunityForm((current) => ({ ...current, deadline: event.target.value }))}
                  className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className={FIELD_LABEL}>External link</span>
              <input
                type="url"
                value={opportunityForm.url}
                onChange={(event) => setOpportunityForm((current) => ({ ...current, url: event.target.value }))}
                className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
            </label>
            <label className="block space-y-1.5">
              <span className={FIELD_LABEL}>Description</span>
              <textarea
                value={opportunityForm.description}
                onChange={(event) => setOpportunityForm((current) => ({ ...current, description: event.target.value }))}
                rows={4}
                className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
            </label>
            {editingOpportunityId ? (
              <label className="block space-y-1.5">
                <span className={FIELD_LABEL}>Status</span>
                <select
                  value={opportunityForm.status}
                  onChange={(event) => setOpportunityForm((current) => ({ ...current, status: event.target.value }))}
                  className="text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                >
                  {APPLICATION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveOpportunity()}
                className="primary-button text-sm px-4 py-2 rounded-lg pointer-coarse:min-h-11"
              >
                {editingOpportunityId ? "Save Changes" : "Add Opportunity"}
              </button>
              {editingOpportunityId ? (
                <button
                  type="button"
                  onClick={resetOpportunityForm}
                  className="inline-flex items-center pointer-coarse:min-h-11 text-sm text-[var(--ink-muted)] px-4 py-2 hover:text-[var(--ink-strong)]"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>

          {opportunities.length === 0 ? (
            <div className="text-center text-[var(--ink-faint)] py-8 text-sm theme-card rounded-xl">
              No opportunities posted yet.
            </div>
          ) : (
            <div className="space-y-2">
              {opportunities.map((opportunity) => (
                <div key={opportunity.id} className="theme-card rounded-xl p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--ink-strong)]">{opportunity.title}</p>
                    <p className="text-xs text-[var(--ink-muted)] mt-1">
                      {opportunity.company} • {opportunity.type}
                      {opportunity.location ? ` • ${opportunity.location}` : ""}
                    </p>
                    {opportunity.description ? (
                      <p className="text-xs text-[var(--ink-muted)] mt-2">{opportunity.description}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-[var(--badge-info-bg)] px-2 py-0.5 text-[var(--badge-info-text)]">{opportunity.status}</span>
                      {opportunity.deadline ? (
                        <span className="rounded-full bg-[var(--badge-warning-bg)] px-2 py-0.5 text-[var(--badge-warning-text)]">
                          Deadline {new Date(opportunity.deadline).toLocaleDateString()}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEditOpportunity(opportunity)} className="inline-flex items-center pointer-coarse:min-h-11 text-xs text-[var(--badge-info-text)] hover:underline px-2 py-1">
                      Edit
                    </button>
                    <button onClick={() => void deleteOpportunity(opportunity.id)} className="inline-flex items-center pointer-coarse:min-h-11 text-xs text-[var(--badge-error-text)] hover:underline px-2 py-1">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="theme-card rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
              {editingEventId ? "Edit Event" : "New Event"}
            </h3>
            <label className="block space-y-1.5">
              <span className={FIELD_LABEL}>Title</span>
              <input
                type="text"
                value={eventForm.title}
                onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))}
                className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
            </label>
            <label className="block space-y-1.5">
              <span className={FIELD_LABEL}>Description</span>
              <textarea
                value={eventForm.description}
                onChange={(event) => setEventForm((current) => ({ ...current, description: event.target.value }))}
                rows={4}
                className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1.5">
                <span className={FIELD_LABEL}>Start time</span>
                <input
                  type="datetime-local"
                  value={eventForm.startsAt}
                  onChange={(event) => setEventForm((current) => ({ ...current, startsAt: event.target.value }))}
                  className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
              </label>
              <label className="block space-y-1.5">
                <span className={FIELD_LABEL}>End time</span>
                <input
                  type="datetime-local"
                  value={eventForm.endsAt}
                  onChange={(event) => setEventForm((current) => ({ ...current, endsAt: event.target.value }))}
                  className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block space-y-1.5">
                <span className={FIELD_LABEL}>Location</span>
                <input
                  type="text"
                  value={eventForm.location}
                  onChange={(event) => setEventForm((current) => ({ ...current, location: event.target.value }))}
                  className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
              </label>
              <label className="block space-y-1.5">
                <span className={FIELD_LABEL}>Virtual URL</span>
                <input
                  type="url"
                  value={eventForm.virtualUrl}
                  onChange={(event) => setEventForm((current) => ({ ...current, virtualUrl: event.target.value }))}
                  className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
              </label>
              <label className="block space-y-1.5">
                <span className={FIELD_LABEL}>Capacity</span>
                <input
                  type="number"
                  min="1"
                  value={eventForm.capacity}
                  onChange={(event) => setEventForm((current) => ({ ...current, capacity: event.target.value }))}
                  className="w-full text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <input
                type="checkbox"
                checked={eventForm.registrationRequired}
                onChange={(event) => setEventForm((current) => ({ ...current, registrationRequired: event.target.checked }))}
              />
              Students should RSVP for this event
            </label>
            {editingEventId ? (
              <label className="block space-y-1.5">
                <span className={FIELD_LABEL}>Status</span>
                <select
                  value={eventForm.status}
                  onChange={(event) => setEventForm((current) => ({ ...current, status: event.target.value }))}
                  className="text-sm theme-input rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                >
                  {EVENT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveEvent()}
                className="primary-button text-sm px-4 py-2 rounded-lg pointer-coarse:min-h-11"
              >
                {editingEventId ? "Save Changes" : "Add Event"}
              </button>
              {editingEventId ? (
                <button
                  type="button"
                  onClick={resetEventForm}
                  className="inline-flex items-center pointer-coarse:min-h-11 text-sm text-[var(--ink-muted)] px-4 py-2 hover:text-[var(--ink-strong)]"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>

          {events.length === 0 ? (
            <div className="text-center text-[var(--ink-faint)] py-8 text-sm theme-card rounded-xl">
              No events scheduled yet.
            </div>
          ) : (
            <div className="space-y-2">
              {events.map((event) => (
                <div key={event.id} className="theme-card rounded-xl p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--ink-strong)]">{event.title}</p>
                    <p className="text-xs text-[var(--ink-muted)] mt-1">
                      {new Date(event.startsAt).toLocaleString()} to {new Date(event.endsAt).toLocaleTimeString()}
                    </p>
                    <p className="text-xs text-[var(--ink-muted)] mt-1">
                      {event.location || "No location"} • {event.registrationCount} registered
                    </p>
                    {event.description ? (
                      <p className="text-xs text-[var(--ink-muted)] mt-2">{event.description}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEditEvent(event)} className="inline-flex items-center pointer-coarse:min-h-11 text-xs text-[var(--badge-info-text)] hover:underline px-2 py-1">
                      Edit
                    </button>
                    <button onClick={() => void deleteEvent(event.id)} className="inline-flex items-center pointer-coarse:min-h-11 text-xs text-[var(--badge-error-text)] hover:underline px-2 py-1">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
