"use client";

import { useEffect, useState } from "react";

interface ChecklistTemplate {
  id: string;
  label: string;
  description: string | null;
  category: string;
  sortOrder: number;
  required: boolean;
  active: boolean;
}

interface ModuleTemplate {
  id: string;
  label: string;
  description: string | null;
  sortOrder: number;
  required: boolean;
  active: boolean;
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error
  ) {
    return payload.error;
  }

  return fallback;
}

export default function SpokesManager() {
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([]);
  const [moduleTemplates, setModuleTemplates] = useState<ModuleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingChecklistId, setEditingChecklistId] = useState<string | null>(null);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [checklistForm, setChecklistForm] = useState({
    label: "",
    description: "",
    category: "orientation",
    required: true,
    active: true,
    sortOrder: "",
  });
  const [moduleForm, setModuleForm] = useState({
    label: "",
    description: "",
    required: true,
    active: true,
    sortOrder: "",
  });

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const response = await fetch("/api/teacher/spokes/config");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not load SPOKES configuration."));
      }

      setChecklistTemplates(payload.checklistTemplates || []);
      setModuleTemplates(payload.moduleTemplates || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load SPOKES configuration.");
    } finally {
      setLoading(false);
    }
  }

  function resetChecklistForm() {
    setEditingChecklistId(null);
    setChecklistForm({
      label: "",
      description: "",
      category: "orientation",
      required: true,
      active: true,
      sortOrder: "",
    });
  }

  function resetModuleForm() {
    setEditingModuleId(null);
    setModuleForm({
      label: "",
      description: "",
      required: true,
      active: true,
      sortOrder: "",
    });
  }

  async function saveChecklistTemplate() {
    if (!checklistForm.label.trim()) {
      setMessage("Checklist label is required.");
      return;
    }

    try {
      const response = await fetch("/api/teacher/spokes/config", {
        method: editingChecklistId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "checklist",
          id: editingChecklistId,
          ...checklistForm,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not save checklist template."));
      }

      setMessage(editingChecklistId ? "Checklist item updated." : "Checklist item created.");
      resetChecklistForm();
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save checklist template.");
    }
  }

  async function saveModuleTemplate() {
    if (!moduleForm.label.trim()) {
      setMessage("Module label is required.");
      return;
    }

    try {
      const response = await fetch("/api/teacher/spokes/config", {
        method: editingModuleId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "module",
          id: editingModuleId,
          ...moduleForm,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not save module template."));
      }

      setMessage(editingModuleId ? "Module updated." : "Module created.");
      resetModuleForm();
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save module template.");
    }
  }

  async function deleteTemplate(entity: "checklist" | "module", id: string) {
    if (!confirm("Delete this template? Existing student progress tied to it will also be removed.")) {
      return;
    }

    try {
      const response = await fetch("/api/teacher/spokes/config", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not delete template."));
      }

      setMessage("Template deleted.");
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not delete template.");
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading SPOKES settings...</p>;
  }

  return (
    <div className="space-y-6">
      {message ? (
        <div className="rounded-xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] px-4 py-3 text-sm text-[var(--ink-strong)]">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="surface-section p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
          Handbook-aligned setup
        </p>
        <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">SPOKES checklists and modules</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
          Use this space to load the official orientation paperwork, program files, and required modules from the
          SPOKES handbook. Orientation and program files are tracked separately so teachers can see exactly what is
          holding a learner up.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="surface-section p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Checklists</p>
              <h3 className="mt-2 font-display text-xl text-[var(--ink-strong)]">Orientation & program files</h3>
            </div>
            <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-3 py-1 text-xs font-semibold text-[var(--ink-strong)]">
              {checklistTemplates.length} items
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {checklistTemplates.map((template) => (
              <div key={template.id} className="rounded-[1rem] border border-[var(--border-soft)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--ink-strong)]">{template.label}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                      {template.category === "program_file" ? "Program file" : "Orientation"} • order {template.sortOrder}
                    </p>
                    {template.description ? (
                      <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{template.description}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingChecklistId(template.id);
                        setChecklistForm({
                          label: template.label,
                          description: template.description || "",
                          category: template.category,
                          required: template.required,
                          active: template.active,
                          sortOrder: String(template.sortOrder),
                        });
                      }}
                      className="text-xs text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteTemplate("checklist", template.id)}
                      className="text-xs text-rose-600 hover:text-rose-800"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {checklistTemplates.length === 0 ? (
              <p className="rounded-[1rem] border border-dashed border-[var(--border-soft)] p-4 text-sm text-[var(--ink-muted)]">
                No SPOKES checklist items have been configured yet.
              </p>
            ) : null}
          </div>

          <div className="mt-5 rounded-[1rem] border border-[var(--border-soft)] bg-white/70 p-4">
            <h4 className="text-sm font-semibold text-[var(--ink-strong)]">
              {editingChecklistId ? "Edit checklist item" : "Add checklist item"}
            </h4>
            <div className="mt-3 grid gap-3">
              <input
                value={checklistForm.label}
                onChange={(event) => setChecklistForm((current) => ({ ...current, label: event.target.value }))}
                placeholder="Item label"
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <textarea
                value={checklistForm.description}
                onChange={(event) => setChecklistForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Description"
                rows={2}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={checklistForm.category}
                  onChange={(event) => setChecklistForm((current) => ({ ...current, category: event.target.value }))}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                >
                  <option value="orientation">Orientation</option>
                  <option value="program_file">Program File</option>
                </select>
                <input
                  value={checklistForm.sortOrder}
                  onChange={(event) => setChecklistForm((current) => ({ ...current, sortOrder: event.target.value }))}
                  placeholder="Sort order (optional)"
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-[var(--ink-muted)]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checklistForm.required}
                    onChange={(event) => setChecklistForm((current) => ({ ...current, required: event.target.checked }))}
                  />
                  Required
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checklistForm.active}
                    onChange={(event) => setChecklistForm((current) => ({ ...current, active: event.target.checked }))}
                  />
                  Active
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveChecklistTemplate()}
                  className="rounded-xl bg-[var(--ink-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]"
                >
                  {editingChecklistId ? "Save Changes" : "Add Item"}
                </button>
                {(editingChecklistId || checklistForm.label || checklistForm.description) ? (
                  <button
                    type="button"
                    onClick={resetChecklistForm}
                    className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-[var(--ink-muted)] transition hover:border-gray-300 hover:text-[var(--ink-strong)]"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="surface-section p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Modules</p>
              <h3 className="mt-2 font-display text-xl text-[var(--ink-strong)]">Required SPOKES modules</h3>
            </div>
            <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-3 py-1 text-xs font-semibold text-[var(--ink-strong)]">
              {moduleTemplates.length} modules
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {moduleTemplates.map((template) => (
              <div key={template.id} className="rounded-[1rem] border border-[var(--border-soft)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--ink-strong)]">{template.label}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                      order {template.sortOrder}
                    </p>
                    {template.description ? (
                      <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{template.description}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingModuleId(template.id);
                        setModuleForm({
                          label: template.label,
                          description: template.description || "",
                          required: template.required,
                          active: template.active,
                          sortOrder: String(template.sortOrder),
                        });
                      }}
                      className="text-xs text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteTemplate("module", template.id)}
                      className="text-xs text-rose-600 hover:text-rose-800"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {moduleTemplates.length === 0 ? (
              <p className="rounded-[1rem] border border-dashed border-[var(--border-soft)] p-4 text-sm text-[var(--ink-muted)]">
                No SPOKES modules have been configured yet.
              </p>
            ) : null}
          </div>

          <div className="mt-5 rounded-[1rem] border border-[var(--border-soft)] bg-white/70 p-4">
            <h4 className="text-sm font-semibold text-[var(--ink-strong)]">
              {editingModuleId ? "Edit module" : "Add module"}
            </h4>
            <div className="mt-3 grid gap-3">
              <input
                value={moduleForm.label}
                onChange={(event) => setModuleForm((current) => ({ ...current, label: event.target.value }))}
                placeholder="Module label"
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <textarea
                value={moduleForm.description}
                onChange={(event) => setModuleForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Description"
                rows={2}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <input
                value={moduleForm.sortOrder}
                onChange={(event) => setModuleForm((current) => ({ ...current, sortOrder: event.target.value }))}
                placeholder="Sort order (optional)"
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <div className="flex flex-wrap gap-4 text-sm text-[var(--ink-muted)]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={moduleForm.required}
                    onChange={(event) => setModuleForm((current) => ({ ...current, required: event.target.checked }))}
                  />
                  Required
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={moduleForm.active}
                    onChange={(event) => setModuleForm((current) => ({ ...current, active: event.target.checked }))}
                  />
                  Active
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveModuleTemplate()}
                  className="rounded-xl bg-[var(--ink-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]"
                >
                  {editingModuleId ? "Save Changes" : "Add Module"}
                </button>
                {(editingModuleId || moduleForm.label || moduleForm.description) ? (
                  <button
                    type="button"
                    onClick={resetModuleForm}
                    className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-[var(--ink-muted)] transition hover:border-gray-300 hover:text-[var(--ink-strong)]"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
