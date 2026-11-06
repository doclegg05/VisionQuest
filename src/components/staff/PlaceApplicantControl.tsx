"use client";

import { useRef, useState } from "react";

import { api } from "@/lib/api";
import { placeApplicantRequest } from "@/lib/org-placement-client";
import { FIELD_CLASS, LABEL_CLASS } from "./fieldStyles";

export interface ClassOption {
  id: string;
  name: string;
}

interface PlaceApplicantControlProps {
  applicantId: string;
  classes: readonly ClassOption[];
  onPlaced: () => void;
}

/** Admin-only control on an applicant row: pick an open class and move them in. */
export function PlaceApplicantControl({ applicantId, classes, onPlaced }: PlaceApplicantControlProps) {
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // A second tap can land before React re-renders with the disabled state.
  const inFlight = useRef(false);
  const selectId = `class-for-${applicantId}`;

  async function place() {
    if (inFlight.current || !classId) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const request = placeApplicantRequest(applicantId, classId);
      await api.post(request.url, request.body);
      onPlaced();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not place this person. Please try again.");
      inFlight.current = false;
      setPending(false);
    }
  }

  if (classes.length === 0) {
    return <p className="text-sm text-[var(--ink-muted)]">There is no open classroom yet.</p>;
  }

  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor={selectId} className={LABEL_CLASS}>Classroom</label>
          <select id={selectId} value={classId} onChange={(e) => setClassId(e.target.value)} className={FIELD_CLASS}>
            {classes.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={place}
          disabled={pending}
          className="primary-button min-h-11 px-6 py-3 text-sm disabled:opacity-50"
        >
          {pending ? "Placing…" : "Place in a classroom"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
