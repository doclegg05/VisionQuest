"use client";

import { useEffect, useState } from "react";

import { api, apiFetch } from "@/lib/api";
import { FIELD_TYPES, type FieldDef, type FieldType } from "@/lib/forms/schema";

interface FormBuilderProps {
  mode: "new" | "edit";
  templateId?: string;
  onClose: () => void;
  onSaved: () => void;
}

interface TemplateDetail {
  id: string;
  title: string;
  description: string | null;
  programTypes: string[];
  schema: unknown;
  isOfficial: boolean;
  status: "active" | "archived";
}

interface TemplateDetailResponse {
  template: TemplateDetail;
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Short text",
  longText: "Long text",
  number: "Number",
  date: "Date",
  select: "Single choice",
  multiselect: "Multiple choice",
  checkbox: "Checkbox",
  attachment: "File attachment",
};

function newField(index: number): FieldDef {
  return {
    key: `field_${index + 1}`,
    label: `Field ${index + 1}`,
    type: "text",
    required: false,
  };
}

function normalizeKey(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "field";
}

export default function FormBuilder({ mode, templateId, onClose, onSaved }: FormBuilderProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isOfficial, setIsOfficial] = useState(false);
  const [programTypes, setProgramTypes] = useState<string[]>([]);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "edit" || !templateId) return;
    (async () => {
      try {
        const data = await api.get<TemplateDetailResponse>(`/api/teacher/forms/templates/${templateId}`);
        setTitle(data.template.title);
        setDescription(data.template.description ?? "");
        setIsOfficial(data.template.isOfficial);
        setProgramTypes(data.template.programTypes);
        setFields(Array.isArray(data.template.schema) ? (data.template.schema as FieldDef[]) : []);
      } catch {
        setError("Failed to load template.");
      } finally {
        setLoading(false);
      }
    })();
  }, [mode, templateId]);

  function updateField(index: number, patch: Partial<FieldDef>) {
    setFields((current) =>
      current.map((field, i) =>
        i === index ? ({ ...field, ...patch } as FieldDef) : field,
      ),
    );
  }

  function addField() {
    setFields((current) => [...current, newField(current.length)]);
  }

  function removeField(index: number) {
    setFields((current) => current.filter((_, i) => i !== index));
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        isOfficial,
        programTypes,
        schema: fields,
      };
      const endpoint =
        mode === "edit" && templateId
          ? `/api/teacher/forms/templates/${templateId}`
          : `/api/teacher/forms/templates`;
      const res = await apiFetch(endpoint, {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Save failed");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--surface-raised)] p-6 shadow-xl space-y-5"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-[var(--ink-strong)]">
              {mode === "edit" ? "Edit form" : "New form"}
            </h2>
            <p className="text-sm text-[var(--ink-muted)]">
              Define the title, program scope, and fields. Students will see exactly what you build here.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close form builder"
            className="rounded-lg p-2 text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
          >
            ✕
          </button>
        </header>

        {loading ? (
          <p className="text-sm text-[var(--ink-muted)]">Loading template…</p>
        ) : (
          <div className="space-y-5">
            {error && (
              <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--error)]" role="alert">
                {error}
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. SPOKES Intake"
                  className="field w-full px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Description (optional)</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={2}
                  className="field w-full px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Programs</span>
                <div className="flex flex-wrap gap-3 py-1">
                  {(["spokes", "adult_ed", "ietp"] as const).map((value) => (
                    <label key={value} className="inline-flex items-center gap-1.5 text-sm text-[var(--ink-strong)]">
                      <input
                        type="checkbox"
                        checked={programTypes.includes(value)}
                        onChange={(event) =>
                          setProgramTypes((current) =>
                            event.target.checked
                              ? [...current, value]
                              : current.filter((entry) => entry !== value),
                          )
                        }
                      />
                      {value}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-[var(--ink-faint)]">Leave empty to show to all programs.</p>
              </label>
              <label className="inline-flex items-center gap-2 self-end text-sm text-[var(--ink-strong)]">
                <input
                  type="checkbox"
                  checked={isOfficial}
                  onChange={(event) => setIsOfficial(event.target.checked)}
                />
                Mark as official (included in coordinator exports by default)
              </label>
            </div>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-[var(--ink-strong)]">Fields</h3>
                <button
                  type="button"
                  onClick={addField}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
                >
                  Add field
                </button>
              </div>

              {fields.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                  No fields yet. Add one to get started.
                </p>
              ) : (
                <ol className="space-y-3">
                  {fields.map((field, index) => (
                    <FieldEditor
                      key={`${index}-${field.key}`}
                      field={field}
                      index={index}
                      total={fields.length}
                      onChange={(patch) => updateField(index, patch)}
                      onRemove={() => removeField(index)}
                      onMove={(direction) => moveField(index, direction)}
                    />
                  ))}
                </ol>
              )}
            </section>

            <footer className="flex items-center justify-end gap-3 border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !title.trim() || fields.length === 0}
                className="primary-button px-5 py-2 text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save form"}
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}

interface FieldEditorProps {
  field: FieldDef;
  index: number;
  total: number;
  onChange: (patch: Partial<FieldDef>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

function FieldEditor({ field, index, total, onChange, onRemove, onMove }: FieldEditorProps) {
  const hasOptions = field.type === "select" || field.type === "multiselect";

  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <span className="font-semibold">#{index + 1}</span>
          <span>{FIELD_TYPE_LABELS[field.type]}</span>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move up"
            className="rounded-lg border border-[var(--border)] px-2 py-1 disabled:opacity-40"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="Move down"
            className="rounded-lg border border-[var(--border)] px-2 py-1 disabled:opacity-40"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove field"
            className="rounded-lg border border-[var(--border)] px-2 py-1 text-[var(--error)]"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Label</span>
          <input
            type="text"
            value={field.label}
            onChange={(event) => onChange({ label: event.target.value })}
            className="field w-full px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Key</span>
          <input
            type="text"
            value={field.key}
            onChange={(event) => onChange({ key: normalizeKey(event.target.value) })}
            className="field w-full px-3 py-2 text-sm font-mono"
          />
          <p className="text-xs text-[var(--ink-faint)]">Used as the CSV column header. Change carefully — existing responses reference the old key.</p>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Type</span>
          <select
            value={field.type}
            onChange={(event) => {
              const nextType = event.target.value as FieldType;
              const base = { key: field.key, label: field.label, required: field.required } as const;
              const next: FieldDef =
                nextType === "select" || nextType === "multiselect"
                  ? ({ ...base, type: nextType, options: ["Option 1"] } as FieldDef)
                  : ({ ...base, type: nextType } as FieldDef);
              onChange(next);
            }}
            className="field w-full px-3 py-2 text-sm"
          >
            {FIELD_TYPES.map((value) => (
              <option key={value} value={value}>
                {FIELD_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 self-end text-sm text-[var(--ink-strong)]">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(event) => onChange({ required: event.target.checked })}
          />
          Required
        </label>

        {hasOptions && "options" in field && (
          <label className="space-y-1 md:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Options (one per line)</span>
            <textarea
              value={field.options.join("\n")}
              onChange={(event) =>
                onChange({
                  options: event.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
                } as Partial<FieldDef>)
              }
              rows={Math.min(Math.max(field.options.length, 2), 8)}
              className="field w-full px-3 py-2 text-sm"
            />
          </label>
        )}

        <label className="space-y-1 md:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Help text (optional)</span>
          <input
            type="text"
            value={field.helpText ?? ""}
            onChange={(event) => onChange({ helpText: event.target.value || undefined })}
            className="field w-full px-3 py-2 text-sm"
          />
        </label>
      </div>
    </li>
  );
}
