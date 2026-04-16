"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

interface ReferralRecord {
  id: string;
  firstName: string;
  lastName: string;
  referralEmail: string | null;
  county: string | null;
  householdType: string | null;
  requiredParticipationHours: number | null;
  referralDate: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
}

const CHECKLIST_CATEGORY_OPTIONS = [
  { value: "orientation", label: "Orientation" },
  { value: "program_file", label: "Program file" },
  { value: "county", label: "County option" },
  { value: "referral_intake", label: "Referral intake" },
  { value: "benchmark", label: "Benchmark" },
] as const;

const CATEGORY_LABELS = new Map<string, string>(
  CHECKLIST_CATEGORY_OPTIONS.map((option) => [option.value, option.label]),
);

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

function formatDateInput(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export default function SpokesManager() {
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([]);
  const [moduleTemplates, setModuleTemplates] = useState<ModuleTemplate[]>([]);
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countyFilter, setCountyFilter] = useState("all");
  const [editingChecklistId, setEditingChecklistId] = useState<string | null>(null);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [creatingReferral, setCreatingReferral] = useState(false);
  const [deletingReferralId, setDeletingReferralId] = useState<string | null>(null);
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
  const [referralForm, setReferralForm] = useState({
    firstName: "",
    lastName: "",
    referralEmail: "",
    county: "",
    householdType: "",
    requiredParticipationHours: "",
    referralDate: todayInputValue(),
    notes: "",
  });

  const countyFilterRef = useRef(countyFilter);
  countyFilterRef.current = countyFilter;

  const loadData = useCallback(async (selectedCounty?: string) => {
    const county = selectedCounty ?? countyFilterRef.current;
    const referralUrl =
      county && county !== "all"
        ? `/api/teacher/spokes/referrals?county=${encodeURIComponent(county)}`
        : "/api/teacher/spokes/referrals";

    try {
      setLoading(true);
      const [configResponse, referralResponse] = await Promise.all([
        fetch("/api/teacher/spokes/config"),
        fetch(referralUrl),
      ]);
      const configPayload = await configResponse.json().catch(() => null);
      const referralPayload = await referralResponse.json().catch(() => null);

      if (!configResponse.ok) {
        throw new Error(getErrorMessage(configPayload, "Could not load SPOKES configuration."));
      }
      if (!referralResponse.ok) {
        throw new Error(getErrorMessage(referralPayload, "Could not load the referral queue."));
      }

      setChecklistTemplates(configPayload.checklistTemplates || []);
      setModuleTemplates(configPayload.moduleTemplates || []);
      setReferrals(referralPayload.referrals || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load SPOKES configuration.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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

  function resetReferralForm() {
    setReferralForm({
      firstName: "",
      lastName: "",
      referralEmail: "",
      county: "",
      householdType: "",
      requiredParticipationHours: "",
      referralDate: todayInputValue(),
      notes: "",
    });
  }

  async function saveChecklistTemplate() {
    if (!checklistForm.label.trim()) {
      setMessage("Template label is required.");
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
        throw new Error(getErrorMessage(payload, "Could not save template."));
      }

      setMessage(editingChecklistId ? "Template updated." : "Template created.");
      resetChecklistForm();
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save template.");
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

  async function createReferral() {
    if (!referralForm.firstName.trim() || !referralForm.lastName.trim()) {
      setMessage("Referral first and last name are required.");
      return;
    }

    try {
      setCreatingReferral(true);
      const response = await fetch("/api/teacher/spokes/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(referralForm),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not create referral."));
      }

      setMessage("Standalone referral added to the SPOKES queue.");
      resetReferralForm();
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not create referral.");
    } finally {
      setCreatingReferral(false);
    }
  }

  async function deleteReferral(id: string) {
    if (!confirm("Delete this standalone referral?")) {
      return;
    }

    try {
      setDeletingReferralId(id);
      const response = await fetch("/api/teacher/spokes/referrals", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not delete referral."));
      }

      setMessage("Standalone referral deleted.");
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not delete referral.");
    } finally {
      setDeletingReferralId(null);
    }
  }

  const countyTemplates = useMemo(
    () =>
      checklistTemplates
        .filter((template) => template.category === "county" && template.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [checklistTemplates],
  );

  const groupedChecklistTemplates = useMemo(() => {
    const groups = new Map<string, ChecklistTemplate[]>();

    checklistTemplates.forEach((template) => {
      const existing = groups.get(template.category) || [];
      existing.push(template);
      groups.set(template.category, existing);
    });

    return Array.from(groups.entries())
      .map(([category, templates]) => ({
        category,
        label: CATEGORY_LABELS.get(category) || category.replaceAll("_", " "),
        templates: templates.sort(
          (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [checklistTemplates]);

  if (loading) {
    return <p className="text-sm text-[var(--ink-faint)]">Loading SPOKES settings...</p>;
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
        <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">
          SPOKES workflow templates, counties, and referrals
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
          Configure the orientation/program templates used inside the student workspace, define county
          options for referral intake, and maintain a county-filtered queue of standalone referrals before a
          student account exists in VisionQuest.
        </p>
      </div>

      <section className="surface-section p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Referral queue
            </p>
            <h3 className="mt-2 font-display text-xl text-[var(--ink-strong)]">
              County-scoped standalone referrals
            </h3>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
              County
            </label>
            <select
              value={countyFilter}
              onChange={(event) => {
                const nextCounty = event.target.value;
                setCountyFilter(nextCounty);
                void loadData(nextCounty);
              }}
              className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
            >
              <option value="all">All counties</option>
              {countyTemplates.map((template) => (
                <option key={template.id} value={template.label}>
                  {template.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[1rem] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <h4 className="text-sm font-semibold text-[var(--ink-strong)]">Add referral</h4>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={referralForm.firstName}
                  onChange={(event) =>
                    setReferralForm((current) => ({ ...current, firstName: event.target.value }))
                  }
                  placeholder="First name"
                  className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
                <input
                  value={referralForm.lastName}
                  onChange={(event) =>
                    setReferralForm((current) => ({ ...current, lastName: event.target.value }))
                  }
                  placeholder="Last name"
                  className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
              </div>
              <input
                value={referralForm.referralEmail}
                onChange={(event) =>
                  setReferralForm((current) => ({ ...current, referralEmail: event.target.value }))
                }
                placeholder="Referral email"
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              {countyTemplates.length > 0 ? (
                <select
                  value={referralForm.county}
                  onChange={(event) =>
                    setReferralForm((current) => ({ ...current, county: event.target.value }))
                  }
                  className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                >
                  <option value="">Select county</option>
                  {countyTemplates.map((template) => (
                    <option key={template.id} value={template.label}>
                      {template.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={referralForm.county}
                  onChange={(event) =>
                    setReferralForm((current) => ({ ...current, county: event.target.value }))
                  }
                  placeholder="County"
                  className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={referralForm.householdType}
                  onChange={(event) =>
                    setReferralForm((current) => ({ ...current, householdType: event.target.value }))
                  }
                  placeholder="Household (1P/2P)"
                  className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
                <input
                  value={referralForm.requiredParticipationHours}
                  onChange={(event) =>
                    setReferralForm((current) => ({
                      ...current,
                      requiredParticipationHours: event.target.value,
                    }))
                  }
                  placeholder="Required hours"
                  className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
              </div>
              <input
                type="date"
                value={referralForm.referralDate}
                onChange={(event) =>
                  setReferralForm((current) => ({ ...current, referralDate: event.target.value }))
                }
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <textarea
                value={referralForm.notes}
                onChange={(event) =>
                  setReferralForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder="Notes"
                rows={3}
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <button
                type="button"
                onClick={() => void createReferral()}
                disabled={creatingReferral}
                className="rounded-xl bg-[var(--ink-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
              >
                {creatingReferral ? "Saving..." : "Add Referral"}
              </button>
            </div>
          </div>

          <div className="rounded-[1rem] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-[var(--ink-strong)]">Pending referrals</h4>
              <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--ink-strong)]">
                {referrals.length} items
              </span>
            </div>
            <div className="mt-3 space-y-3">
              {referrals.map((referral) => (
                <div key={referral.id} className="rounded-xl border border-[var(--border)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink-strong)]">
                        {referral.firstName} {referral.lastName}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                        {referral.county || "County not set"} • {formatDateInput(referral.referralDate)}
                      </p>
                      <p className="mt-2 text-sm text-[var(--ink-muted)]">
                        {referral.referralEmail || "No email"} • {referral.householdType || "Household n/a"}
                        {referral.requiredParticipationHours
                          ? ` • ${referral.requiredParticipationHours} hours`
                          : ""}
                      </p>
                      {referral.notes ? (
                        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{referral.notes}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void deleteReferral(referral.id)}
                      disabled={deletingReferralId === referral.id}
                      className="text-xs text-rose-600 hover:text-rose-800 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}

              {referrals.length === 0 ? (
                <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                  No standalone referrals match the selected county filter.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="surface-section p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Workflow templates
              </p>
              <h3 className="mt-2 font-display text-xl text-[var(--ink-strong)]">
                Checklists, counties, and benchmark helpers
              </h3>
            </div>
            <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--ink-strong)]">
              {checklistTemplates.length} items
            </span>
          </div>

          <div className="mt-4 space-y-4">
            {groupedChecklistTemplates.map((group) => (
              <div key={group.category} className="rounded-[1rem] border border-[var(--border)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  {group.label}
                </p>
                <div className="mt-3 space-y-3">
                  {group.templates.map((template) => (
                    <div key={template.id} className="rounded-[1rem] border border-[var(--border)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--ink-strong)]">{template.label}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                            order {template.sortOrder}
                            {template.required ? " • required" : " • optional"}
                            {template.active ? "" : " • inactive"}
                          </p>
                          {template.description ? (
                            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                              {template.description}
                            </p>
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
                </div>
              </div>
            ))}

            {groupedChecklistTemplates.length === 0 ? (
              <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                No SPOKES workflow templates have been configured yet.
              </p>
            ) : null}
          </div>

          <div className="mt-5 rounded-[1rem] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <h4 className="text-sm font-semibold text-[var(--ink-strong)]">
              {editingChecklistId ? "Edit workflow template" : "Add workflow template"}
            </h4>
            <div className="mt-3 grid gap-3">
              <input
                value={checklistForm.label}
                onChange={(event) => setChecklistForm((current) => ({ ...current, label: event.target.value }))}
                placeholder="Template label"
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <textarea
                value={checklistForm.description}
                onChange={(event) =>
                  setChecklistForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Description"
                rows={2}
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={checklistForm.category}
                  onChange={(event) =>
                    setChecklistForm((current) => ({ ...current, category: event.target.value }))
                  }
                  className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                >
                  {CHECKLIST_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  value={checklistForm.sortOrder}
                  onChange={(event) =>
                    setChecklistForm((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                  placeholder="Sort order (optional)"
                  className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-[var(--ink-muted)]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checklistForm.required}
                    onChange={(event) =>
                      setChecklistForm((current) => ({ ...current, required: event.target.checked }))
                    }
                  />
                  Required
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checklistForm.active}
                    onChange={(event) =>
                      setChecklistForm((current) => ({ ...current, active: event.target.checked }))
                    }
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
                    className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--ink-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--ink-strong)]"
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
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                Modules
              </p>
              <h3 className="mt-2 font-display text-xl text-[var(--ink-strong)]">Required SPOKES modules</h3>
            </div>
            <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--ink-strong)]">
              {moduleTemplates.length} modules
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {moduleTemplates.map((template) => (
              <div key={template.id} className="rounded-[1rem] border border-[var(--border)] p-4">
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
              <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                No SPOKES modules have been configured yet.
              </p>
            ) : null}
          </div>

          <div className="mt-5 rounded-[1rem] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <h4 className="text-sm font-semibold text-[var(--ink-strong)]">
              {editingModuleId ? "Edit module" : "Add module"}
            </h4>
            <div className="mt-3 grid gap-3">
              <input
                value={moduleForm.label}
                onChange={(event) => setModuleForm((current) => ({ ...current, label: event.target.value }))}
                placeholder="Module label"
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <textarea
                value={moduleForm.description}
                onChange={(event) =>
                  setModuleForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Description"
                rows={2}
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <input
                value={moduleForm.sortOrder}
                onChange={(event) =>
                  setModuleForm((current) => ({ ...current, sortOrder: event.target.value }))
                }
                placeholder="Sort order (optional)"
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
              />
              <div className="flex flex-wrap gap-4 text-sm text-[var(--ink-muted)]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={moduleForm.required}
                    onChange={(event) =>
                      setModuleForm((current) => ({ ...current, required: event.target.checked }))
                    }
                  />
                  Required
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={moduleForm.active}
                    onChange={(event) =>
                      setModuleForm((current) => ({ ...current, active: event.target.checked }))
                    }
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
                    className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--ink-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--ink-strong)]"
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
