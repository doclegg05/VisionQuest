"use client";

import { useEffect, useState } from "react";

interface ShareData {
  eligible: boolean;
  certification: {
    id: string;
    status: string;
    completedAt: string | null;
  } | null;
  page: {
    id: string;
    slug: string;
    headline: string | null;
    summary: string | null;
    isPublic: boolean;
  } | null;
  publicUrl: string | null;
}

export default function CredentialSharePanel() {
  const [data, setData] = useState<ShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    headline: "",
    summary: "",
    isPublic: false,
  });

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      const response = await fetch("/api/credentials/share");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load credential settings.");
      }
      setData(payload);
      setForm({
        headline: payload.page?.headline || "",
        summary: payload.page?.summary || "",
        isPublic: Boolean(payload.page?.isPublic),
      });
      setMessage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not load credential settings.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/credentials/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not save credential settings.");
      }
      setData((current) => current ? {
        ...current,
        eligible: payload.eligible,
        page: payload.page,
        publicUrl: payload.publicUrl,
      } : payload);
      setMessage("Credential sharing settings saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save credential settings.");
    } finally {
      setSaving(false);
    }
  }

  async function copyUrl() {
    if (!data?.publicUrl) return;
    await navigator.clipboard.writeText(data.publicUrl);
    setMessage("Public credential link copied.");
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-faint)]">Loading credential sharing...</p>;
  }

  return (
    <div className="surface-section p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Shareable proof</p>
          <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Public Credential Page</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            Create a simple public page that verifies your completed Ready to Work certification for employers and partners.
          </p>
        </div>
        {data?.publicUrl ? (
          <button
            type="button"
            onClick={() => void copyUrl()}
            className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-raised)]"
          >
            Copy link
          </button>
        ) : null}
      </div>

      {!data?.eligible ? (
        <div className="mt-4 rounded-[1.2rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          Finish certification first. Once your Ready to Work certification is completed and verified, you can publish a public credential page here.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
            <div className="space-y-3">
              <input
                type="text"
                value={form.headline}
                onChange={(event) => setForm((current) => ({ ...current, headline: event.target.value }))}
                placeholder="Headline for the public page"
                className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <textarea
                value={form.summary}
                onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))}
                rows={4}
                placeholder="What should visitors know about this credential and what it represents?"
                className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                <input
                  type="checkbox"
                  checked={form.isPublic}
                  onChange={(event) => setForm((current) => ({ ...current, isPublic: event.target.checked }))}
                />
                Make this credential page public
              </label>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="primary-button px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save settings"}
              </button>
            </div>

            <div className="rounded-[1.2rem] border border-[rgba(15,154,146,0.15)] bg-[rgba(15,154,146,0.08)] p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--accent-secondary)]">Preview</p>
              <p className="mt-3 font-display text-2xl text-[var(--ink-strong)]">
                {form.headline || "Ready to Work Certified"}
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                {form.summary || "This learner completed the SPOKES Ready to Work certification."}
              </p>
              {data.publicUrl ? (
                <p className="mt-4 text-xs break-all text-[var(--accent-strong)]">
                  {data.publicUrl}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {message ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">{message}</p>
      ) : null}
    </div>
  );
}
