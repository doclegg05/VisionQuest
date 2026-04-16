"use client";

import { useEffect, useState } from "react";

type ProviderType = "local" | "cloud";
type LocalAuthMode = "none" | "bearer" | "cloudflare_service_token";

export default function AiProviderPanel() {
  const [provider, setProvider] = useState<ProviderType>("cloud");
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("gemma4:26b");
  const [authMode, setAuthMode] = useState<LocalAuthMode>("none");
  const [bearerToken, setBearerToken] = useState("");
  const [cloudflareClientId, setCloudflareClientId] = useState("");
  const [cloudflareClientSecret, setCloudflareClientSecret] = useState("");
  const [hasBearerToken, setHasBearerToken] = useState(false);
  const [hasCloudflareClientId, setHasCloudflareClientId] = useState(false);
  const [hasCloudflareClientSecret, setHasCloudflareClientSecret] = useState(false);
  const [clearBearerToken, setClearBearerToken] = useState(false);
  const [clearCloudflareCredentials, setClearCloudflareCredentials] = useState(false);
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
        setAuthMode(data.authMode || "none");
        setHasBearerToken(Boolean(data.hasApiKey));
        setHasCloudflareClientId(Boolean(data.hasCloudflareAccessClientId));
        setHasCloudflareClientSecret(Boolean(data.hasCloudflareAccessClientSecret));
      })
      .catch(() => setError("Could not load AI provider configuration."))
      .finally(() => setLoading(false));
  }, []);

  function resetMessages() {
    setError("");
    setMessage("");
  }

  async function handleSave() {
    setSaving(true);
    resetMessages();

    const body: Record<string, string | undefined> = {
      provider,
      url: url || undefined,
      model: model || undefined,
      authMode: provider === "local" ? authMode : undefined,
    };

    if (bearerToken) {
      body.apiKey = bearerToken;
    } else if (clearBearerToken) {
      body.apiKey = "";
    }

    if (cloudflareClientId) {
      body.cloudflareAccessClientId = cloudflareClientId;
    }
    if (cloudflareClientSecret) {
      body.cloudflareAccessClientSecret = cloudflareClientSecret;
    }
    if (clearCloudflareCredentials) {
      body.cloudflareAccessClientId = "";
      body.cloudflareAccessClientSecret = "";
    }

    try {
      const res = await fetch("/api/admin/ai-provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not save provider settings.");
        return;
      }

      if (bearerToken) setHasBearerToken(true);
      if (clearBearerToken) setHasBearerToken(false);
      if (cloudflareClientId) setHasCloudflareClientId(true);
      if (cloudflareClientSecret) setHasCloudflareClientSecret(true);
      if (clearCloudflareCredentials) {
        setHasCloudflareClientId(false);
        setHasCloudflareClientSecret(false);
      }

      setBearerToken("");
      setCloudflareClientId("");
      setCloudflareClientSecret("");
      setClearBearerToken(false);
      setClearCloudflareCredentials(false);
      setMessage("AI provider settings saved.");
    } catch {
      setError("Could not contact the server.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    resetMessages();

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
      const authLabel =
        authMode === "cloudflare_service_token"
          ? "Cloudflare service token"
          : authMode === "bearer"
            ? "Bearer token"
            : "No auth";
      const chatLabel =
        data.chatValidated && data.modelUsed
          ? ` Live chat verified with model ${data.modelUsed}.`
          : "";
      setMessage(
        `Connected to local AI server. Loaded models: ${modelList}. Chat path: ${apiModeLabel}. Auth: ${authLabel}.${chatLabel}`,
      );
    } catch {
      setError("Could not contact the server.");
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading AI provider settings...</p>;
  }

  const cloudflareConfigured =
    hasCloudflareClientId && hasCloudflareClientSecret && !clearCloudflareCredentials;
  const cloudflarePartial =
    (hasCloudflareClientId || hasCloudflareClientSecret) && !cloudflareConfigured;

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
          Choose how Sage processes AI requests. Local AI Server routes requests to an Ollama
          instance you host. For production, use a stable public endpoint such as a Cloudflare
          Tunnel hostname instead of an ephemeral ngrok free URL.
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
        <div className="space-y-4 rounded-2xl border border-[rgba(18,38,63,0.08)] bg-[var(--surface-raised)] p-4">
          <div>
            <label htmlFor="ollama-url" className="mb-1 block text-sm font-medium text-[var(--ink-strong)]">
              Server URL
            </label>
            <input
              id="ollama-url"
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                resetMessages();
              }}
              placeholder="https://llm.yourdomain.com or http://localhost:11434"
              className="field w-full px-4 py-3 text-sm"
            />
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              For production, point Sage at a stable hostname on your dedicated local-AI host.
            </p>
          </div>

          <div>
            <label htmlFor="ollama-model" className="mb-1 block text-sm font-medium text-[var(--ink-strong)]">
              Model name
            </label>
            <input
              id="ollama-model"
              type="text"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                resetMessages();
              }}
              placeholder="gemma4:26b"
              className="field w-full px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label htmlFor="local-auth-mode" className="mb-1 block text-sm font-medium text-[var(--ink-strong)]">
              Endpoint authentication
            </label>
            <select
              id="local-auth-mode"
              value={authMode}
              onChange={(e) => {
                setAuthMode(e.target.value as LocalAuthMode);
                resetMessages();
              }}
              className="field w-full px-4 py-3 text-sm"
            >
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="cloudflare_service_token">Cloudflare service token</option>
            </select>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              Use Cloudflare service tokens when the Ollama endpoint is protected by Cloudflare
              Access. Use bearer auth only for endpoints that expect an Authorization header.
            </p>
          </div>

          {authMode === "bearer" && (
            <div className="space-y-3 rounded-2xl border border-[rgba(18,38,63,0.08)] bg-[var(--surface-raised)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[var(--ink-strong)]">
                  Saved bearer token:{" "}
                  <span className="font-semibold">
                    {hasBearerToken && !clearBearerToken ? "configured" : "not configured"}
                  </span>
                </p>
                {hasBearerToken && !clearBearerToken && (
                  <button
                    type="button"
                    onClick={() => {
                      setClearBearerToken(true);
                      setBearerToken("");
                      resetMessages();
                    }}
                    className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
                  >
                    Clear Saved Token
                  </button>
                )}
              </div>
              <div>
                <label htmlFor="local-bearer-token" className="mb-1 block text-sm font-medium text-[var(--ink-strong)]">
                  {hasBearerToken ? "Replace bearer token" : "Bearer token"}
                </label>
                <input
                  id="local-bearer-token"
                  type="password"
                  value={bearerToken}
                  onChange={(e) => {
                    setBearerToken(e.target.value);
                    setClearBearerToken(false);
                    resetMessages();
                  }}
                  placeholder="Enter the token used by your local AI endpoint"
                  className="field w-full px-4 py-3 text-sm"
                />
              </div>
            </div>
          )}

          {authMode === "cloudflare_service_token" && (
            <div className="space-y-3 rounded-2xl border border-[rgba(18,38,63,0.08)] bg-[var(--surface-raised)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[var(--ink-strong)]">
                  Saved Cloudflare credentials:{" "}
                  <span className="font-semibold">
                    {cloudflareConfigured
                      ? "configured"
                      : cloudflarePartial
                        ? "partially configured"
                        : "not configured"}
                  </span>
                </p>
                {(hasCloudflareClientId || hasCloudflareClientSecret) &&
                  !clearCloudflareCredentials && (
                    <button
                      type="button"
                      onClick={() => {
                        setClearCloudflareCredentials(true);
                        setCloudflareClientId("");
                        setCloudflareClientSecret("");
                        resetMessages();
                      }}
                      className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
                    >
                      Clear Saved Credentials
                    </button>
                  )}
              </div>
              <div>
                <label htmlFor="cloudflare-client-id" className="mb-1 block text-sm font-medium text-[var(--ink-strong)]">
                  Cloudflare Access Client ID
                </label>
                <input
                  id="cloudflare-client-id"
                  type="password"
                  value={cloudflareClientId}
                  onChange={(e) => {
                    setCloudflareClientId(e.target.value);
                    setClearCloudflareCredentials(false);
                    resetMessages();
                  }}
                  placeholder="Set the CF-Access-Client-Id value"
                  className="field w-full px-4 py-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="cloudflare-client-secret" className="mb-1 block text-sm font-medium text-[var(--ink-strong)]">
                  Cloudflare Access Client Secret
                </label>
                <input
                  id="cloudflare-client-secret"
                  type="password"
                  value={cloudflareClientSecret}
                  onChange={(e) => {
                    setCloudflareClientSecret(e.target.value);
                    setClearCloudflareCredentials(false);
                    resetMessages();
                  }}
                  placeholder="Set the CF-Access-Client-Secret value"
                  className="field w-full px-4 py-3 text-sm"
                />
              </div>
              <p className="text-xs text-[var(--ink-muted)]">
                Cloudflare Access service tokens send both `CF-Access-Client-Id` and
                `CF-Access-Client-Secret` on every Sage request.
              </p>
            </div>
          )}

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
