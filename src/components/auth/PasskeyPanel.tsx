"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/better-auth-client";

interface PasskeySummary {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
}

export default function PasskeyPanel() {
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [status, setStatus] = useState<
    "loading" | "ready" | "adding" | "error"
  >("loading");
  const [message, setMessage] = useState("");

  const fetchPasskeys = useCallback(async (): Promise<PasskeySummary[]> => {
    const bridge = await fetch(
      "/api/better-auth/visionquest/bridge-legacy-session",
      { method: "POST" },
    );
    if (!bridge.ok) {
      const data = await bridge.json().catch(() => null);
      throw new Error(
        data?.message ||
          data?.error ||
          "Could not prepare passkey management.",
      );
    }

    const response = await fetch(
      "/api/better-auth/passkey/list-user-passkeys",
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error("Could not load registered passkeys.");
    }
    return (await response.json()) as PasskeySummary[];
  }, []);

  useEffect(() => {
    let active = true;
    void fetchPasskeys()
      .then((items) => {
        if (!active) return;
        setPasskeys(items);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not load passkey settings.",
        );
      });
    return () => {
      active = false;
    };
  }, [fetchPasskeys]);

  async function addPasskey() {
    setStatus("adding");
    setMessage("");
    const result = await authClient.passkey.addPasskey({
      name: "VisionQuest passkey",
    });
    if (result.error) {
      setStatus("error");
      setMessage(
        result.error.message ||
          "The passkey could not be registered on this device.",
      );
      return;
    }

    try {
      setPasskeys(await fetchPasskeys());
      setStatus("ready");
      setMessage("Passkey added. You can now use it from the sign-in page.");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The passkey was added, but the list could not be refreshed.",
      );
    }
  }

  return (
    <section className="surface-section mb-6 p-6" aria-labelledby="passkey-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="page-eyebrow text-[var(--ink-muted)]">
            Account security
          </p>
          <h2
            id="passkey-title"
            className="mt-1 font-display text-2xl text-[var(--ink-strong)]"
          >
            Passkeys
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            Use your device lock, fingerprint, or face recognition to sign in
            without entering a password.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void addPasskey()}
          disabled={status === "loading" || status === "adding"}
          className="primary-button px-5 py-3 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "adding" ? "Adding..." : "Add a passkey"}
        </button>
      </div>

      {message && (
        <p
          role={status === "error" ? "alert" : "status"}
          className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
            status === "error"
              ? "bg-red-50 text-red-700"
              : "bg-[var(--surface-muted)] text-[var(--ink-strong)]"
          }`}
        >
          {message}
        </p>
      )}

      {status === "loading" ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">
          Loading passkeys...
        </p>
      ) : passkeys.length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3"
            >
              <p className="font-semibold text-[var(--ink-strong)]">
                {passkey.name || "Passkey"}
              </p>
              {passkey.createdAt && (
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  Added {new Date(passkey.createdAt).toLocaleDateString()}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : status !== "error" ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">
          No passkeys are registered yet.
        </p>
      ) : null}
    </section>
  );
}
