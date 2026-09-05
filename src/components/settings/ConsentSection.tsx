"use client";

import { useEffect, useState } from "react";

/**
 * One recorded-consent toggle.
 *
 * Started life as the cloud document-processing switch (Phase 3) and is now
 * parameterised, because Match & Connect Phase 4 needs a second one with
 * exactly the same mechanics and a completely different explanation. The
 * defaults keep every existing call site rendering the document-reading copy
 * unchanged.
 *
 * Plain-language explanation per the low-literacy accessibility commitment:
 * what turning it on means, and what stays the same when it is off.
 */
export interface ConsentSectionProps {
  scope?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
}

export function ConsentSection({
  scope = "cloud_file_processing",
  eyebrow = "Document reading",
  title = "Let Sage read documents you upload",
  description = "When this is on, files you hand to Sage in chat (like signed forms) can be read by our AI service so Sage understands them better. When it is off, Sage still accepts your files — she just reads them with a simpler tool that works on typed text only. You can change this any time.",
}: ConsentSectionProps = {}) {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/settings/consent?scope=${scope}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (!cancelled) setGranted(Boolean(json.data?.granted));
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this setting.");
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const toggle = async () => {
    if (granted === null || saving) return;
    setSaving(true);
    setError(null);
    const next = !granted;
    try {
      const res = await fetch("/api/settings/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, granted: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setGranted(next);
    } catch {
      setError("Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="surface-section mb-6 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-secondary)]">
            {eyebrow}
          </p>
          <p className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">{title}</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{description}</p>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={granted === true}
          aria-label={title}
          onClick={toggle}
          disabled={granted === null || saving}
          className={`relative min-h-11 min-w-20 rounded-full border px-1 transition-colors disabled:opacity-50 ${
            granted
              ? "border-[var(--success)] bg-[var(--success)]"
              : "border-[var(--border)] bg-[var(--surface-raised)]"
          }`}
        >
          <span
            className={`block h-9 w-9 rounded-full bg-white shadow transition-transform ${
              granted ? "translate-x-9" : "translate-x-0"
            }`}
          />
          <span className="sr-only">{granted ? "On" : "Off"}</span>
        </button>
      </div>
    </div>
  );
}
