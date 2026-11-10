"use client";

import { useEffect, useState } from "react";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { useDemoAccount } from "@/components/demo/DemoAccountContext";

/** The login name in a GET /api/auth/session answer, or null when it holds none. */
export function loginNameFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("student" in body)) return null;
  const { student } = body;
  if (typeof student !== "object" || student === null || !("studentId" in student)) return null;
  return typeof student.studentId === "string" && student.studentId !== "" ? student.studentId : null;
}

/**
 * The login name, for the form's hidden username field. Without it the form
 * still works; a password manager just cannot tell whose password it saved.
 */
function useLoginName(enabled: boolean): string | null {
  const [loginName, setLoginName] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (active) setLoginName(loginNameFrom(body));
      })
      // No login name is the documented fallback above, not a failure to report.
      .catch(() => {
        if (active) setLoginName(null);
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return loginName;
}

/**
 * The "Change Your Password" section of a student's Settings page. A demo
 * account has no password, and the route refuses it, so it sees no section.
 */
export function ChangePasswordSection() {
  const demoAccount = useDemoAccount();
  const loginName = useLoginName(demoAccount === null);
  if (demoAccount !== null) return null;

  return (
    <div className="surface-section mb-6 p-6">
      <div className="mb-5">
        <p className="page-eyebrow text-[var(--ink-muted)]">Sign in</p>
        <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">Change Your Password</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
          You can change your password any time. You need the one you use now. We sign you out on any other phone or
          computer.
        </p>
      </div>
      <div className="max-w-xl">
        <ChangePasswordForm idPrefix="settings-password" username={loginName} />
      </div>
    </div>
  );
}
