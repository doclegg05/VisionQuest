"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { NoRegionsHint } from "@/components/admin/NoRegionsHint";
import { pickedRegionId } from "@/components/admin/region-pick";
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

export interface UnregionedClassItem {
  id: string;
  name: string;
  instructorCount: number;
  activeStudents: number;
}

interface RegionOption {
  id: string;
  name: string;
}

interface OrgPlacementPanelProps {
  unplacedStaff: readonly UnplacedStaffItem[];
  applicants: readonly WaitingApplicantItem[];
  unregionedClasses: readonly UnregionedClassItem[];
  regions: readonly RegionOption[];
  classes: readonly ClassOption[];
  /** Admins only. Everyone else sees the applicants list read-only. */
  canPlace: boolean;
}

interface RegionPickerProps {
  selectId: string;
  regions: readonly RegionOption[];
  regionId: string;
  onPick: (regionId: string) => void;
  pending: boolean;
  onPlace: () => void;
}

function RegionPicker({ selectId, regions, regionId, onPick, pending, onPlace }: RegionPickerProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-48 flex-1">
        <label htmlFor={selectId} className={LABEL_CLASS}>Region</label>
        <select id={selectId} value={regionId} onChange={(e) => onPick(e.target.value)} className={FIELD_CLASS}>
          {regions.map((region) => (
            <option key={region.id} value={region.id}>{region.name}</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={onPlace}
        disabled={pending || !regionId}
        className="primary-button min-h-11 px-6 py-3 text-sm disabled:opacity-50"
      >
        {pending ? "Placing…" : "Place in region"}
      </button>
    </div>
  );
}

function AssignRow({ person, regions }: { person: UnplacedStaffItem; regions: readonly RegionOption[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState("");
  // Read from the current list, so a region added on this page is offered at once.
  const regionId = pickedRegionId(regions, picked);
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
      {regions.length === 0 ? (
        <NoRegionsHint />
      ) : (
        <RegionPicker selectId={selectId} regions={regions} regionId={regionId} onPick={setPicked} pending={pending} onPlace={assign} />
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </li>
  );
}

export function OrgPlacementPanel({ unplacedStaff, applicants, unregionedClasses, regions, classes, canPlace }: OrgPlacementPanelProps) {
  const [placedIds, setPlacedIds] = useState<readonly string[]>([]);
  const waiting = applicants.filter((applicant) => !placedIds.includes(applicant.id));
  return (
    <section className="theme-card space-y-6 rounded-xl p-5">
      <div>
        <h2 className="text-sm font-semibold text-[var(--ink-strong)]">Staff Waiting for a Region</h2>
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
        <h2 className="text-sm font-semibold text-[var(--ink-strong)]">Classrooms with No Region</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          {canPlace
            ? "Regional coordinators cannot see these classrooms. To fix one, pick it under Class Roster on this page. Then pick a region and press Save Settings."
            : "Regional coordinators cannot see these classrooms. Each one needs a region. Ask an admin to set it."}
        </p>
        {unregionedClasses.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Every classroom has a region.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {unregionedClasses.map((item) => (
              <li key={item.id} className="py-3 text-sm text-[var(--ink-strong)]">
                <span className="font-semibold">{item.name}</span>
                <span className="ml-2 text-[var(--ink-muted)]">
                  {`${item.instructorCount} ${item.instructorCount === 1 ? "instructor" : "instructors"} · ${item.activeStudents} ${item.activeStudents === 1 ? "student" : "students"}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-[var(--ink-strong)]">Applicants Waiting for a Class</h2>
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
