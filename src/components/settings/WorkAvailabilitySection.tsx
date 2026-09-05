"use client";

import { useEffect, useState } from "react";

import {
  AVAILABILITY_DAYS,
  AVAILABILITY_SLOTS,
  emptyAvailability,
  TRANSPORT_MODES,
  type AvailabilityDay,
  type AvailabilityGrid,
  type AvailabilitySlot,
  type TransportMode,
  type WorkProfile,
} from "@/lib/connect/work-profile-shared";

/**
 * The student's own "Work availability" form — the fallback for Sage's
 * five-question intake (Match & Connect Task 2.2), for students who would
 * rather tap than chat. Same Zod schema on the server either way.
 *
 * Copy is written at a 6th-grade reading level: short sentences, plain words,
 * no program jargon. Every control is a real label + input so a screen reader
 * reads the question, and the day/time toggles are full-width buttons rather
 * than 12px checkboxes.
 */

const DAY_LABELS: Record<AvailabilityDay, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const DAY_SHORT: Record<AvailabilityDay, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const SLOT_LABELS: Record<AvailabilitySlot, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  overnight: "Overnight",
};

const TRANSPORT_LABELS: Record<TransportMode, string> = {
  car: "I drive myself",
  ride: "Someone drives me",
  bus: "I take the bus",
  walk: "I walk",
  none: "I do not have a ride yet",
};

export function WorkAvailabilitySection() {
  const [availability, setAvailability] = useState<AvailabilityGrid>(emptyAvailability());
  const [transport, setTransport] = useState<TransportMode | "">("");
  const [payFloor, setPayFloor] = useState("");
  const [earliestStart, setEarliestStart] = useState("");
  const [childcareNote, setChildcareNote] = useState("");
  const [homeZip, setHomeZip] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/work-profile");
        if (!res.ok) return;
        const data = (await res.json()) as { workProfile: WorkProfile | null };
        const profile = data.workProfile;
        if (!profile) return;
        setAvailability(profile.availability);
        setTransport(profile.transport ?? "");
        setPayFloor(profile.payFloorHourly !== null ? String(profile.payFloorHourly) : "");
        setEarliestStart(profile.earliestStart ?? "");
        setChildcareNote(profile.childcareHours?.note ?? "");
        setHomeZip(profile.homeZip ?? "");
      } catch {
        // A failed load leaves the blank form; saving still works.
      }
    }
    void load();
  }, []);

  function toggleCell(day: AvailabilityDay, slot: AvailabilitySlot) {
    setAvailability((current) => ({
      ...current,
      [day]: { ...current[day], [slot]: !current[day][slot] },
    }));
  }

  async function handleSave() {
    setStatus("saving");
    setErrorMsg("");

    const payFloorNumber = payFloor.trim() === "" ? null : Number(payFloor);
    if (payFloorNumber !== null && !Number.isFinite(payFloorNumber)) {
      setStatus("error");
      setErrorMsg("Enter the pay as a number, like 15.");
      return;
    }

    try {
      const res = await fetch("/api/work-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          availability,
          transport: transport === "" ? null : transport,
          payFloorHourly: payFloorNumber,
          earliestStart: earliestStart.trim() === "" ? null : earliestStart,
          childcareHours:
            childcareNote.trim() === "" ? null : { note: childcareNote.trim() },
          homeZip: homeZip.trim() === "" ? null : homeZip.trim(),
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus("error");
        setErrorMsg(data.error || "We could not save your answers.");
        return;
      }

      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
      setErrorMsg("We could not reach the server. Please try again.");
    }
  }

  return (
    <div className="surface-section mb-6 p-6">
      <div className="mb-4">
        <p className="page-eyebrow text-[var(--ink-muted)]">Jobs</p>
        <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">Work availability</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
          Tell us when you can work and how you get there. Your teacher can see
          this. We use it to find jobs that fit your life. You can change it any
          time.
        </p>
      </div>

      <fieldset className="mb-6">
        <legend className="mb-2 text-sm font-medium text-[var(--ink-strong)]">
          Days and times you can work
        </legend>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="p-1 text-left text-xs text-[var(--ink-muted)]">
                  Day
                </th>
                {AVAILABILITY_SLOTS.map((slot) => (
                  <th
                    key={slot}
                    scope="col"
                    className="p-1 text-center text-xs text-[var(--ink-muted)]"
                  >
                    {SLOT_LABELS[slot]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AVAILABILITY_DAYS.map((day) => (
                <tr key={day}>
                  <th scope="row" className="p-1 text-left font-normal text-[var(--ink-strong)]">
                    <span aria-hidden="true">{DAY_SHORT[day]}</span>
                    <span className="sr-only">{DAY_LABELS[day]}</span>
                  </th>
                  {AVAILABILITY_SLOTS.map((slot) => {
                    const on = availability[day][slot];
                    return (
                      <td key={slot} className="p-1">
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleCell(day, slot)}
                          className={`min-h-11 w-full rounded-lg border px-2 py-2 text-xs ${
                            on
                              ? "border-[var(--accent-strong)] bg-[var(--accent-soft)] font-semibold text-[var(--ink-strong)]"
                              : "border-[var(--border)] text-[var(--ink-muted)]"
                          }`}
                        >
                          <span className="sr-only">
                            {DAY_LABELS[day]} {SLOT_LABELS[slot]}
                          </span>
                          <span aria-hidden="true">{on ? "Yes" : "—"}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>

      <fieldset className="mb-6">
        <legend className="mb-2 text-sm font-medium text-[var(--ink-strong)]">
          How do you get to work?
        </legend>
        <div className="flex flex-col gap-2">
          {TRANSPORT_MODES.map((mode) => (
            <label
              key={mode}
              className="flex min-h-11 items-center gap-3 text-sm text-[var(--ink-strong)]"
            >
              <input
                type="radio"
                name="work-transport"
                value={mode}
                checked={transport === mode}
                onChange={() => setTransport(mode)}
                className="h-5 w-5"
              />
              {TRANSPORT_LABELS[mode]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="work-pay-floor"
            className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]"
          >
            Lowest pay you can take, per hour
          </label>
          <input
            id="work-pay-floor"
            type="number"
            min={0}
            step="0.25"
            inputMode="decimal"
            placeholder="15"
            value={payFloor}
            onChange={(e) => setPayFloor(e.target.value)}
            className="field w-full px-4 py-3 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="work-earliest-start"
            className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]"
          >
            Soonest you can start
          </label>
          <input
            id="work-earliest-start"
            type="date"
            value={earliestStart}
            onChange={(e) => setEarliestStart(e.target.value)}
            className="field w-full px-4 py-3 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="work-home-zip"
            className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]"
          >
            Your ZIP code
          </label>
          <input
            id="work-home-zip"
            type="text"
            inputMode="numeric"
            maxLength={5}
            placeholder="25301"
            value={homeZip}
            onChange={(e) => setHomeZip(e.target.value)}
            className="field w-full px-4 py-3 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="work-childcare"
            className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]"
          >
            Anything about your kids&apos; hours?
          </label>
          <textarea
            id="work-childcare"
            rows={2}
            maxLength={500}
            placeholder="Kids are at school 8 to 3."
            value={childcareNote}
            onChange={(e) => setChildcareNote(e.target.value)}
            className="field w-full px-4 py-3 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={status === "saving"}
          className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "saving" ? "Saving..." : "Save"}
        </button>
        {status === "success" && <p className="text-sm text-[var(--success)]">Saved.</p>}
        {status === "error" && <p className="text-sm text-[var(--error)]">{errorMsg}</p>}
      </div>
    </div>
  );
}
