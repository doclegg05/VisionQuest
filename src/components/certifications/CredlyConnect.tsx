"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface CredlyState {
  readonly username: string | null;
  readonly inputValue: string;
  readonly status: "idle" | "loading" | "saving" | "success" | "error";
  readonly errorMessage: string;
}

const INITIAL_STATE: CredlyState = {
  username: null,
  inputValue: "",
  status: "loading",
  errorMessage: "",
};

interface CredlyConnectProps {
  readonly onConnectionChange?: (username: string | null) => void;
}

export default function CredlyConnect({ onConnectionChange }: CredlyConnectProps) {
  const [state, setState] = useState<CredlyState>(INITIAL_STATE);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up the success-reset timer on unmount
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/settings/credly")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load Credly settings");
        return res.json() as Promise<{ credlyUsername: string | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            username: data.credlyUsername ?? null,
            status: "idle",
          }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            status: "error",
            errorMessage: "Could not load your Credly settings.",
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleConnect = useCallback(async () => {
    const trimmed = state.inputValue.trim();
    if (!trimmed) return;

    setState((prev) => ({ ...prev, status: "saving", errorMessage: "" }));

    try {
      const res = await fetch("/api/settings/credly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credlyUsername: trimmed }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: data.error ?? "Could not connect your Credly profile.",
        }));
        return;
      }

      const data = (await res.json()) as { credlyUsername: string };
      setState((prev) => ({
        ...prev,
        username: data.credlyUsername,
        inputValue: "",
        status: "success",
      }));
      onConnectionChange?.(data.credlyUsername);

      successTimerRef.current = setTimeout(() => {
        setState((prev) => (prev.status === "success" ? { ...prev, status: "idle" } : prev));
      }, 3000);
    } catch {
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: "Could not contact the server. Please try again.",
      }));
    }
  }, [state.inputValue, onConnectionChange]);

  const handleDisconnect = useCallback(async () => {
    setState((prev) => ({ ...prev, status: "saving", errorMessage: "" }));

    try {
      const res = await fetch("/api/settings/credly", { method: "DELETE" });

      if (!res.ok) {
        setState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: "Could not disconnect your Credly profile.",
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        username: null,
        status: "idle",
      }));
      onConnectionChange?.(null);
    } catch {
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: "Could not contact the server. Please try again.",
      }));
    }
  }, [onConnectionChange]);

  if (state.status === "loading") {
    return null;
  }

  if (state.username) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface-elevated)",
          color: "var(--text-primary)",
        }}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Credly profile
          </p>
          <p className="mt-1 text-sm font-medium text-[var(--ink-strong)]">
            Connected as{" "}
            <a
              href={`https://www.credly.com/users/${state.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[var(--accent-secondary)] hover:underline"
            >
              {state.username}
            </a>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleDisconnect()}
          disabled={state.status === "saving"}
          className="rounded-full border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            borderColor: "var(--border)",
            color: "var(--ink-muted)",
          }}
        >
          {state.status === "saving" ? "Disconnecting..." : "Disconnect"}
        </button>
        {state.status === "error" && (
          <p className="w-full text-sm text-[var(--error)]">{state.errorMessage}</p>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface-elevated)",
        color: "var(--text-primary)",
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
        Digital credentials
      </p>
      <p className="mt-1 text-sm font-medium text-[var(--ink-strong)]">
        Connect your Credly profile to display your digital badges here.
      </p>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="e.g., jane-doe or https://www.credly.com/users/jane-doe"
          value={state.inputValue}
          onChange={(e) =>
            setState((prev) => ({
              ...prev,
              inputValue: e.target.value,
              status: "idle",
              errorMessage: "",
            }))
          }
          className="field flex-1 px-4 py-3 text-sm"
          style={{
            borderColor: "var(--border)",
            color: "var(--text-primary)",
          }}
        />
        <button
          type="button"
          onClick={() => void handleConnect()}
          disabled={!state.inputValue.trim() || state.status === "saving"}
          className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.status === "saving" ? "Connecting..." : "Connect Credly"}
        </button>
      </div>

      {state.status === "success" && (
        <p className="mt-2 text-sm text-[var(--success)]">Credly profile connected!</p>
      )}
      {state.status === "error" && (
        <p className="mt-2 text-sm text-[var(--error)]">{state.errorMessage}</p>
      )}
    </div>
  );
}
