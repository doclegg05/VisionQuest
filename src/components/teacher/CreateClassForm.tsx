"use client";

import { useState } from "react";

import { CreateClassRegionSelect } from "@/components/admin/CreateClassRegionSelect";
import type { RegionOption } from "@/components/admin/region-pick";

/** What the Create a Class form holds while it is being filled in. */
export interface CreateClassValues {
  name: string;
  code: string;
  description: string;
  startDate: string;
  endDate: string;
  regionId: string;
  instructorIds: readonly string[];
}

type TextFieldName = Exclude<keyof CreateClassValues, "instructorIds">;

export interface CreateClassFormState {
  values: CreateClassValues;
  setField: (field: TextFieldName, value: string) => void;
  toggleInstructor: (instructorId: string) => void;
  reset: () => void;
}

const EMPTY_VALUES: CreateClassValues = {
  name: "",
  code: "",
  description: "",
  startDate: "",
  endDate: "",
  regionId: "",
  instructorIds: [],
};

function toggled(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id) ? ids.filter((current) => current !== id) : [...ids, id];
}

/**
 * The form's state. The page calls this, not the form: the page shows
 * "Loading classes..." in place of everything while its list reloads, and what
 * was typed here has to still be there when the form comes back.
 */
export function useCreateClassForm(): CreateClassFormState {
  const [values, setValues] = useState(EMPTY_VALUES);
  return {
    values,
    setField: (field, value) => setValues((current) => ({ ...current, [field]: value })),
    toggleInstructor: (instructorId) =>
      setValues((current) => ({ ...current, instructorIds: toggled(current.instructorIds, instructorId) })),
    reset: () => setValues(EMPTY_VALUES),
  };
}

/** The body of POST /api/teacher/classes for what the form holds. */
export function createClassBody(values: CreateClassValues) {
  return {
    name: values.name,
    code: values.code,
    description: values.description,
    startDate: values.startDate || null,
    endDate: values.endDate || null,
    instructorIds: values.instructorIds,
    regionId: values.regionId,
  };
}

export interface InstructorChoice {
  id: string;
  displayName: string;
}

export interface CreateClassFormProps {
  form: CreateClassFormState;
  /** The regions this person may put a class in. */
  regions: readonly RegionOption[];
  instructors: readonly InstructorChoice[];
  /** The admin page has the Regions card; an instructor's page does not. */
  onAdminPage: boolean;
  creating: boolean;
  onCreate: () => void;
}

const LABEL_TEXT = "block text-sm font-medium text-[var(--ink-strong)]";
const FIELD = "field px-4 py-3 text-sm";

interface TextFieldProps {
  label: string;
  type?: "date";
  value: string;
  onChange: (value: string) => void;
}

function TextField({ label, type, value, onChange }: TextFieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className={LABEL_TEXT}>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className={FIELD} />
    </label>
  );
}

interface AssignInstructorsProps {
  instructors: readonly InstructorChoice[];
  pickedIds: readonly string[];
  onToggle: (instructorId: string) => void;
}

function AssignInstructors({ instructors, pickedIds, onToggle }: AssignInstructorsProps) {
  return (
    <div className="rounded-2xl border border-[var(--border)] p-4">
      <p className="text-sm font-semibold text-[var(--ink-strong)]">Assign instructors</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {instructors.map((instructor) => (
          <label key={instructor.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--ink-strong)]">
            <input type="checkbox" checked={pickedIds.includes(instructor.id)} onChange={() => onToggle(instructor.id)} />
            <span>{instructor.displayName}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** The Create a Class card. The page holds its state (`useCreateClassForm`) and sends it. */
export function CreateClassForm({ form, regions, instructors, onAdminPage, creating, onCreate }: CreateClassFormProps) {
  const { values, setField } = form;
  return (
    <div className="surface-section space-y-4 p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Admin</p>
        <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Create a Class</h2>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">Classes organize students and instructors. Create student accounts from the class roster below.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Class name" value={values.name} onChange={(value) => setField("name", value)} />
        <TextField label="Class code" value={values.code} onChange={(value) => setField("code", value)} />
        <CreateClassRegionSelect regions={regions} value={values.regionId} onChange={(regionId) => setField("regionId", regionId)} onAdminPage={onAdminPage} />
        <TextField label="Start date" type="date" value={values.startDate} onChange={(value) => setField("startDate", value)} />
        <TextField label="End date" type="date" value={values.endDate} onChange={(value) => setField("endDate", value)} />
      </div>
      <label className="block space-y-1.5">
        <span className={LABEL_TEXT}>Description</span>
        <textarea
          value={values.description}
          onChange={(event) => setField("description", event.target.value)}
          rows={3}
          className={FIELD}
        />
      </label>
      <AssignInstructors instructors={instructors} pickedIds={values.instructorIds} onToggle={form.toggleInstructor} />
      <button
        type="button"
        onClick={onCreate}
        disabled={creating}
        className="primary-button px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {creating ? "Creating..." : "Create Class"}
      </button>
    </div>
  );
}
