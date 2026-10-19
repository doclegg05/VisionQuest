"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { DEMO_ENTER_INSTRUCTOR, DEMO_ENTER_STUDENT, DEMO_ENTRY_FAILED } from "@/lib/demo/copy";
import { continueTargetFor, entryOutcomeFor, type ContinueTarget } from "./demo-entry";

const ENTRIES = [
  { endpoint: "/api/demo/student", label: DEMO_ENTER_STUDENT },
  { endpoint: "/api/demo/instructor", label: DEMO_ENTER_INSTRUCTOR },
] as const;

/**
 * The two cohort demo buttons for the sign-in page, and a "Continue as" link
 * for a visitor who already has a live demo session.
 *
 * The session cookie is SameSite strict, so it is not sent when a visitor
 * arrives from the course gallery or an email, and the server cannot tell this
 * page who they are. The page asks once after it loads instead.
 */
export function DemoEntryButtons() {
  const router = useRouter();
  const [continueTarget, setContinueTarget] = useState<ContinueTarget | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  // State alone cannot stop a double click: two clicks can land before the
  // re-render that disables the buttons. A ref changes at once.
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    async function checkForDemoSession() {
      try {
        const res = await fetch("/api/auth/session", { credentials: "same-origin", signal: controller.signal });
        if (!res.ok) return;
        setContinueTarget(continueTargetFor(await res.json()));
      } catch {
        // The link is a shortcut. If the check fails or the page closes first,
        // the two buttons below still work, so there is nothing to tell the visitor.
      }
    }

    void checkForDemoSession();
    return () => controller.abort();
  }, []);

  async function enter(endpoint: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage("");

    let failure = DEMO_ENTRY_FAILED;
    try {
      const res = await fetch(endpoint, { method: "POST", credentials: "same-origin" });
      // A body that is not JSON becomes null, and entryOutcomeFor turns that into the retry message.
      const body: unknown = await res.json().catch(() => null);
      const outcome = entryOutcomeFor(res.ok, body);
      if (outcome.kind === "enter") {
        // The buttons stay disabled while the page changes, so a second click
        // cannot start a second student.
        router.push(outcome.redirectTo);
        router.refresh();
        return;
      }
      failure = outcome.message;
    } catch {
      // The request never got an answer (offline, or the server dropped it). The retry message covers it.
    }

    setMessage(failure);
    setPending(false);
    inFlight.current = false;
  }

  return (
    <div className="mt-5 flex flex-col gap-3">
      {continueTarget && (
        <a
          href={continueTarget.href}
          className="flex min-h-11 w-full items-center justify-center rounded-[1rem] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-base font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-interactive-hover)]"
        >
          {continueTarget.label}
        </a>
      )}

      {ENTRIES.map(({ endpoint, label }) => (
        <button
          key={endpoint}
          type="button"
          disabled={pending}
          onClick={() => void enter(endpoint)}
          className="primary-button min-h-11 w-full px-6 py-3.5 text-base disabled:cursor-not-allowed disabled:opacity-60"
        >
          {label}
        </button>
      ))}

      <p
        aria-live="polite"
        className={message ? "flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger" : "sr-only"}
      >
        {message && <WarningCircle size={20} weight="bold" aria-hidden="true" className="shrink-0" />}
        {message}
      </p>
    </div>
  );
}
