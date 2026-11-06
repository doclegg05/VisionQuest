"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api";
import { FIELD_CLASS, LABEL_CLASS } from "./fieldStyles";
import { PlaceApplicantControl, type ClassOption } from "./PlaceApplicantControl";

export interface UnplacedStaffItem {
  id: string;
  displayName: string;
  createdOn: string;
}

export interface WaitingApplicantItem {
  id: string;
  displayName: string;
  county: string | null;
  createdOn: string;
}

interface RegionOption {
  id: string;
  name: string;
}

interface OrgPlacementPanelProps {
  unplacedStaff: readonly UnplacedStaffItem[];
  applicants: readonly WaitingApplicantItem[];
  regions: readonly RegionOption[];
  classes: readonly ClassOption[];
  /** Admins only. Everyone else sees the applicants list read-only. */
  canPlace: boolean;
}

function AssignRow({ person, regions }: { person: UnplacedStaffItem; regions: readonly RegionOption[] }) {
  const router = useRouter();
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const selectId = `region-for-${person.id}`;

  async function assign() {
    if (pending || !regionId) return;
    setPending(true);
    setError("");
    try {
      await api.post("/api/admin/org-placement/region-instructors", {
        instructorId: person.id,
        regionId,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not place this person. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="space-y-2 py-3">
      <p className="text-sm font-semibold text-[var(--ink-strong)]">
        {person.displayName}
        <span className="ml-2 font-normal text-[var(--ink-muted)]">Joined {person.createdOn}</span>
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor={selectId} className={LABEL_CLASS}>Region</label>
          <select id={selectId} value={regionId} onChange={(e) => setRegionId(e.target.value)} className={FIELD_CLASS}>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>{region.name}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={assign}
          disabled={pending || !regionId}
          className="primary-button min-h-11 px-6 py-3 text-sm disabled:opacity-50"
        >
          {pending ? "Placing…" : "Place in region"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </li>
  );
}

export function OrgPlacementPanel({ unplacedStaff, applicants, regions, classes, canPlace }: OrgPlacementPanelProps) {
  const [placedIds, setPlacedIds] = useState<readonly string[]>([]);
  const waiting = applicants.filter((applicant) => !placedIds.includes(applicant.id));
  return (
    <section className="theme-card space-y-6 rounded-xl p-5">
      <div>
        <h2 className="text-sm font-semibold text-[var(--ink-strong)]">Staff waiting for a region</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          These instructors have no region and no class. They cannot see students until you place them.
        </p>
        {unplacedStaff.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Everyone is placed.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {unplacedStaff.map((person) => (
              <AssignRow key={person.id} person={person} regions={regions} />
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-[var(--ink-strong)]">Applicants waiting for a class</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          {canPlace
            ? "These people signed up but are not in a class. Pick a classroom to place them."
            : "These people signed up but are not in a class. An admin places them."}
        </p>
        {waiting.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">No one is waiting.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {waiting.map((applicant) => (
              <li key={applicant.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <p className="text-sm text-[var(--ink-strong)]">
                  <span className="font-semibold">{applicant.displayName}</span>
                  <span className="ml-2 text-[var(--ink-muted)]">
                    {applicant.county ?? "County not given"} · Joined {applicant.createdOn}
                  </span>
                </p>
                {canPlace ? (
                  <PlaceApplicantControl
                    applicantId={applicant.id}
                    classes={classes}
                    onPlaced={() => setPlacedIds((current) => [...current, applicant.id])}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
