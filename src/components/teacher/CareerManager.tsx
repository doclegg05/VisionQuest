"use client";

import { useEffect, useState } from "react";

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

export default function CareerManager() {
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
      console.error("Failed to load career data:", err);
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
    if (!confirm("Delete this opportunity?")) return;
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
    if (!confirm("Delete this event?")) return;
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

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error}</p>
        <button onClick={() => void loadData()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {[
          { key: "opportunities", label: "Opportunities" },
          { key: "events", label: "Events" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key as CareerTab)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === item.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
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
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              {editingOpportunityId ? "Edit Opportunity" : "New Opportunity"}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="text"
                placeholder="Title"
                value={opportunityForm.title}
                onChange={(event) => setOpportunityForm((current) => ({ ...current, title: event.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Company"
                value={opportunityForm.company}
                onChange={(event) => setOpportunityForm((current) => ({ ...current, company: event.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <select
                value={opportunityForm.type}
                onChange={(event) => setOpportunityForm((current) => ({ ...current, type: event.target.value }))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {OPPORTUNITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Location"
                value={opportunityForm.location}
                onChange={(event) => setOpportunityForm((current) => ({ ...current, location: event.target.value }))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="datetime-local"
                value={opportunityForm.deadline}
                onChange={(event) => setOpportunityForm((current) => ({ ...current, deadline: event.target.value }))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <input
              type="url"
              placeholder="External link"
              value={opportunityForm.url}
              onChange={(event) => setOpportunityForm((current) => ({ ...current, url: event.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              placeholder="Description"
              value={opportunityForm.description}
              onChange={(event) => setOpportunityForm((current) => ({ ...current, description: event.target.value }))}
              rows={4}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {editingOpportunityId ? (
              <select
                value={opportunityForm.status}
                onChange={(event) => setOpportunityForm((current) => ({ ...current, status: event.target.value }))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {APPLICATION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveOpportunity()}
                className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                {editingOpportunityId ? "Save Changes" : "Add Opportunity"}
              </button>
              {editingOpportunityId ? (
                <button
                  type="button"
                  onClick={resetOpportunityForm}
                  className="text-sm text-gray-500 px-4 py-2 hover:text-gray-700"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>

          {opportunities.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm bg-white rounded-xl border border-gray-200">
              No opportunities posted yet.
            </div>
          ) : (
            <div className="space-y-2">
              {opportunities.map((opportunity) => (
                <div key={opportunity.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{opportunity.title}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {opportunity.company} • {opportunity.type}
                      {opportunity.location ? ` • ${opportunity.location}` : ""}
                    </p>
                    {opportunity.description ? (
                      <p className="text-xs text-gray-500 mt-2">{opportunity.description}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">{opportunity.status}</span>
                      {opportunity.deadline ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
                          Deadline {new Date(opportunity.deadline).toLocaleDateString()}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => startEditOpportunity(opportunity)} className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1">
                      Edit
                    </button>
                    <button onClick={() => void deleteOpportunity(opportunity.id)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">
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
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              {editingEventId ? "Edit Event" : "New Event"}
            </h3>
            <input
              type="text"
              placeholder="Title"
              value={eventForm.title}
              onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              placeholder="Description"
              value={eventForm.description}
              onChange={(event) => setEventForm((current) => ({ ...current, description: event.target.value }))}
              rows={4}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="datetime-local"
                value={eventForm.startsAt}
                onChange={(event) => setEventForm((current) => ({ ...current, startsAt: event.target.value }))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="datetime-local"
                value={eventForm.endsAt}
                onChange={(event) => setEventForm((current) => ({ ...current, endsAt: event.target.value }))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <input
                type="text"
                placeholder="Location"
                value={eventForm.location}
                onChange={(event) => setEventForm((current) => ({ ...current, location: event.target.value }))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="url"
                placeholder="Virtual URL"
                value={eventForm.virtualUrl}
                onChange={(event) => setEventForm((current) => ({ ...current, virtualUrl: event.target.value }))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                min="1"
                placeholder="Capacity"
                value={eventForm.capacity}
                onChange={(event) => setEventForm((current) => ({ ...current, capacity: event.target.value }))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={eventForm.registrationRequired}
                onChange={(event) => setEventForm((current) => ({ ...current, registrationRequired: event.target.checked }))}
              />
              Students should RSVP for this event
            </label>
            {editingEventId ? (
              <select
                value={eventForm.status}
                onChange={(event) => setEventForm((current) => ({ ...current, status: event.target.value }))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {EVENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveEvent()}
                className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                {editingEventId ? "Save Changes" : "Add Event"}
              </button>
              {editingEventId ? (
                <button
                  type="button"
                  onClick={resetEventForm}
                  className="text-sm text-gray-500 px-4 py-2 hover:text-gray-700"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>

          {events.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm bg-white rounded-xl border border-gray-200">
              No events scheduled yet.
            </div>
          ) : (
            <div className="space-y-2">
              {events.map((event) => (
                <div key={event.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{event.title}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(event.startsAt).toLocaleString()} to {new Date(event.endsAt).toLocaleTimeString()}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {event.location || "No location"} • {event.registrationCount} registered
                    </p>
                    {event.description ? (
                      <p className="text-xs text-gray-500 mt-2">{event.description}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => startEditEvent(event)} className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1">
                      Edit
                    </button>
                    <button onClick={() => void deleteEvent(event.id)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">
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
