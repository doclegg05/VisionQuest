"use client";

import { useState } from "react";

import {
  JOB_LEAD_SOURCES,
  LEAD_PAY_PERIODS,
  SHIFT_LABELS,
  type LeadPayPeriod,
} from "@/lib/connect/leads-shared";
import { LEAD_SHIFTS } from "@/lib/connect/work-profile-shared";

/**
 * Add a lead: by hand, as a MACC job order, or from a job already on a class
 * board.
 *
 * The only modules this imports are the two Prisma-FREE shared ones. A client
 * component that reaches `@/lib/connect/leads` would pull the Prisma client
 * (and node:async_hooks) into the browser bundle and fail `next build` — the
 * exact break Phase 2 hit.
 *
 * Mobile-first: one field per row at 375px, every control at least 44px tall,
 * and the shift picker is checkboxes rather than a multi-select, which is
 * unusable on a phone.
 */

/** The three ways a lead gets entered. "listing" posts to a different route. */
const MODES = [
  { value: "manual", label: "Type it in" },
  { value: "joborder", label: "From a MACC job order" },
  { value: "listing", label: "From a job on a class board" },
] as const;

type Mode = (typeof MODES)[number]["value"];

export interface AddLeadFormProps {
  employers: Array<{ id: string; name: string }>;
  classes: Array<{ id: string; name: string }>;
}

const inputClass =
  "mt-1 min-h-[44px] w-full rounded-lg border border-[var(--border)] bg-[var(--surface-base)] px-3 py-2 text-sm text-[var(--ink-strong)]";

export function AddLeadForm({ employers, classes }: AddLeadFormProps) {
  const [mode, setMode] = useState<Mode>("manual");
  const [shifts, setShifts] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function toggleShift(shift: string) {
    setShifts((current) =>
      current.includes(shift) ? current.filter((value) => value !== shift) : [...current, shift],
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const classId = String(form.get("classId") ?? "");

    try {
      const response =
        mode === "listing"
          ? await fetch("/api/teacher/connect/leads/from-listing", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jobListingId: String(form.get("jobListingId") ?? ""),
                classId: classId || null,
              }),
            })
          : await fetch("/api/teacher/connect/leads", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                employerId: String(form.get("employerId") ?? ""),
                title: String(form.get("title") ?? ""),
                location: String(form.get("location") ?? ""),
                description: String(form.get("description") ?? "") || null,
                classId: classId || null,
                source: mode,
                schedule: { shifts },
                payMin: form.get("payMin") ? Number(form.get("payMin")) : null,
                payMax: form.get("payMax") ? Number(form.get("payMax")) : null,
                payPeriod: (form.get("payPeriod") as LeadPayPeriod) || "hour",
                transitNotes: String(form.get("transitNotes") ?? "") || null,
              }),
            });

      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "That did not save. Check the form and try again.");
        return;
      }
      setMessage(body.created === false ? "That job was already a lead." : "Lead added.");
    } catch {
      setMessage("That did not save. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="add-lead-heading" className="theme-card rounded-xl p-5">
      <h2 id="add-lead-heading" className="text-base font-semibold text-[var(--ink-strong)]">
        Add a lead
      </h2>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-[var(--ink-strong)]">Where is it from?</legend>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {MODES.map((option) => (
              <label
                key={option.value}
                className="flex min-h-[44px] items-center gap-2 text-sm text-[var(--ink-muted)]"
              >
                <input
                  type="radio"
                  name="mode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                  className="h-5 w-5"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        {mode === "listing" ? (
          <label className="block text-sm font-medium text-[var(--ink-strong)]">
            Job posting ID
            <input name="jobListingId" required className={inputClass} />
            <span className="mt-1 block text-sm font-normal text-[var(--ink-muted)]">
              Copy it from the job on the class board.
            </span>
          </label>
        ) : (
          <>
            <label className="block text-sm font-medium text-[var(--ink-strong)]">
              Employer
              <select name="employerId" required className={inputClass}>
                <option value="">Pick an employer</option>
                {employers.map((employer) => (
                  <option key={employer.id} value={employer.id}>
                    {employer.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-[var(--ink-strong)]">
              Job title
              <input name="title" required maxLength={160} className={inputClass} />
            </label>

            <label className="block text-sm font-medium text-[var(--ink-strong)]">
              Where the job is
              <input name="location" required maxLength={160} className={inputClass} />
            </label>

            <fieldset>
              <legend className="text-sm font-medium text-[var(--ink-strong)]">Shifts</legend>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {LEAD_SHIFTS.map((shift) => (
                  <label
                    key={shift}
                    className="flex min-h-[44px] items-center gap-2 text-sm text-[var(--ink-muted)]"
                  >
                    <input
                      type="checkbox"
                      checked={shifts.includes(shift)}
                      onChange={() => toggleShift(shift)}
                      className="h-5 w-5"
                    />
                    {SHIFT_LABELS[shift]}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Leave these blank if you do not know the shift yet. No shift means no student is
                left out for their hours.
              </p>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm font-medium text-[var(--ink-strong)]">
                Pay from
                <input name="payMin" type="number" min={0} step="0.01" className={inputClass} />
              </label>
              <label className="block text-sm font-medium text-[var(--ink-strong)]">
                Pay to
                <input name="payMax" type="number" min={0} step="0.01" className={inputClass} />
              </label>
              <label className="block text-sm font-medium text-[var(--ink-strong)]">
                Per
                <select name="payPeriod" defaultValue="hour" className={inputClass}>
                  {LEAD_PAY_PERIODS.map((period) => (
                    <option key={period} value={period}>
                      {period}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block text-sm font-medium text-[var(--ink-strong)]">
              How to get there by bus
              <input name="transitNotes" maxLength={500} className={inputClass} />
              <span className="mt-1 block text-sm font-normal text-[var(--ink-muted)]">
                Name the route if there is one. It keeps students with no car in the list.
              </span>
            </label>

            <label className="block text-sm font-medium text-[var(--ink-strong)]">
              What the job is
              <textarea name="description" rows={3} maxLength={5000} className={inputClass} />
            </label>
          </>
        )}

        <label className="block text-sm font-medium text-[var(--ink-strong)]">
          Which class can see it
          <select name="classId" defaultValue="" className={inputClass}>
            <option value="">All classes</option>
            {classes.map((spokesClass) => (
              <option key={spokesClass.id} value={spokesClass.id}>
                {spokesClass.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="min-h-[44px] w-full rounded-lg bg-[var(--accent-green)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
        >
          {pending ? "Saving..." : "Add lead"}
        </button>

        {message && (
          <p role="status" className="text-sm text-[var(--ink-strong)]">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}

/** Exported for the test that pins the form's modes to the lead vocabulary. */
export const ADD_LEAD_MODES = MODES;
export const LEAD_SOURCE_VOCABULARY = JOB_LEAD_SOURCES;
