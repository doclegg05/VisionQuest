"use client";

import { useEffect, useState } from "react";

type ConfigStatus = "connected" | "no_key" | "invalid_key";

export default function AiConfigPanel() {
  const [status, setStatus] = useState<ConfigStatus>("no_key");
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [envKeyConfigured, setEnvKeyConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/ai-config")
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          window.location.reload();
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        setStatus(data.status);
        setKeyHint(data.keyHint);
        setUpdatedAt(data.updatedAt);
        setEnvKeyConfigured(data.envKeyConfigured);
      })
      .catch(() => setError("Could not load AI configuration."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/ai-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not save the API key.");
        return;
      }

      setStatus("connected");
      setKeyHint("..." + apiKey.slice(-4));
      setUpdatedAt(new Date().toISOString());
      setApiKey("");
      setMessage("API key saved. Use 'Test Connection' to verify it works.");
    } catch {
      setError("Could not contact the server.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/ai-config/test", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Connection test failed.");
        setStatus("invalid_key");
        return;
      }

      setMessage(`Connection successful. Using model: ${data.model}`);
      setStatus("connected");
    } catch {
      setError("Could not contact the server.");
    } finally {
      setTesting(false);
    }
  }

  async function handleRemove() {
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/ai-config", { method: "DELETE" });
      if (!res.ok) {
        setError("Could not remove the API key.");
        return;
      }

      setStatus("no_key");
      setKeyHint(null);
      setUpdatedAt(null);
      setMessage(
        envKeyConfigured
          ? "Admin key removed. Falling back to the environment variable key."
          : "Admin key removed. Sage is now disabled until a new key is added.",
      );
    } catch {
      setError("Could not contact the server.");
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading AI configuration...</p>;
  }

  const statusLabel =
    status === "connected"
      ? "Connected"
      : status === "invalid_key"
        ? "Invalid Key"
        : "No Key Configured";

  const statusColor =
    status === "connected"
      ? "bg-emerald-100 text-emerald-700"
      : status === "invalid_key"
        ? "bg-red-100 text-red-700"
        : "bg-amber-100 text-amber-800";

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-2xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] px-4 py-3 text-sm text-[var(--ink-strong)]">
          {message}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--ink-muted)]">
            The platform Gemini API key powers Sage for all students. Students can optionally
            override this with a personal key in their settings.
          </p>
          {updatedAt && (
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Last updated: {new Date(updatedAt).toLocaleDateString()}
            </p>
          )}
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusColor}`}
        >
          {statusLabel}
        </span>
      </div>

      {status === "connected" && keyHint && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
          <p className="text-sm text-[var(--ink-strong)]">
            Active key: <span className="font-mono font-semibold">{keyHint}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={testing}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
            <button
              type="button"
              onClick={() => void handleRemove()}
              className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <label htmlFor="admin-api-key" className="mb-2 block text-sm font-medium text-[var(--ink-strong)]">
          {status === "connected" ? "Replace API key" : "Enter Gemini API key"}
        </label>
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            id="admin-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setError("");
              setMessage("");
            }}
            placeholder="AIza..."
            className="field flex-1 px-4 py-3 text-sm"
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!apiKey || saving}
            className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Key"}
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          Get a key from{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--accent-strong)] underline"
          >
            Google AI Studio
          </a>
          . Buy prepaid credits to control annual spending. Turn off auto-recharge to prevent unexpected charges.
        </p>
      </div>

      {envKeyConfigured && status !== "connected" && (
        <p className="text-xs text-[var(--ink-muted)]">
          A fallback API key is configured in the server environment. Sage will use that key until an admin key is saved here.
        </p>
      )}
    </div>
  );
}
