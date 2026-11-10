"use client";

import { useRef, useState } from "react";

import { FIELD_CLASS, LABEL_CLASS } from "@/components/staff/fieldStyles";
import { REGIONS_COPY, classCountLabel } from "./regions-copy";
import { coordinatorChoices, regionCountFor, type AdminRegion, type RegionPerson } from "./regions-model";
import { ALERT_CLASS, MUTED_TEXT, SECONDARY_BUTTON, SUBHEADING } from "./regionStyles";

export interface RemoveCoordinatorRequest {
  region: AdminRegion;
  person: RegionPerson;
  /** The person holds no other active region, so they will see none after this. */
  onlyRegion: boolean;
}

export interface RegionRowHandlers {
  onRename: (region: AdminRegion, name: string) => Promise<boolean>;
  onAssign: (region: AdminRegion, person: RegionPerson) => Promise<boolean>;
  onRemove: (request: RemoveCoordinatorRequest) => void;
}

interface RegionRowProps {
  region: AdminRegion;
  /** Every region, to tell whether a coordinator holds another one. */
  regions: readonly AdminRegion[];
  /** Everyone who can be offered as a coordinator. */
  people: readonly RegionPerson[];
  /** Any request is in flight, so nothing may be sent. */
  busy: boolean;
  /** This row's own request is in flight. */
  saving: boolean;
  error: string | null;
  handlers: RegionRowHandlers;
}

function RegionTitle({ region }: { region: AdminRegion }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="break-words text-base font-semibold text-[var(--ink-strong)]">{region.name}</p>
      <p className={MUTED_TEXT}>{classCountLabel(region.classCount)}</p>
    </div>
  );
}

interface RenameFormProps {
  region: AdminRegion;
  busy: boolean;
  saving: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}

function RenameForm({ region, busy, saving, onSave, onCancel }: RenameFormProps) {
  const [draft, setDraft] = useState(region.name);
  const inputId = `rename-${region.id}`;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-48 flex-1">
        <label htmlFor={inputId} className={LABEL_CLASS}>{REGIONS_COPY.renameLabel}</label>
        <input
          id={inputId}
          required
          autoFocus
          maxLength={200}
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={FIELD_CLASS}
        />
      </div>
      <button type="submit" disabled={busy} className={SECONDARY_BUTTON}>
        {saving ? REGIONS_COPY.saving : REGIONS_COPY.saveName}
      </button>
      <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>{REGIONS_COPY.cancel}</button>
    </form>
  );
}

interface CoordinatorListProps {
  region: AdminRegion;
  busy: boolean;
  onRemove: (person: RegionPerson) => void;
}

function CoordinatorList({ region, busy, onRemove }: CoordinatorListProps) {
  if (region.coordinators.length === 0) return <p className={MUTED_TEXT}>{REGIONS_COPY.noCoordinators}</p>;
  return (
    <ul className="space-y-2">
      {region.coordinators.map((person) => (
        <li key={person.id} className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 break-words text-sm text-[var(--ink-strong)]">
            {person.displayName}
            {person.email && <span className="ml-2 text-[var(--ink-muted)]">{person.email}</span>}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(person)}
            aria-label={`${REGIONS_COPY.remove} ${person.displayName} from ${region.name}`}
            className={SECONDARY_BUTTON}
          >
            {REGIONS_COPY.remove}
          </button>
        </li>
      ))}
    </ul>
  );
}

interface AddCoordinatorFormProps {
  region: AdminRegion;
  choices: readonly RegionPerson[];
  busy: boolean;
  onAssign: (person: RegionPerson) => Promise<boolean>;
}

function AddCoordinatorForm({ region, choices, busy, onAssign }: AddCoordinatorFormProps) {
  const [pickedId, setPickedId] = useState("");
  // A person who was just added drops off the list, so a stale pick reads as none.
  const picked = choices.find((person) => person.id === pickedId);
  const selectId = `add-coordinator-${region.id}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (picked && (await onAssign(picked))) setPickedId("");
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-48 flex-1">
        <label htmlFor={selectId} className={LABEL_CLASS}>{REGIONS_COPY.addCoordinatorLabel}</label>
        <select
          id={selectId}
          required
          value={picked?.id ?? ""}
          onChange={(event) => setPickedId(event.target.value)}
          className={FIELD_CLASS}
        >
          <option value="">{REGIONS_COPY.pickCoordinator}</option>
          {choices.map((person) => (
            <option key={person.id} value={person.id}>
              {person.email ? `${person.displayName} (${person.email})` : person.displayName}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={busy} className={SECONDARY_BUTTON}>{REGIONS_COPY.addCoordinator}</button>
    </form>
  );
}

function RegionCoordinators({ region, regions, people, busy, handlers }: Omit<RegionRowProps, "saving" | "error">) {
  const choices = coordinatorChoices(people, region);
  const remove = (person: RegionPerson) =>
    handlers.onRemove({ region, person, onlyRegion: regionCountFor(regions, person.id) === 1 });
  return (
    <div className="space-y-2">
      <p className={SUBHEADING}>{REGIONS_COPY.coordinatorsHeading}</p>
      <CoordinatorList region={region} busy={busy} onRemove={remove} />
      {choices.length === 0 ? (
        <p className={MUTED_TEXT}>{REGIONS_COPY.noCoordinatorChoices}</p>
      ) : (
        <AddCoordinatorForm region={region} choices={choices} busy={busy} onAssign={(person) => handlers.onAssign(region, person)} />
      )}
    </div>
  );
}

export function RegionRow({ region, regions, people, busy, saving, error, handlers }: RegionRowProps) {
  const [renaming, setRenaming] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);

  // Closing the form removes the focused field, so focus goes back to the button that opened it.
  function closeRename() {
    setRenaming(false);
    renameButton.current?.focus();
  }

  async function saveName(name: string) {
    if (await handlers.onRename(region, name)) closeRename();
  }

  return (
    <li id={`region-${region.id}`} className="space-y-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RegionTitle region={region} />
        <button
          ref={renameButton}
          type="button"
          aria-expanded={renaming}
          disabled={busy}
          onClick={() => setRenaming((open) => !open)}
          className={SECONDARY_BUTTON}
        >
          {REGIONS_COPY.rename}
        </button>
      </div>
      {renaming && <RenameForm region={region} busy={busy} saving={saving} onSave={saveName} onCancel={closeRename} />}
      <RegionCoordinators region={region} regions={regions} people={people} busy={busy} handlers={handlers} />
      {error && <p role="alert" className={ALERT_CLASS}>{error}</p>}
    </li>
  );
}
