"use client";

import { useEffect, useState } from "react";

/**
 * The personal AI key section of Settings, moved out of SettingsView.
 *
 * Owner decision R9: no student is ever shown how to add or manage a
 * personal AI key. Staff and admins keep the section unchanged while a
 * pending policy decision settles whether the feature stays at all, so the
 * code is kept here rather than deleted.
 */

const KEY_SECTION_ROLES: ReadonlySet<string> = new Set(["teacher", "admin", "coordinator"]);

/** Only staff roles see the section; a role not yet known (null) does not. */
export function showsPersonalKeySection(role: string | null): boolean {
  return role !== null && KEY_SECTION_ROLES.has(role);
}

type SaveStatus = "idle" | "saving" | "success" | "error";

interface KeyState {
  hasKey: boolean;
  keyHint: string | null;
  platformKeyConfigured: boolean;
}

const TUTORIAL_STEPS = (platformKeyConfigured: boolean) => [
  {
    step: "1",
    title: "Check the default setup",
    body: platformKeyConfigured
      ? "Your program already configured Sage for everyone. You only need a personal key if you want to override it."
      : "If your program has not set up Sage yet, add your own Gemini API key here.",
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
    body: "Gemini keys usually start with AIza. Paste yours below, and we will check it before saving.",
  },
];

function useKeyState() {
  const [keys, setKeys] = useState<KeyState>({ hasKey: false, keyHint: null, platformKeyConfigured: false });
  const [showTutorial, setShowTutorial] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/api-key")
      .then((res) => res.json())
      .then((data: { hasKey?: boolean; keyHint?: string | null; platformKeyConfigured?: boolean }) => {
        if (cancelled) return;
        const next = {
          hasKey: Boolean(data.hasKey),
          keyHint: data.keyHint ?? null,
          platformKeyConfigured: Boolean(data.platformKeyConfigured),
        };
        setKeys(next);
        if (next.hasKey || next.platformKeyConfigured) setShowTutorial(false);
      })
      .catch((error: unknown) => {
        console.error("Failed to load AI key settings:", error instanceof Error ? error.message : "Unknown error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { keys, setKeys, showTutorial, setShowTutorial };
}

export function ApiKeySection() {
  const { keys, setKeys, showTutorial, setShowTutorial } = useKeyState();

  const handleRemove = async () => {
    const res = await fetch("/api/settings/api-key", { method: "DELETE" });
    if (res.ok) setKeys((current) => ({ ...current, hasKey: false, keyHint: null }));
  };

  return (
    <>
      {(keys.hasKey || keys.platformKeyConfigured) && <KeyStatusCard keys={keys} onRemove={handleRemove} />}
      <div className="surface-section p-6">
        <KeyTutorial
          open={showTutorial}
          onToggle={() => setShowTutorial(!showTutorial)}
          platformKeyConfigured={keys.platformKeyConfigured}
        />
        <KeyForm
          keys={keys}
          onSaved={(keyHint) => setKeys((current) => ({ ...current, hasKey: true, keyHint }))}
        />
      </div>
    </>
  );
}

function KeyStatusCard({ keys, onRemove }: { keys: KeyState; onRemove: () => void }) {
  return (
    <div className="surface-section mb-6 flex items-center justify-between gap-4 p-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-success">Sage is active</p>
        <p className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">
          {keys.hasKey ? "Personal API key connected" : "Platform API key connected"}
        </p>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          {keys.hasKey
            ? `Stored key ending in ${keys.keyHint}`
            : "Students can chat with Sage without adding their own API key."}
        </p>
      </div>
      {keys.hasKey && (
        <button
          onClick={onRemove}
          type="button"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-danger px-4 py-2 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft"
        >
          Remove key
        </button>
      )}
    </div>
  );
}

interface KeyTutorialProps {
  open: boolean;
  onToggle: () => void;
  platformKeyConfigured: boolean;
}

function KeyTutorial({ open, onToggle, platformKeyConfigured }: KeyTutorialProps) {
  return (
    <>
      <div className="mb-6">
        <button onClick={onToggle} type="button" className="flex min-h-11 items-center gap-3 text-left">
          <span
            className={[
              "grid h-9 w-9 place-items-center rounded-2xl",
              "bg-[var(--surface-muted)]",
              "text-[var(--ink-strong)]",
              "transition-transform",
              open ? "rotate-90" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            ▶
          </span>
          <div>
            <p className="page-eyebrow text-[var(--ink-muted)]">Quick guide</p>
            <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">How to Get Your API Key</h2>
          </div>
        </button>
      </div>
      {open && (
        <div className="mb-8 grid gap-4 md:grid-cols-2">
          {TUTORIAL_STEPS(platformKeyConfigured).map((item) => (
            <div key={item.step} className="rounded-3xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="mb-3 flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--accent-strong)] text-sm font-bold text-[var(--on-accent)]">
                  {item.step}
                </span>
                <h3 className="font-semibold text-[var(--ink-strong)]">{item.title}</h3>
              </div>
              <p className="text-sm leading-6 text-[var(--ink-muted)]">{item.body}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function useKeySave(onSaved: (keyHint: string) => void) {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const save = async () => {
    setStatus("saving");
    setErrorMsg("");
    try {
      const res = await fetch("/api/settings/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error ?? "Could not save the key. Please try again.");
        return;
      }
      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
      onSaved("..." + apiKey.slice(-4));
      setApiKey("");
    } catch {
      setStatus("error");
      setErrorMsg("Could not contact the server. Please try again.");
    }
  };

  const edit = (value: string) => {
    setApiKey(value);
    setStatus("idle");
    setErrorMsg("");
  };

  return { apiKey, status, errorMsg, save, edit };
}

function KeyForm({ keys, onSaved }: { keys: KeyState; onSaved: (keyHint: string) => void }) {
  const { apiKey, status, errorMsg, save, edit } = useKeySave(onSaved);
  const label = keys.hasKey
    ? "Update your personal API key"
    : keys.platformKeyConfigured
      ? "Add a personal Gemini key (optional)"
      : "Enter your Gemini API key";

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
      {keys.platformKeyConfigured && (
        <p className="mb-3 text-sm text-[var(--ink-muted)]">
          Your program already set up a Gemini key. Adding your own key here is optional, and it will replace the shared key for your account.
        </p>
      )}
      <label htmlFor="api-key" className="mb-2 block text-sm font-medium text-[var(--ink-strong)]">
        {label}
      </label>
      <div className="flex flex-col gap-3 md:flex-row">
        <input
          id="api-key"
          type="password"
          value={apiKey}
          onChange={(e) => edit(e.target.value)}
          placeholder="AIza..."
          className="field flex-1 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
        />
        <button
          onClick={save}
          disabled={!apiKey || status === "saving"}
          type="button"
          className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "saving" ? "Testing..." : keys.hasKey ? "Update key" : "Save key"}
        </button>
      </div>
      {status === "success" && <p className="mt-3 text-sm text-success">Key saved successfully. Sage is ready to chat.</p>}
      {status === "error" && <p className="mt-3 text-sm text-danger">{errorMsg}</p>}
    </div>
  );
}
