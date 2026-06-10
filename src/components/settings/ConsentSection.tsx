"use client";

import { useEffect, useState } from "react";

/**
 * Cloud document processing consent toggle (Phase 3).
 *
 * Plain-language explanation per the low-literacy accessibility commitment:
 * what turning it on means, what stays the same when it's off.
 */
export function ConsentSection() {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/consent?scope=cloud_file_processing")
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
  }, []);

  const toggle = async () => {
    if (granted === null || saving) return;
    setSaving(true);
    setError(null);
    const next = !granted;
    try {
      const res = await fetch("/api/settings/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "cloud_file_processing", granted: next }),
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
            Document reading
          </p>
          <p className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">
            Let Sage read documents you upload
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            When this is on, files you hand to Sage in chat (like signed forms) can be read by
            our AI service so Sage understands them better. When it is off, Sage still accepts
            your files — she just reads them with a simpler tool that works on typed text only.
            You can change this any time.
          </p>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={granted === true}
          aria-label="Let Sage read documents you upload"
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
