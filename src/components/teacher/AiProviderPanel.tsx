"use client";

import { useEffect, useState } from "react";

type ProviderType = "local" | "cloud";

export default function AiProviderPanel() {
  const [provider, setProvider] = useState<ProviderType>("cloud");
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("gemma4:26b");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/ai-provider")
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          window.location.reload();
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        setProvider(data.provider);
        setUrl(data.url);
        setModel(data.model);
      })
      .catch(() => setError("Could not load AI provider configuration."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/ai-provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, url: url || undefined, model: model || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not save provider settings.");
        return;
      }

      setMessage("AI provider settings saved.");
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
      const res = await fetch("/api/admin/ai-provider/test", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Connection test failed.");
        return;
      }

      const modelList = data.models?.length
        ? data.models.join(", ")
        : "no models loaded";
      const apiModeLabel =
        data.apiMode === "native"
          ? "native Ollama API fallback"
          : data.apiMode === "openai"
            ? "OpenAI-compatible API"
            : "detected chat API";
      setMessage(`Connected to local AI server. Loaded models: ${modelList}. Chat path: ${apiModeLabel}.`);
    } catch {
      setError("Could not contact the server.");
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading AI provider settings...</p>;
  }

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

      <div>
        <p className="text-sm text-[var(--ink-muted)]">
          Choose how Sage processes AI requests. &quot;Local AI Server&quot; routes requests to an
          Ollama instance you host. &quot;Google Gemini Cloud&quot; uses the Gemini API (requires an API key below).
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setProvider("local")}
          className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors ${
            provider === "local"
              ? "border-[var(--accent-strong)] bg-[rgba(15,154,146,0.08)] text-[var(--accent-strong)]"
              : "border-[rgba(18,38,63,0.12)] text-[var(--ink-muted)] hover:bg-[var(--surface-raised)]"
          }`}
        >
          Local AI Server
        </button>
        <button
          type="button"
          onClick={() => setProvider("cloud")}
          className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors ${
            provider === "cloud"
              ? "border-[var(--accent-strong)] bg-[rgba(15,154,146,0.08)] text-[var(--accent-strong)]"
              : "border-[rgba(18,38,63,0.12)] text-[var(--ink-muted)] hover:bg-[var(--surface-raised)]"
          }`}
        >
          Google Gemini Cloud
        </button>
      </div>

      {provider === "local" && (
        <div className="space-y-3 rounded-2xl border border-[rgba(18,38,63,0.08)] bg-[var(--surface-raised)] p-4">
          <div>
            <label htmlFor="ollama-url" className="mb-1 block text-sm font-medium text-[var(--ink-strong)]">
              Server URL
            </label>
            <input
              id="ollama-url"
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(""); setMessage(""); }}
              placeholder="https://llm.yourdomain.com or http://localhost:11434"
              className="field w-full px-4 py-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="ollama-model" className="mb-1 block text-sm font-medium text-[var(--ink-strong)]">
              Model name
            </label>
            <input
              id="ollama-model"
              type="text"
              value={model}
              onChange={(e) => { setModel(e.target.value); setError(""); setMessage(""); }}
              placeholder="gemma4:26b"
              className="field w-full px-4 py-3 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testing || !url}
            className="rounded-full border border-[rgba(18,38,63,0.12)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving || (provider === "local" && !url)}
        className="primary-button w-full px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? "Saving..." : "Save Provider Settings"}
      </button>
    </div>
  );
}
