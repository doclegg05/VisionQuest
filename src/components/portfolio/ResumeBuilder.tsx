"use client";

import { useEffect, useRef, useState } from "react";
import {
  EMPTY_RESUME,
  buildResumePlainText,
  buildResumePrintHtml,
  type ResumeCertification,
  type ResumeContent,
  type ResumeEducation,
  type ResumeExperience,
} from "@/lib/resume";
import { generateResumePdf } from "@/lib/resume-pdf";

interface ResumeAssistResponse {
  resume: ResumeContent;
  missingInformation: string[];
  notes: string;
}

const INPUT_CLASS =
  "w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const SECONDARY_BUTTON_CLASS =
  "rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--ink-strong)] transition hover:bg-[var(--surface-raised)] disabled:cursor-not-allowed disabled:opacity-60";

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "resume";
}

export default function ResumeBuilder() {
  const [resume, setResume] = useState<ResumeContent>(EMPTY_RESUME);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillInput, setSkillInput] = useState("");
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantMessage, setAssistantMessage] = useState<string | null>(null);
  const [missingInformation, setMissingInformation] = useState<string[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadImprovements, setUploadImprovements] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  async function fetchResume() {
    try {
      const res = await fetch("/api/resume");
      if (!res.ok) {
        throw new Error("Failed to load resume.");
      }

      const data = await res.json();
      setResume(data.resume || EMPTY_RESUME);
      setDisplayName(data.displayName || "");
      setError(null);
    } catch (err) {
      console.error("Failed to load resume:", err instanceof Error ? err.message : "Unknown error");
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchResume();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setAssistantMessage(null);

    try {
      const res = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Could not save your resume.");
      }

      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save resume:", err instanceof Error ? err.message : "Unknown error");
      setError(err instanceof Error ? err.message : "Could not save your resume.");
    } finally {
      setSaving(false);
    }
  }

  function updateContact(field: keyof ResumeContent["contact"], value: string) {
    setResume((current) => ({
      ...current,
      contact: {
        ...current.contact,
        [field]: value,
      },
    }));
  }

  function addSkill() {
    const nextSkill = skillInput.trim();
    if (!nextSkill) return;

    setResume((current) => ({
      ...current,
      skills: Array.from(new Set([...current.skills, nextSkill])),
    }));
    setSkillInput("");
  }

  function removeSkill(index: number) {
    setResume((current) => ({
      ...current,
      skills: current.skills.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function addExperience() {
    setResume((current) => ({
      ...current,
      experience: [
        ...current.experience,
        { title: "", company: "", location: "", dates: "", description: "" },
      ],
    }));
  }

  function updateExperience(index: number, field: keyof ResumeExperience, value: string) {
    setResume((current) => ({
      ...current,
      experience: current.experience.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  }

  function removeExperience(index: number) {
    setResume((current) => ({
      ...current,
      experience: current.experience.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function addEducation() {
    setResume((current) => ({
      ...current,
      education: [
        ...current.education,
        { school: "", degree: "", location: "", dates: "" },
      ],
    }));
  }

  function updateEducation(index: number, field: keyof ResumeEducation, value: string) {
    setResume((current) => ({
      ...current,
      education: current.education.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  }

  function removeEducation(index: number) {
    setResume((current) => ({
      ...current,
      education: current.education.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function addCertification() {
    setResume((current) => ({
      ...current,
      certifications: [
        ...current.certifications,
        { name: "", issuer: "", dates: "" },
      ],
    }));
  }

  function updateCertification(index: number, field: keyof ResumeCertification, value: string) {
    setResume((current) => ({
      ...current,
      certifications: current.certifications.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  }

  function removeCertification(index: number) {
    setResume((current) => ({
      ...current,
      certifications: current.certifications.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function handleAssist() {
    setAssistantLoading(true);
    setAssistantMessage(null);
    setMissingInformation([]);
    setError(null);

    try {
      const res = await fetch("/api/resume/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: assistantPrompt }),
      });

      const payload = (await res.json().catch(() => null)) as ResumeAssistResponse | { error?: string } | null;
      if (!res.ok) {
        throw new Error(payload && "error" in payload ? payload.error || "Could not draft the resume." : "Could not draft the resume.");
      }

      if (payload && "resume" in payload) {
        setResume(payload.resume || EMPTY_RESUME);
        setMissingInformation(payload.missingInformation || []);
        setAssistantMessage(
          payload.notes ||
            ((payload.missingInformation || []).length > 0
              ? "Sage drafted what it could and flagged the details it still needs."
              : "Sage drafted the resume using the facts currently on file.")
        );
      }
    } catch (err) {
      console.error("Resume assist failed:", err instanceof Error ? err.message : "Unknown error");
      setError(err instanceof Error ? err.message : "Could not draft the resume.");
    } finally {
      setAssistantLoading(false);
    }
  }

  async function handleCopyAtsText() {
    try {
      await navigator.clipboard.writeText(buildResumePlainText(displayName, resume));
      setCopyState("done");
      setTimeout(() => setCopyState("idle"), 1800);
    } catch (err) {
      console.error("Failed to copy resume text:", err instanceof Error ? err.message : "Unknown error");
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 1800);
    }
  }

  async function handleDownloadPdf() {
    setExportingPdf(true);

    try {
      const blob = await generateResumePdf(displayName || "Resume", resume);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${sanitizeFileName(displayName || "resume")}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate PDF:", err instanceof Error ? err.message : "Unknown error");
      setError("Could not generate the PDF export.");
    } finally {
      setExportingPdf(false);
    }
  }

  async function handlePrint() {
    setPrinting(true);

    try {
      const printWindow = window.open("", "_blank", "noopener,noreferrer");
      if (!printWindow) {
        throw new Error("Pop-up blocked.");
      }

      printWindow.document.open();
      printWindow.document.write(buildResumePrintHtml(displayName || "Resume", resume));
      printWindow.document.close();
      printWindow.focus();

      setTimeout(() => {
        printWindow.print();
      }, 200);
    } catch (err) {
      console.error("Failed to print resume:", err instanceof Error ? err.message : "Unknown error");
      setError("Could not open the print view. Check whether pop-ups are blocked.");
    } finally {
      setPrinting(false);
    }
  }

  async function handleUpload(file: File) {
    const MAX_SIZE = 5 * 1024 * 1024;
    const ALLOWED = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    if (file.size > MAX_SIZE) { setError("File too large (max 5 MB)."); return; }
    if (!ALLOWED.includes(file.type)) { setError("Only PDF and Word documents are supported."); return; }

    setUploading(true);
    setError(null);
    setUploadImprovements([]);
    setAssistantMessage(null);
    setMissingInformation([]);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/resume/upload", { method: "POST", body: formData });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(payload?.error || "Could not process the resume.");
      }

      if (payload?.resume) {
        setResume(payload.resume);
        setUploadImprovements(payload.improvements || []);
        setAssistantMessage(
          payload.notes || "Sage extracted and rebuilt your resume. Review the sections below and save when ready."
        );
      }
    } catch (err) {
      console.error("Resume upload failed:", err instanceof Error ? err.message : "Unknown error");
      setError(err instanceof Error ? err.message : "Could not process the resume.");
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleUpload(file);
  }

  if (loading) return <p className="text-sm text-[var(--ink-faint)]">Loading resume...</p>;

  return (
    <div className="space-y-6">
      <div className="surface-section p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Resume Builder</p>
            <h3 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">{displayName || "Your resume"}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
              Keep this resume plain, readable, and ATS-friendly. The same content should work for online applications,
              PDF downloads, and printed handouts.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCopyAtsText()}
              className={SECONDARY_BUTTON_CLASS}
            >
              {copyState === "done" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy ATS Text"}
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={exportingPdf}
              className={SECONDARY_BUTTON_CLASS}
            >
              {exportingPdf ? "Building PDF..." : "Download PDF"}
            </button>
            <button
              type="button"
              onClick={() => void handlePrint()}
              disabled={printing}
              className={SECONDARY_BUTTON_CLASS}
            >
              {printing ? "Opening..." : "Print"}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                saved
                  ? "bg-green-100 text-green-700"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              {saved ? "Saved" : saving ? "Saving..." : "Save Resume"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>

      <div
        className={`surface-section p-5 ${dragOver ? "ring-2 ring-[var(--accent-strong)] ring-inset" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold text-[var(--ink-strong)]">Upload Existing Resume</h4>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
              Have a resume already? Upload it and Sage will extract the content, rewrite it with ATS-friendly language,
              and populate the builder below. Supports PDF and Word documents.
            </p>
          </div>
          <div>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }}
            />
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-green)]/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploading ? "Sage is reading..." : "Upload Resume"}
            </button>
          </div>
        </div>

        {uploading && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] px-4 py-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent-strong)] border-t-transparent" />
            <p className="text-sm text-[var(--ink-strong)]">Sage is extracting and rebuilding your resume with ATS-optimized language...</p>
          </div>
        )}

        {!uploading && dragOver && (
          <div className="mt-4 rounded-xl border-2 border-dashed border-[var(--accent-strong)] bg-[rgba(15,154,146,0.04)] px-4 py-8 text-center">
            <p className="text-sm font-medium text-[var(--accent-strong)]">Drop your resume here</p>
          </div>
        )}

        {uploadImprovements.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">Suggestions to strengthen your resume:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
              {uploadImprovements.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="surface-section p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold text-[var(--ink-strong)]">Write with Sage</h4>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
              Give Sage a target role, job posting summary, or tone request. It will rewrite the resume using only
              information already stored in VisionQuest and the facts already on this page.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleAssist()}
            disabled={assistantLoading}
            className="rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-green)]/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {assistantLoading ? "Sage is drafting..." : "Draft with Sage"}
          </button>
        </div>

        <textarea
          value={assistantPrompt}
          onChange={(event) => setAssistantPrompt(event.target.value)}
          placeholder="Example: Tailor this for entry-level office administrator roles. Highlight customer service, Microsoft Office, reliability, and any training or certifications."
          rows={4}
          className="mt-4 w-full rounded-xl border border-[var(--border)] px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {assistantMessage ? (
          <div className="mt-4 rounded-xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] px-4 py-3 text-sm text-[var(--ink-strong)]">
            {assistantMessage}
          </div>
        ) : null}

        {missingInformation.length > 0 ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">Sage still needs:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
              {missingInformation.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="surface-section p-5">
        <h4 className="mb-3 text-sm font-semibold text-[var(--ink-strong)]">Header</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Display name
            </label>
            <input value={displayName} readOnly className={`${INPUT_CLASS} bg-[var(--surface-soft)] text-[var(--ink-muted)]`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Headline
            </label>
            <input
              value={resume.headline}
              onChange={(event) => setResume((current) => ({ ...current, headline: event.target.value }))}
              placeholder="Example: Job-ready office support candidate with customer service experience"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Email
            </label>
            <input
              type="email"
              value={resume.contact.email}
              onChange={(event) => updateContact("email", event.target.value)}
              placeholder="name@example.com"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Phone
            </label>
            <input
              value={resume.contact.phone}
              onChange={(event) => updateContact("phone", event.target.value)}
              placeholder="(555) 555-5555"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Location
            </label>
            <input
              value={resume.contact.location}
              onChange={(event) => updateContact("location", event.target.value)}
              placeholder="City, State"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Website or portfolio
            </label>
            <input
              value={resume.contact.website}
              onChange={(event) => updateContact("website", event.target.value)}
              placeholder="https://example.com"
              className={INPUT_CLASS}
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              LinkedIn
            </label>
            <input
              value={resume.contact.linkedin}
              onChange={(event) => updateContact("linkedin", event.target.value)}
              placeholder="https://linkedin.com/in/your-name"
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </div>

      <div className="surface-section p-5">
        <h4 className="mb-2 text-sm font-semibold text-[var(--ink-strong)]">Professional Summary</h4>
        <textarea
          value={resume.objective}
          onChange={(event) => setResume((current) => ({ ...current, objective: event.target.value }))}
          placeholder="Write 2-4 lines summarizing the kind of work you want, the strengths you bring, and the training or experience that supports you."
          rows={5}
          className="w-full rounded-xl border border-[var(--border)] px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="surface-section p-5">
        <h4 className="mb-2 text-sm font-semibold text-[var(--ink-strong)]">Skills</h4>
        <div className="mb-3 flex flex-wrap gap-2">
          {resume.skills.map((skill, index) => (
            <span
              key={`${skill}-${index}`}
              className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
            >
              {skill}
              <button type="button" onClick={() => removeSkill(index)} className="text-blue-500 hover:text-blue-700">
                Remove
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={skillInput}
            onChange={(event) => setSkillInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addSkill();
              }
            }}
            placeholder="Add a skill such as Microsoft Excel, customer service, scheduling, or inventory tracking"
            className={`${INPUT_CLASS} flex-1`}
          />
          <button type="button" onClick={addSkill} className="rounded-lg bg-[var(--surface-interactive)] px-4 py-2 text-sm text-[var(--ink-strong)] hover:bg-[var(--surface-strong)]">
            Add Skill
          </button>
        </div>
      </div>

      <div className="surface-section p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-[var(--ink-strong)]">Work Experience</h4>
          <button type="button" onClick={addExperience} className="text-sm font-semibold text-blue-600 hover:text-blue-800">
            Add Experience
          </button>
        </div>
        <div className="space-y-4">
          {resume.experience.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">Add jobs, volunteer roles, internships, or program work that shows readiness.</p>
          ) : null}
          {resume.experience.map((item, index) => (
            <div key={`experience-${index}`} className="rounded-xl border border-[var(--border)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--ink-strong)]">Experience {index + 1}</p>
                <button type="button" onClick={() => removeExperience(index)} className="text-xs font-semibold text-red-500 hover:text-red-700">
                  Remove
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  value={item.title}
                  onChange={(event) => updateExperience(index, "title", event.target.value)}
                  placeholder="Job title"
                  className={INPUT_CLASS}
                />
                <input
                  value={item.company}
                  onChange={(event) => updateExperience(index, "company", event.target.value)}
                  placeholder="Employer or organization"
                  className={INPUT_CLASS}
                />
                <input
                  value={item.location}
                  onChange={(event) => updateExperience(index, "location", event.target.value)}
                  placeholder="Location"
                  className={INPUT_CLASS}
                />
                <input
                  value={item.dates}
                  onChange={(event) => updateExperience(index, "dates", event.target.value)}
                  placeholder="Dates, for example Jan 2024 - Present"
                  className={INPUT_CLASS}
                />
              </div>
              <textarea
                value={item.description}
                onChange={(event) => updateExperience(index, "description", event.target.value)}
                rows={4}
                placeholder={"Use short bullet lines, for example:\n- Helped customers with questions and scheduling\n- Organized records and completed data entry accurately"}
                className="mt-3 w-full rounded-xl border border-[var(--border)] px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="surface-section p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-[var(--ink-strong)]">Education</h4>
          <button type="button" onClick={addEducation} className="text-sm font-semibold text-blue-600 hover:text-blue-800">
            Add Education
          </button>
        </div>
        <div className="space-y-4">
          {resume.education.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">Add schools, training programs, GED/HSE work, or structured coursework.</p>
          ) : null}
          {resume.education.map((item, index) => (
            <div key={`education-${index}`} className="rounded-xl border border-[var(--border)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--ink-strong)]">Education {index + 1}</p>
                <button type="button" onClick={() => removeEducation(index)} className="text-xs font-semibold text-red-500 hover:text-red-700">
                  Remove
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  value={item.school}
                  onChange={(event) => updateEducation(index, "school", event.target.value)}
                  placeholder="School or program"
                  className={INPUT_CLASS}
                />
                <input
                  value={item.degree}
                  onChange={(event) => updateEducation(index, "degree", event.target.value)}
                  placeholder="Diploma, GED, certificate, or program name"
                  className={INPUT_CLASS}
                />
                <input
                  value={item.location}
                  onChange={(event) => updateEducation(index, "location", event.target.value)}
                  placeholder="Location"
                  className={INPUT_CLASS}
                />
                <input
                  value={item.dates}
                  onChange={(event) => updateEducation(index, "dates", event.target.value)}
                  placeholder="Dates"
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="surface-section p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-[var(--ink-strong)]">Certifications</h4>
          <button type="button" onClick={addCertification} className="text-sm font-semibold text-blue-600 hover:text-blue-800">
            Add Certification
          </button>
        </div>
        <div className="space-y-4">
          {resume.certifications.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">List completed certifications or credentials that should appear on the resume.</p>
          ) : null}
          {resume.certifications.map((item, index) => (
            <div key={`certification-${index}`} className="rounded-xl border border-[var(--border)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--ink-strong)]">Certification {index + 1}</p>
                <button type="button" onClick={() => removeCertification(index)} className="text-xs font-semibold text-red-500 hover:text-red-700">
                  Remove
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <input
                  value={item.name}
                  onChange={(event) => updateCertification(index, "name", event.target.value)}
                  placeholder="Certification name"
                  className={INPUT_CLASS}
                />
                <input
                  value={item.issuer}
                  onChange={(event) => updateCertification(index, "issuer", event.target.value)}
                  placeholder="Issuer"
                  className={INPUT_CLASS}
                />
                <input
                  value={item.dates}
                  onChange={(event) => updateCertification(index, "dates", event.target.value)}
                  placeholder="Date earned"
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="surface-section p-5">
        <h4 className="mb-2 text-sm font-semibold text-[var(--ink-strong)]">References</h4>
        <textarea
          value={resume.references}
          onChange={(event) => setResume((current) => ({ ...current, references: event.target.value }))}
          placeholder="Usually this should be: Available upon request"
          rows={3}
          className="w-full rounded-xl border border-[var(--border)] px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving}
        className={`w-full rounded-xl py-3 text-sm font-semibold transition-colors ${
          saved ? "bg-green-100 text-green-700" : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {saved ? "Resume Saved" : saving ? "Saving..." : "Save Resume"}
      </button>
    </div>
  );
}
