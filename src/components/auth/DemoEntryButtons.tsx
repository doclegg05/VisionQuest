"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { DEMO_ENTER_INSTRUCTOR, DEMO_ENTER_STUDENT, DEMO_SIGNIN_NOTE } from "@/lib/demo/copy";
import {
  announcementFor,
  continueTargetFor,
  entryButtonViewFor,
  entryOutcomeFor,
  offlineOutcome,
  type ContinueTarget,
  type DemoEntryOutcome,
} from "./demo-entry";

const ENTRIES = [
  { endpoint: "/api/demo/student", label: DEMO_ENTER_STUDENT },
  { endpoint: "/api/demo/instructor", label: DEMO_ENTER_INSTRUCTOR },
] as const;

/**
 * The cohort demo block for the sign-in page: a note that this is a demo, a
 * "Continue as" link for a visitor who already has a live demo session, and the
 * two buttons that start a session.
 *
 * The session cookie is SameSite strict, so it is not sent when a visitor
 * arrives from the course gallery or an email, and the server cannot tell this
 * page who they are. The page asks once after it loads instead.
 */
export function DemoEntryButtons() {
  const router = useRouter();
  const [continueTarget, setContinueTarget] = useState<ContinueTarget | null>(null);
  const [pressedEndpoint, setPressedEndpoint] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failures, setFailures] = useState(0);
  // State alone cannot stop a double click: two clicks can land before the
  // re-render that disables the buttons. A ref changes at once.
  const inFlight = useRef(false);
  const pressedButton = useRef<HTMLButtonElement | null>(null);

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

  // After a failure the visitor should land back on the button they pressed. A
  // disabled button cannot take focus, so this waits for the render that
  // enables the buttons again.
  useEffect(() => {
    if (failures > 0) pressedButton.current?.focus();
  }, [failures]);

  async function enter(endpoint: string, button: HTMLButtonElement) {
    if (inFlight.current) return;
    inFlight.current = true;
    pressedButton.current = button;
    setPressedEndpoint(endpoint);
    setMessage("");

    // Only the request and the reading of its body are guarded. Navigation runs
    // after this block: once the server has said yes, a failure to navigate is
    // not a failed request, and must not show a failure message or re-enable
    // the buttons.
    let outcome: DemoEntryOutcome;
    try {
      const res = await fetch(endpoint, { method: "POST", credentials: "same-origin" });
      // A body that is not JSON becomes null, and entryOutcomeFor turns that into the retry message.
      const body: unknown = await res.json().catch(() => null);
      outcome = entryOutcomeFor(res.ok, body);
    } catch {
      outcome = offlineOutcome();
    }

    if (outcome.kind === "enter") {
      // The buttons stay disabled while the page changes, so a second click
      // cannot start a second student.
      router.push(outcome.redirectTo);
      router.refresh();
      return;
    }

    setMessage(outcome.message);
    setPressedEndpoint(null);
    setFailures((count) => count + 1);
    inFlight.current = false;
  }

  const announcement = announcementFor(pressedEndpoint);

  return (
    <div>
      <p className="text-sm leading-6 text-[var(--ink-strong)]">{DEMO_SIGNIN_NOTE}</p>

      {/* Held open from the first render so the buttons do not move when the session check answers. */}
      <div className="mt-4 min-h-11">
        {continueTarget && (
          <a
            href={continueTarget.href}
            className="flex h-11 w-full items-center justify-center rounded-[1rem] border border-[var(--border)] bg-[var(--surface-raised)] px-4 text-base font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-interactive-hover)]"
          >
            <span className="truncate">{continueTarget.label}</span>
          </a>
        )}
      </div>

      {ENTRIES.map(({ endpoint, label }) => {
        const view = entryButtonViewFor(pressedEndpoint, endpoint, label);
        return (
          <button
            key={endpoint}
            type="button"
            disabled={view.disabled}
            onClick={(event) => void enter(endpoint, event.currentTarget)}
            className="primary-button mt-3 min-h-11 w-full px-6 py-3.5 text-base disabled:cursor-not-allowed disabled:opacity-60"
          >
            {view.label}
          </button>
        );
      })}

      <div role="status" aria-live="polite">
        {announcement && <span className="sr-only">{announcement}</span>}
        {message && (
          <p className="mt-3 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
            <WarningCircle size={20} weight="bold" aria-hidden="true" className="shrink-0" />
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
