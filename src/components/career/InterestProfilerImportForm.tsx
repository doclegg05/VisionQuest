"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RIASEC_KEYS } from "@/lib/career/riasec-keys";

const LABELS: Record<(typeof RIASEC_KEYS)[number], string> = {
  realistic: "Realistic (Doer)",
  investigative: "Investigative (Thinker)",
  artistic: "Artistic (Creator)",
  social: "Social (Helper)",
  enterprising: "Enterprising (Leader)",
  conventional: "Conventional (Organizer)",
};

/**
 * Path B — import six RIASEC scores from CareerOneStop / My Next Move / paper.
 * Accepts 0–1 decimals or O*NET-style integers.
 */
export function InterestProfilerImportForm() {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, string>>({
    realistic: "",
    investigative: "",
    artistic: "",
    social: "",
    enterprising: "",
    conventional: "",
  });
  const [hollandCode, setHollandCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed: Record<string, number> = {};
    for (const key of RIASEC_KEYS) {
      const n = Number(scores[key]);
      if (!Number.isFinite(n) || n < 0) {
        setError(`Enter a valid number for ${LABELS[key]}.`);
        return;
      }
      parsed[key] = n;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/career/interest-profiler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "manual",
          scores: parsed,
          hollandCode: hollandCode.trim() || null,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; profilePath?: string };
      if (!res.ok || !data.ok) {
        setError(data.message || "Could not save imported scores.");
        setSubmitting(false);
        return;
      }
      router.push(data.profilePath || "/career/profile");
      router.refresh();
    } catch {
      setError("Network error while saving. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="surface-section space-y-5 p-5 sm:p-6">
      <p className="text-sm leading-6 text-[var(--ink-muted)]">
        Enter the six interest scores from CareerOneStop, My Next Move, or a paper Interest
        Profiler. Use decimals from 0 to 1, or whole numbers from the score report — we will
        normalize them for Career DNA.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {RIASEC_KEYS.map((key) => (
          <label key={key} className="block text-sm">
            <span className="font-semibold text-[var(--ink-strong)]">{LABELS[key]}</span>
            <input
              type="number"
              step="any"
              min={0}
              required
              value={scores[key]}
              onChange={(e) => setScores((prev) => ({ ...prev, [key]: e.target.value }))}
              className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--ink)]"
            />
          </label>
        ))}
      </div>

      <label className="block text-sm">
        <span className="font-semibold text-[var(--ink-strong)]">
          Holland code (optional)
        </span>
        <input
          type="text"
          maxLength={3}
          placeholder="e.g. SEC"
          value={hollandCode}
          onChange={(e) => setHollandCode(e.target.value)}
          className="mt-1.5 w-full max-w-xs rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 uppercase text-[var(--ink)]"
        />
      </label>

      {error && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="submit" className="primary-button px-5 py-3 text-sm" disabled={submitting}>
          {submitting ? "Saving…" : "Save to Career DNA"}
        </button>
        <Link
          href="/career/interest-profiler"
          prefetch={false}
          className="secondary-button px-4 py-3 text-sm"
        >
          Take the in-app profiler instead
        </Link>
      </div>
    </form>
  );
}
