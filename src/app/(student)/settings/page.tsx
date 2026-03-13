"use client";

import { useEffect, useState } from "react";
import PageIntro from "@/components/ui/PageIntro";

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [platformKeyConfigured, setPlatformKeyConfigured] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [showTutorial, setShowTutorial] = useState(true);

  useEffect(() => {
    fetch("/api/settings/api-key")
      .then((r) => r.json())
      .then((data) => {
        setHasKey(data.hasKey);
        setKeyHint(data.keyHint);
        setPlatformKeyConfigured(Boolean(data.platformKeyConfigured));
        if (data.hasKey || data.platformKeyConfigured) setShowTutorial(false);
      });
  }, []);

  const handleSave = async () => {
    setStatus("saving");
    setErrorMsg("");

    const res = await fetch("/api/settings/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });

    const data = await res.json();
    if (res.ok) {
      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
      setHasKey(true);
      setKeyHint("..." + apiKey.slice(-4));
      setApiKey("");
    } else {
      setStatus("error");
      setErrorMsg(data.error);
    }
  };

  const handleRemove = async () => {
    const res = await fetch("/api/settings/api-key", { method: "DELETE" });
    if (res.ok) {
      setHasKey(false);
      setKeyHint(null);
      setStatus("idle");
    }
  };

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Configuration"
        title="Settings"
        description="Sage can run on the program's shared Gemini key or a personal key you add here."
      />

      {(hasKey || platformKeyConfigured) && (
        <div className="surface-section mb-6 flex items-center justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">Sage is active</p>
            <p className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">
              {hasKey ? "Personal API key connected" : "Platform API key connected"}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {hasKey
                ? `Stored key ending in ${keyHint}`
                : "Students can chat with Sage without adding their own API key."}
            </p>
          </div>
          {hasKey && (
            <button
              onClick={handleRemove}
              type="button"
              className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
            >
              Remove key
            </button>
          )}
        </div>
      )}

      <div className="surface-section p-6">
        <div className="mb-6">
          <button
            onClick={() => setShowTutorial(!showTutorial)}
            type="button"
            className="flex items-center gap-3 text-left"
          >
            <span className={`grid h-9 w-9 place-items-center rounded-2xl bg-[rgba(16,37,62,0.08)] text-[var(--ink-strong)] transition-transform ${showTutorial ? "rotate-90" : ""}`}>
              ▶
            </span>
            <div>
              <p className="page-eyebrow text-[var(--muted)]">Quick guide</p>
              <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">How to get your API key</h2>
            </div>
          </button>
        </div>

        {showTutorial && (
          <div className="mb-8 grid gap-4 md:grid-cols-2">
            {[
              {
                step: "1",
                title: "Check the default setup",
                body: platformKeyConfigured
                  ? "Your program already configured Sage for everyone. You only need a personal key if you want to override it."
                  : "If your program has not configured Sage yet, you can add a personal Gemini API key here.",
              },
              {
                step: "2",
                title: "Open Google AI Studio",
                body: "Go to aistudio.google.com/apikey and sign in with your Google account.",
              },
              {
                step: "3",
                title: "Create a key",
                body: "Choose “Create API key”. If prompted, create it in a new project.",
              },
              {
                step: "4",
                title: "Copy and save it",
                body: "Gemini keys usually begin with AIza. Paste it below and Visionquest will verify it before saving.",
              },
            ].map((item) => (
              <div key={item.step} className="rounded-[1.4rem] border border-[rgba(18,38,63,0.08)] bg-white/70 p-4">
                <div className="mb-3 flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--ink-strong)] text-sm font-bold text-white">
                    {item.step}
                  </span>
                  <h3 className="font-semibold text-[var(--ink-strong)]">{item.title}</h3>
                </div>
                <p className="text-sm leading-6 text-[var(--muted)]">{item.body}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-[1.4rem] border border-[rgba(18,38,63,0.08)] bg-white/70 p-5">
          {platformKeyConfigured && (
            <p className="mb-3 text-sm text-[var(--muted)]">
              A program-managed Gemini key is already active. Adding a personal key here is optional and will override the shared setup for your account.
            </p>
          )}

          <label htmlFor="api-key" className="mb-2 block text-sm font-medium text-[var(--ink-strong)]">
            {hasKey
              ? "Update your personal API key"
              : platformKeyConfigured
                ? "Add a personal Gemini key (optional)"
                : "Enter your Gemini API key"}
          </label>
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setStatus("idle");
                setErrorMsg("");
              }}
              placeholder="AIza..."
              className="field flex-1 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
            />
            <button
              onClick={handleSave}
              disabled={!apiKey || status === "saving"}
              type="button"
              className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "saving" ? "Testing..." : hasKey ? "Update key" : "Save key"}
            </button>
          </div>

          {status === "success" && (
            <p className="mt-3 text-sm text-emerald-600">
              Key saved successfully. Sage is ready to chat.
            </p>
          )}
          {status === "error" && (
            <p className="mt-3 text-sm text-red-600">{errorMsg}</p>
          )}
        </div>
      </div>
    </div>
  );
}
