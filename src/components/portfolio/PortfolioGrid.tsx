"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowSquareOut,
  Certificate,
  CheckCircle,
  FileText,
  Medal,
  UploadSimple,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import AskSageLink from "@/components/sage/AskSageLink";
import { useConfirm } from "@/components/ui/useConfirm";
import {
  fileCategoryForPortfolioType,
  normalizePortfolioItemType,
  type PortfolioItemType,
} from "@/lib/portfolio";

interface PortfolioItem {
  id: string;
  title: string;
  description: string | null;
  type: string;
  fileId: string | null;
  url: string | null;
}

interface CertRequirement {
  id: string | null;
  templateId: string;
  label: string;
  description: string | null;
  required: boolean;
  needsFile: boolean;
  needsVerify: boolean;
  completed: boolean;
  verifiedBy: string | null;
  fileId: string | null;
}

interface CertData {
  certification: { id: string; status: string } | null;
  requirements: CertRequirement[];
  total: number;
  done: number;
}

interface PortfolioFormState {
  title: string;
  description: string;
  type: PortfolioItemType;
  url: string;
  fileId: string;
}

const TYPE_META: Record<string, { icon: Icon; label: string; desc?: string }> = {
  project: { icon: Wrench, label: "Project", desc: "Work sample or class project" },
  certification: { icon: Certificate, label: "Certification", desc: "Industry credential or certificate" },
  cert: { icon: Certificate, label: "Certification" },
  resume: { icon: FileText, label: "Resume" },
  achievement: { icon: Medal, label: "Award", desc: "Recognition or achievement" },
  award: { icon: Medal, label: "Award" },
  skill: { icon: CheckCircle, label: "Skill" },
  other: { icon: FileText, label: "Document", desc: "Resume, letter, or reference" },
};

const TYPE_OPTIONS: Array<{ value: PortfolioItemType; icon: Icon; label: string; desc: string }> = [
  { value: "certification", icon: Certificate, label: "Certification", desc: "Industry credential or certificate" },
  { value: "project", icon: Wrench, label: "Project", desc: "Work sample or class project" },
  { value: "achievement", icon: Medal, label: "Award", desc: "Recognition or achievement" },
  { value: "other", icon: FileText, label: "Document", desc: "Resume, letter, or reference" },
];

const EMPTY_FORM: PortfolioFormState = {
  title: "",
  description: "",
  type: "project",
  url: "",
  fileId: "",
};

export default function PortfolioGrid() {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [certData, setCertData] = useState<CertData | null>(null);
  const [certLoadState, setCertLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [certError, setCertError] = useState<string | null>(null);
  const [certificationRequirementId, setCertificationRequirementId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<PortfolioFormState>(EMPTY_FORM);
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    if (form.type !== "certification" || certLoadState !== "idle") return;
    fetchCertificationData();
  }, [form.type, certLoadState]);

  async function fetchItems() {
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to load portfolio:", err instanceof Error ? err.message : "Unknown error");
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchCertificationData() {
    setCertLoadState("loading");
    setCertError(null);
    try {
      const res = await fetch("/api/certifications?ensure=false");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Could not load Ready to Work requirements.");
      }
      const result = await res.json();
      setCertData(result);
      setCertLoadState("loaded");
    } catch (err) {
      console.error("Failed to load certification requirements:", err instanceof Error ? err.message : "Unknown error");
      setCertError("Could not load Ready to Work requirements.");
      setCertLoadState("error");
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("File is too large. Maximum size is 10MB.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", fileCategoryForPortfolioType(form.type));
      const res = await fetch("/api/files", { method: "POST", body: formData });
      if (res.ok) {
        const { file: uploaded } = await res.json();
        setForm((prev) => ({ ...prev, fileId: uploaded.id }));
        setError(null);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Upload failed. Try a PDF, JPG, or PNG under 10MB.");
      }
    } catch (err) {
      console.error("Upload failed:", err instanceof Error ? err.message : "Unknown error");
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    if (certificationRequirementId && !form.fileId) {
      setError("Attach the certificate file before submitting it for Ready to Work review.");
      return;
    }
    const method = editingId ? "PUT" : "POST";
    const body = editingId
      ? { id: editingId, ...form }
      : {
          ...form,
          certificationRequirementId: form.type === "certification" ? certificationRequirementId || null : null,
        };

    try {
      const res = await fetch("/api/portfolio", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        resetForm();
        fetchItems();
        if (form.type === "certification") {
          setCertData(null);
          setCertLoadState("idle");
        }
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Could not save this portfolio item.");
      }
    } catch (err) {
      console.error("Failed to save:", err instanceof Error ? err.message : "Unknown error");
      setError("Could not save this portfolio item.");
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ title: "Remove this portfolio item?", confirmLabel: "Remove" }))) return;
    try {
      await fetch("/api/portfolio", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      fetchItems();
    } catch (err) {
      console.error("Failed to delete:", err instanceof Error ? err.message : "Unknown error");
    }
  }

  function startEdit(item: PortfolioItem) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      description: item.description || "",
      type: normalizePortfolioItemType(item.type) || "project",
      url: item.url || "",
      fileId: item.fileId || "",
    });
    setCertificationRequirementId("");
    setShowForm(true);
  }

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setCertificationRequirementId("");
    setError(null);
  }

  function chooseType(type: PortfolioItemType) {
    setForm((prev) => ({ ...prev, type }));
    if (type !== "certification") {
      setCertificationRequirementId("");
    }
  }

  function chooseCertificationRequirement(requirementId: string) {
    setCertificationRequirementId(requirementId);
    const requirement = certData?.requirements.find((entry) => entry.id === requirementId);
    if (requirement && !form.title.trim()) {
      setForm((prev) => ({ ...prev, title: requirement.label }));
    }
  }

  if (loading) return <p className="text-sm text-[var(--ink-faint)]">Loading portfolio...</p>;

  if (error) return (
    <div className="text-center py-12">
      <p className="text-red-600 mb-4">{error}</p>
      <button onClick={fetchItems} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        Try Again
      </button>
    </div>
  );

  // Group by type
  const grouped: Record<string, PortfolioItem[]> = {};
  for (const item of items) {
    if (!grouped[item.type]) grouped[item.type] = [];
    grouped[item.type].push(item);
  }
  const linkableRequirements = certData?.requirements.filter((req) =>
    req.id && (!req.completed || !req.verifiedBy || !req.fileId)
  ) || [];
  const selectedRequirement = linkableRequirements.find((req) => req.id === certificationRequirementId) || null;

  return (
    <div className="space-y-6">
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".pdf,.jpg,.jpeg,.png" className="hidden" />

      {items.length === 0 && !showForm ? (
        <div className="surface-section px-5 py-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Portfolio starter
          </p>
          <h3 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Add one proof item</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--ink-muted)]">
            Start with something you may need later: a resume, certificate, project, award, or work sample.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="primary-button px-4 py-2.5 text-sm"
            >
              Add first item
            </button>
            <AskSageLink
              prompt="Help me decide the first proof item I should add to my portfolio based on my goals and experience."
              label="Ask Sage what to add"
            />
          </div>
        </div>
      ) : (
        Object.entries(grouped).map(([type, typeItems]) => (
          <div key={type}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              {(() => {
                const Icon = TYPE_META[type]?.icon || FileText;
                return <Icon size={16} weight="duotone" aria-hidden />;
              })()}
              {TYPE_META[type]?.label || type} ({typeItems.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {typeItems.map((item) => (
                <div key={item.id} className="surface-section p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--ink-strong)]">{item.title}</p>
                      {item.description && (
                        <p className="text-xs text-[var(--ink-muted)] mt-1 line-clamp-2">{item.description}</p>
                      )}
                      <div className="flex gap-2 mt-2">
                        {item.fileId && (
                          <a href={`/api/files/download?id=${item.fileId}`} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-800">View file</a>
                        )}
                        {item.url && (
                          <a href={item.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-800">Open link ↗</a>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(item)} className="text-xs text-blue-600 hover:text-blue-800 px-1">Edit</button>
                      <button onClick={() => handleDelete(item.id)} className="text-xs text-red-500 hover:text-red-700 px-1">Del</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Add/Edit wizard */}
      {showForm ? (
        <div className="surface-section overflow-hidden p-5">
          <h3 className="font-display text-lg text-[var(--ink-strong)]">
            {editingId ? "Edit Portfolio Item" : "Add to Your Portfolio"}
          </h3>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {editingId ? "Update the details below." : "Choose what you'd like to add, then fill in the details."}
          </p>

          {/* Step 1: Type selector (visual cards) */}
          {!editingId && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => chooseType(opt.value)}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all ${
                    form.type === opt.value
                      ? "border-[var(--accent-strong)] bg-[rgba(42,138,60,0.06)] shadow-sm"
                      : "border-[var(--border)] hover:border-[var(--accent-secondary)]"
                  }`}
                >
                  <Icon size={28} weight="duotone" aria-hidden className="text-[var(--accent-secondary)]" />
                  <span className="text-sm font-semibold text-[var(--ink-strong)]">{opt.label}</span>
                  <span className="text-xs leading-4 text-[var(--ink-muted)]">{opt.desc}</span>
                </button>
                );
              })}
            </div>
          )}

          {/* Step 2: Details */}
          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="portfolio-title" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                Title <span className="text-red-400">*</span>
              </label>
              <input
                id="portfolio-title"
                type="text"
                placeholder={form.type === "certification" ? "e.g., IC3 Digital Literacy Level 1" : "e.g., Customer Service Training Project"}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="field px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="portfolio-desc" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                Description <span className="text-[var(--ink-muted)]">(optional)</span>
              </label>
              <textarea
                id="portfolio-desc"
                placeholder="What did you learn or accomplish?"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="field px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="portfolio-url" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                Link <span className="text-[var(--ink-muted)]">(optional)</span>
              </label>
              <input
                id="portfolio-url"
                type="url"
                placeholder="https://..."
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                className="field px-4 py-3 text-sm"
              />
            </div>

            {/* File upload area */}
            <div>
              <p className="mb-1.5 text-sm font-medium text-[var(--ink-strong)]">
                Attach file <span className="text-[var(--ink-muted)]">(PDF, JPG, or PNG — max 10MB)</span>
              </p>
              {form.fileId ? (
                <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                  <CheckCircle size={20} weight="fill" aria-hidden className="text-green-600" />
                  <span className="flex-1 text-sm font-medium text-green-800">File attached</span>
                  <button
                    type="button"
                    onClick={() => {
                      setForm({ ...form, fileId: "" });
                      setCertificationRequirementId("");
                    }}
                    className="text-xs font-medium text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--ink-muted)] transition-colors hover:border-[var(--accent-secondary)] hover:text-[var(--accent-secondary)] disabled:opacity-50"
                >
                  {uploading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent-secondary)]" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <UploadSimple size={20} weight="bold" aria-hidden />
                      Click to upload a file
                    </>
                  )}
                </button>
              )}
            </div>

            {form.type === "certification" && !editingId && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-raised)] text-[var(--accent-secondary)]">
                    <Certificate size={20} weight="duotone" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--ink-strong)]">Certification proof</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                      Save this in your portfolio. If it also proves a Ready to Work step, send it to your instructor here.
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <label htmlFor="certification-requirement" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
                    Ready to Work step <span className="text-[var(--ink-muted)]">(optional)</span>
                  </label>
                  <select
                    id="certification-requirement"
                    value={certificationRequirementId}
                    onChange={(event) => chooseCertificationRequirement(event.target.value)}
                    disabled={!form.fileId || certLoadState === "loading" || linkableRequirements.length === 0}
                    className="select-field w-full px-4 py-3 text-sm disabled:opacity-60"
                  >
                    <option value="">
                      {certLoadState === "loading" ? "Loading steps..." : "Portfolio only"}
                    </option>
                    {linkableRequirements.map((req) => (
                      <option key={req.id || req.templateId} value={req.id || ""}>
                        {req.label}
                        {req.completed && req.verifiedBy ? " (verified)" : req.completed ? " (submitted)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-3 flex flex-col gap-2 text-xs leading-5 text-[var(--ink-muted)] sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2">
                    <WarningCircle size={16} weight="duotone" aria-hidden className="mt-0.5 shrink-0 text-[var(--accent-gold)]" />
                    <span>
                      {selectedRequirement
                        ? selectedRequirement.needsVerify
                          ? "This will be submitted for instructor verification."
                          : "This will be marked complete when you save."
                        : form.fileId
                          ? linkableRequirements.length === 0 && certLoadState === "loaded"
                            ? "Save it to your portfolio, or open Learning to start Ready to Work steps."
                            : "Choose a step only if this file proves that requirement."
                          : "Attach the file before choosing a Ready to Work step."}
                    </span>
                  </div>
                  <Link
                    href="/learning"
                    prefetch={false}
                    className="inline-flex items-center gap-1 font-semibold text-[var(--accent-secondary)] hover:underline"
                  >
                    Review steps
                    <ArrowSquareOut size={14} weight="bold" aria-hidden />
                  </Link>
                </div>

                {certError && (
                  <button
                    type="button"
                    onClick={fetchCertificationData}
                    className="mt-3 text-xs font-semibold text-[var(--accent-secondary)] hover:underline"
                  >
                    Try loading Ready to Work steps again
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={!form.title.trim()}
              className="primary-button px-6 py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {editingId ? "Save Changes" : "Add to Portfolio"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="text-sm font-medium text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            >
              Cancel
            </button>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>
          )}
        </div>
      ) : items.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border)] p-5 text-sm font-semibold text-[var(--ink-muted)] transition-colors hover:border-[var(--accent-secondary)] hover:text-[var(--accent-secondary)]"
        >
          <span className="text-lg">+</span> Add Portfolio Item
        </button>
      ) : null}
      {confirmDialog}
    </div>
  );
}
