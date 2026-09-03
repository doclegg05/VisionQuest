"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Sparkle, X } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api";
import { buildAskSagePrompt, streamSageReply } from "./ask-sage";

interface AskSageModalProps {
  goal: { id: string; content: string };
  onClose: () => void;
}

type SendState = "draft" | "sending" | "done" | "error";

const SEND_ERROR_MESSAGE = "Sorry, I had trouble reaching Sage right now. Please try again soon!";

/**
 * Ask Sage for weekly steps toward a monthly goal. The prompt is prefilled
 * but nothing is sent until the student taps Send, so the chat transcript
 * only holds a message the student saw and chose to send (F24 / VQ-R-007).
 */
export function AskSageModal({ goal, onClose }: AskSageModalProps) {
  const [draft, setDraft] = useState(() => buildAskSagePrompt(goal.content));
  const [sendState, setSendState] = useState<SendState>("draft");
  const [reply, setReply] = useState("");
  const inputId = `ask-sage-${goal.id}`;
  const titleId = `${inputId}-title`;
  const sent = sendState !== "draft";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sendState === "sending") return;

    setSendState("sending");
    setReply("");
    try {
      await streamSageReply(message, apiFetch, setReply);
      setSendState("done");
    } catch {
      setSendState("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="relative w-full max-w-lg animate-scale-pop rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]"
          aria-label="Close"
        >
          <X size={20} aria-hidden="true" />
        </button>

        <div className="mb-4 flex items-center gap-2 pr-10">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
            <Sparkle size={20} weight="fill" aria-hidden="true" />
          </span>
          <div>
            <h3 id={titleId} className="font-display text-lg text-[var(--ink-strong)]">
              Ask Sage about this goal
            </h3>
            <p className="text-xs text-[var(--ink-muted)]">
              Sage will answer here. Your message also goes into your chat with Sage.
            </p>
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-indigo-100/50 bg-indigo-50/30 p-3.5 dark:border-indigo-950/40 dark:bg-indigo-950/10">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-400">Your goal</p>
          <p className="mt-1 text-sm font-medium italic text-[var(--ink-strong)]">&ldquo;{goal.content}&rdquo;</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label htmlFor={inputId} className="block text-sm font-semibold text-[var(--ink-strong)]">
            Your message to Sage
          </label>
          <textarea
            id={inputId}
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            readOnly={sent}
            autoFocus
            className="textarea-field w-full resize-none p-3 text-sm focus:outline-none"
          />
          {!sent && <p className="text-xs text-[var(--ink-muted)]">You can change this before you send it.</p>}

          {sent && (
            <div
              className="max-h-[300px] overflow-y-auto whitespace-pre-line rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm leading-relaxed text-[var(--ink-strong)]"
              aria-live="polite"
            >
              {sendState === "sending" && !reply ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-[var(--ink-muted)]">
                  <div className="mb-2 h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" aria-hidden="true" />
                  <p className="text-xs">Sage is thinking...</p>
                </div>
              ) : sendState === "error" ? (
                SEND_ERROR_MESSAGE
              ) : (
                reply || "No reply yet."
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] px-5 text-sm font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--border)]"
            >
              {sent ? "Done" : "Close"}
            </button>
            {!sent ? (
              <button type="submit" className="primary-button min-h-11 px-5 text-sm" disabled={!draft.trim()}>
                Send to Sage
              </button>
            ) : sendState === "error" ? (
              <button type="button" onClick={() => setSendState("draft")} className="primary-button min-h-11 px-5 text-sm">
                Try again
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
