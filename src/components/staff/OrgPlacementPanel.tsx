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

const HEADING = "text-sm font-semibold text-[var(--ink-strong)]";
const NOTE = "mt-1 text-sm text-[var(--ink-muted)]";
const EMPTY = "mt-2 text-sm text-[var(--ink-muted)]";
const LIST = "mt-2 divide-y divide-[var(--border)]";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function WaitingStaff({ people, regions }: { people: readonly UnplacedStaffItem[]; regions: readonly RegionOption[] }) {
  return (
    <div>
      <h2 className={HEADING}>Staff Waiting for a Region</h2>
      <p className={NOTE}>These instructors have no region and no class. They cannot see students until you place them.</p>
      {people.length === 0 ? (
        <p className={EMPTY}>Everyone is placed.</p>
      ) : (
        <ul className={LIST}>
          {people.map((person) => (
            <AssignRow key={person.id} person={person} regions={regions} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ClassesWithNoRegion({ items, canPlace }: { items: readonly UnregionedClassItem[]; canPlace: boolean }) {
  return (
    <div>
      <h2 className={HEADING}>Classes with No Region</h2>
      <p className={NOTE}>
        {canPlace
          ? "Regional coordinators can't see these classes. To fix one, go to Class Roster on this page. Choose the class under Select class. Choose a region, then press Save Settings."
          : "Regional coordinators can't see these classes. Each one needs a region. Ask an admin to set it."}
      </p>
      {items.length === 0 ? (
        <p className={EMPTY}>Every class has a region.</p>
      ) : (
        <ul className={LIST}>
          {items.map((item) => (
            <li key={item.id} className="py-3 text-sm text-[var(--ink-strong)]">
              <span className="font-semibold">{item.name}</span>
              <span className="ml-2 text-[var(--ink-muted)]">
                {`${plural(item.instructorCount, "instructor", "instructors")} · ${plural(item.activeStudents, "student", "students")}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface WaitingApplicantsProps {
  applicants: readonly WaitingApplicantItem[];
  classes: readonly ClassOption[];
  canPlace: boolean;
  onPlaced: (applicantId: string) => void;
}

function WaitingApplicants({ applicants, classes, canPlace, onPlaced }: WaitingApplicantsProps) {
  return (
    <div>
      <h2 className={HEADING}>Applicants Waiting for a Class</h2>
      <p className={NOTE}>
        {canPlace
          ? "These people signed up but are not in a class. Pick a class to place them."
          : "These people signed up but are not in a class. An admin places them."}
      </p>
      {applicants.length === 0 ? (
        <p className={EMPTY}>No one is waiting.</p>
      ) : (
        <ul className={LIST}>
          {applicants.map((applicant) => (
            <li key={applicant.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <p className="text-sm text-[var(--ink-strong)]">
                <span className="font-semibold">{applicant.displayName}</span>
                <span className="ml-2 text-[var(--ink-muted)]">
                  {applicant.county ?? "County not given"} · Joined {applicant.createdOn}
                </span>
              </p>
              {canPlace ? (
                <PlaceApplicantControl applicantId={applicant.id} classes={classes} onPlaced={() => onPlaced(applicant.id)} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OrgPlacementPanel({ unplacedStaff, applicants, unregionedClasses, regions, classes, canPlace }: OrgPlacementPanelProps) {
  const [placedIds, setPlacedIds] = useState<readonly string[]>([]);
  const waiting = applicants.filter((applicant) => !placedIds.includes(applicant.id));
  return (
    <section className="theme-card space-y-6 rounded-xl p-5">
      <WaitingStaff people={unplacedStaff} regions={regions} />
      <ClassesWithNoRegion items={unregionedClasses} canPlace={canPlace} />
      <WaitingApplicants
        applicants={waiting}
        classes={classes}
        canPlace={canPlace}
        onPlaced={(applicantId) => setPlacedIds((current) => [...current, applicantId])}
      />
    </section>
  );
}
