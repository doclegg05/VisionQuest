"use client";

import { useRef, useState } from "react";
import {
  ArrowSquareOut,
  FileText,
  FolderOpen,
  NavigationArrow,
  SpinnerGap,
} from "@phosphor-icons/react";
import type { ChatSseEvent } from "@/lib/chat/sse";

export interface ActionCardProps {
  action: NonNullable<ChatSseEvent["action"]>;
  target: string;
  label: string;
  /** Short title shown above the description. Falls back to label. */
  title?: string;
  /** One-line plain-language description of what the button does. */
  description?: string;
  /** Optional dismiss control (Cursor-style Skip). */
  dismissible?: boolean;
}

function ActionIcon({ action }: { action: NonNullable<ChatSseEvent["action"]> }) {
  switch (action) {
    case "open_form":
      return <FileText size={18} weight="bold" />;
    case "open_resource":
      return <FolderOpen size={18} weight="bold" />;
    case "navigate":
      return <NavigationArrow size={18} weight="bold" />;
    default:
      return <ArrowSquareOut size={18} weight="bold" />;
  }
}

function primaryLabel(
  action: NonNullable<ChatSseEvent["action"]>,
  label: string,
  working: boolean,
): string {
  if (working) {
    if (action === "open_form") return "Opening…";
    if (action === "open_resource" || action === "navigate") return "Opening…";
    return "Working…";
  }
  // Prefer short verbs for the button; keep the full label as accessible name.
  if (action === "open_form") return "Open form";
  if (action === "open_resource") return "Open";
  if (action === "navigate") return "Go there";
  return label;
}

/**
 * Cursor-style in-chat action card: title, short description, primary CTA,
 * optional Skip. Keeps the next step inside the conversation instead of a
 * bare link chip.
 */
export function ActionCard({
  action,
  target,
  label,
  title,
  description,
  dismissible = true,
}: ActionCardProps) {
  const [state, setState] = useState<"idle" | "working" | "skipped">("idle");
  const isOpeningRef = useRef(false);
  const external = /^https?:\/\//i.test(target);
  const newTab = external || action === "open_form";
  const heading = title?.trim() || label;
  const body =
    description?.trim() ||
    (action === "open_form"
      ? "Opens this program form so you can review or fill it out."
      : action === "open_resource"
        ? "Opens this resource in VisionQuest."
        : "Takes you to the next step in VisionQuest.");

  if (state === "skipped") {
    return (
      <div className="max-w-[34rem] rounded-xl border border-[var(--chat-panel-border)] bg-[var(--chat-panel-bg)] px-3 py-2 text-xs text-[var(--ink-muted)]">
        Skipped — ask Sage again if you still need this.
      </div>
    );
  }

  const working = state === "working";

  return (
    <div className="max-w-[34rem] overflow-hidden rounded-2xl border border-[var(--chat-panel-border)] bg-[var(--chat-panel-bg)] shadow-[0_4px_16px_rgba(7,23,43,0.06)]">
      <div className="flex border-l-[3px] border-l-[var(--chat-sage-mark)]">
        <div className="min-w-0 flex-1 p-3">
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--chat-sage-mark-bg)] text-[var(--chat-sage-mark)]"
              aria-hidden="true"
            >
              <ActionIcon action={action} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--ink-strong)]">{heading}</p>
              <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">{body}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {dismissible ? (
              <button
                type="button"
                onClick={() => setState("skipped")}
                disabled={working}
                className="min-h-11 rounded-full px-4 text-sm font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-interactive)] hover:text-[var(--ink-strong)] disabled:opacity-60"
              >
                Skip
              </button>
            ) : null}
            <a
              href={target}
              target={newTab ? "_blank" : undefined}
              rel={newTab ? "noopener noreferrer" : undefined}
              aria-label={label}
              aria-disabled={working}
              onClick={(event) => {
                if (isOpeningRef.current) {
                  event.preventDefault();
                  return;
                }
                isOpeningRef.current = true;
                setState("working");
                // New-tab opens don't unmount us; clear the spinner shortly.
                if (newTab) {
                  window.setTimeout(() => {
                    isOpeningRef.current = false;
                    setState("idle");
                  }, 1200);
                }
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--accent-strong)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-95"
            >
              {working ? (
                <SpinnerGap size={16} weight="bold" className="animate-spin" aria-hidden="true" />
              ) : (
                <ArrowSquareOut size={16} weight="bold" aria-hidden="true" />
              )}
              {primaryLabel(action, label, working)}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
