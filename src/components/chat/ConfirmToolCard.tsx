"use client";

import { useState } from "react";
import { CheckCircle, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api";

interface ConfirmToolCardProps {
  label: string;
  summary: string;
  meta: Record<string, unknown>;
}

/**
 * Confirm-before-execute card for Sage write tools (Phase 3).
 * The meta payload carries the HMAC token issued with the proposal — the
 * server re-verifies it against the exact tool+args, so this button can only
 * ever perform the action the user is looking at.
 */
export function ConfirmToolCard({ label, summary, meta }: ConfirmToolCardProps) {
  const [state, setState] = useState<"idle" | "working" | "done" | "failed">("idle");
  const [resultSummary, setResultSummary] = useState<string | null>(null);

  const confirm = async () => {
    if (state !== "idle") return;
    setState("working");
    try {
      const res = await apiFetch("/api/chat/tool-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: meta.toolName,
          args: meta.args,
          token: meta.token,
          conversationId: meta.conversationId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setResultSummary(json.data?.summary ?? json.error ?? "That didn't work.");
        setState("failed");
        return;
      }
      setResultSummary(json.data?.summary ?? "Done.");
      setState("done");
    } catch {
      setResultSummary("Something went wrong. Ask Sage to try again.");
      setState("failed");
    }
  };

  if (state === "done") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
        <CheckCircle size={17} weight="bold" className="shrink-0" />
        <span>{resultSummary}</span>
      </div>
    );
  }

  if (state === "failed") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
        <WarningCircle size={17} weight="bold" className="shrink-0" />
        <span>{resultSummary}</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <ShieldCheck size={18} weight="bold" className="mt-0.5 shrink-0 text-[var(--accent-strong)]" />
        <p className="text-sm text-[var(--ink-strong)]">{summary}</p>
      </div>
      <button
        type="button"
        onClick={confirm}
        disabled={state === "working"}
        className="mt-2 min-h-11 rounded-full bg-[var(--accent-strong)] px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
      >
        {state === "working" ? "Working…" : label}
      </button>
    </div>
  );
}
