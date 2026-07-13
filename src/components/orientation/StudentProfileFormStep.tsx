"use client";

import { useEffect, useState } from "react";
import type { Answers, FieldDef } from "@/lib/forms/schema";
import {
  STUDENT_PROFILE_FIELDS,
  STUDENT_PROFILE_TEMPLATE_TITLE,
} from "@/lib/spokes/student-profile-form";

interface StudentProfileFormStepProps {
  /** Called after the profile saves successfully; the wizard advances. */
  onComplete: () => Promise<void>;
}

/**
 * The orientation wizard's in-browser Student Profile step. Renders the
 * STUDENT_PROFILE_FIELDS schema as real HTML inputs (FieldWidget pattern from
 * the Forms Hub) and submits through POST /api/settings/profile, which maps
 * the answers onto the student's own SpokesRecord.
 */
export default function StudentProfileFormStep({ onComplete }: StudentProfileFormStepProps) {
  const [answers, setAnswers] = useState<Answers>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from whatever the program already has on file.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.profile) setAnswers(data.profile);
      })
      .catch(() => {
        // Prefill is best-effort; an empty form is still workable.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function setAnswer(key: string, value: string | undefined) {
    setAnswers((current) => {
      const next = { ...current };
      if (value === undefined || value === "") {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  function missingRequiredLabels(): string[] {
    return STUDENT_PROFILE_FIELDS.filter(
      (field) => field.required && typeof answers[field.key] !== "string",
    ).map((field) => field.label);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const missing = missingRequiredLabels();
    if (missing.length > 0) {
      setError(`Please fill in: ${missing.join(", ")}`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: answers }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not save your profile. Please try again.");
        return;
      }
      await onComplete();
    } catch {
      setError("Could not save your profile. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] py-16">
        <p className="text-sm text-[var(--ink-faint)]">Loading your profile...</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-6 space-y-5"
    >
      <div>
        <h2 className="text-lg font-semibold text-[var(--ink-strong)]">
          {STUDENT_PROFILE_TEMPLATE_TITLE}
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Tell us about yourself — this fills in your program profile. Your
          instructor can help you update anything later.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {STUDENT_PROFILE_FIELDS.map((field) => (
          <ProfileField
            key={field.key}
            field={field}
            value={typeof answers[field.key] === "string" ? (answers[field.key] as string) : ""}
            disabled={submitting}
            onChange={(value) => setAnswer(field.key, value)}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="primary-button px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Saving..." : "Save & Continue →"}
      </button>
    </form>
  );
}

interface ProfileFieldProps {
  field: FieldDef;
  value: string;
  disabled: boolean;
  onChange: (value: string | undefined) => void;
}

function ProfileField({ field, value, disabled, onChange }: ProfileFieldProps) {
  const inputId = `profile-${field.key}`;
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium text-[var(--ink-strong)]">
        {field.label}
        {field.required && <span aria-hidden="true"> *</span>}
      </label>
      {field.type === "select" ? (
        <select
          id={inputId}
          value={value}
          disabled={disabled}
          required={field.required}
          onChange={(event) => onChange(event.target.value || undefined)}
          className="field w-full px-3 py-2 text-sm"
        >
          <option value="">Select…</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={inputId}
          type={field.type === "date" ? "date" : field.key === "contact_email" ? "email" : "text"}
          value={value}
          maxLength={field.type === "text" ? field.maxLength : undefined}
          disabled={disabled}
          required={field.required}
          onChange={(event) => onChange(event.target.value || undefined)}
          className="field w-full px-3 py-2 text-sm"
        />
      )}
      {field.helpText && (
        <p className="text-xs text-[var(--ink-faint)]">{field.helpText}</p>
      )}
    </div>
  );
}
