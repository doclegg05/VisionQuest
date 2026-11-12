"use client";

import { useRef, useState } from "react";

import { FIELD_CLASS, LABEL_CLASS } from "@/components/staff/fieldStyles";
import { focusAfterRemove } from "./focus-after-remove";
import { RegionNameField } from "./RegionNameField";
import { INVITE_HINTS, REGIONS_COPY, classCountLabel } from "./regions-copy";
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
  /** Resolves true once the coordinator is removed. */
  onRemove: (request: RemoveCoordinatorRequest) => Promise<boolean>;
}

interface RegionRowProps {
  region: AdminRegion;
  /** Every region, to tell whether a coordinator holds another one. */
  regions: readonly AdminRegion[];
  /** Everyone who can be offered as a coordinator. */
  people: readonly RegionPerson[];
  /** Any request is in flight, so nothing may be sent. */
  busy: boolean;
  /** This region's rename is in flight. */
  renameSaving: boolean;
  /** A failed rename, shown in the rename form. */
  renameError: string | null;
  /** Any other failed save on this row. */
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
  /** Every listed region, to warn about a name another one has. */
  regions: readonly AdminRegion[];
  busy: boolean;
  saving: boolean;
  /** A failed rename, shown under the input. */
  error: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export function RenameForm({ region, regions, busy, saving, error, onSave, onCancel }: RenameFormProps) {
  const [draft, setDraft] = useState(region.name);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
      className="flex flex-wrap items-start gap-3"
    >
      <RegionNameField
        id={`rename-${region.id}`}
        label={REGIONS_COPY.renameLabel}
        value={draft}
        onChange={setDraft}
        regions={regions}
        exceptId={region.id}
        error={error}
        autoFocus
      />
      <div className="flex flex-wrap gap-3 pt-6">
        <button type="submit" disabled={busy} className={SECONDARY_BUTTON}>
          {saving ? REGIONS_COPY.saving : REGIONS_COPY.saveName}
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>{REGIONS_COPY.cancel}</button>
      </div>
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

/** A sentence with a link to the Invite Staff card in the middle of it. */
function InviteHint({ before, link, after }: { before: string; link: string; after: string }) {
  return (
    <p className={MUTED_TEXT}>
      {before}
      <a href="#invite-staff" className="inline-flex items-center pointer-coarse:min-h-11 font-semibold text-[var(--ink-strong)] underline">{link}</a>
      {after}
    </p>
  );
}

function RegionCoordinators({ region, regions, people, busy, handlers }: Omit<RegionRowProps, "renameSaving" | "renameError" | "error">) {
  const choices = coordinatorChoices(people, region);
  const remove = async (person: RegionPerson) => {
    if (await handlers.onRemove({ region, person, onlyRegion: regionCountFor(regions, person.id) === 1 })) {
      focusAfterRemove(region.id);
    }
  };
  return (
    <div className="space-y-2">
      <p className={SUBHEADING}>{REGIONS_COPY.coordinatorsHeading}</p>
      <CoordinatorList region={region} busy={busy} onRemove={remove} />
      {choices.length === 0 ? (
        <InviteHint {...INVITE_HINTS.noChoices(region.name)} />
      ) : (
        <>
          <AddCoordinatorForm region={region} choices={choices} busy={busy} onAssign={(person) => handlers.onAssign(region, person)} />
          <InviteHint {...INVITE_HINTS.notInList} />
        </>
      )}
    </div>
  );
}

export function RegionRow({ region, regions, people, busy, renameSaving, renameError, error, handlers }: RegionRowProps) {
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
    // tabIndex -1: focus lands here after a removal when no select is shown.
    <li id={`region-${region.id}`} tabIndex={-1} className="space-y-3 py-4">
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
      {renaming && (
        <RenameForm
          region={region}
          regions={regions}
          busy={busy}
          saving={renameSaving}
          error={renameError}
          onSave={saveName}
          onCancel={closeRename}
        />
      )}
      <RegionCoordinators region={region} regions={regions} people={people} busy={busy} handlers={handlers} />
      {error && <p role="alert" className={ALERT_CLASS}>{error}</p>}
    </li>
  );
}
