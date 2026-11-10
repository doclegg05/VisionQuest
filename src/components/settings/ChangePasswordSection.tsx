"use client";

import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { useDemoAccount } from "@/components/demo/DemoAccountContext";

/**
 * The "Change Your Password" section of a student's Settings page. A demo
 * account has no password, and the route refuses it, so it sees no section.
 */
export function ChangePasswordSection() {
  const demoAccount = useDemoAccount();
  if (demoAccount !== null) return null;

  return (
    <div className="surface-section mb-6 p-6">
      <div className="mb-5">
        <p className="page-eyebrow text-[var(--ink-muted)]">Sign in</p>
        <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">Change Your Password</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
          You can change your password any time. You need the one you use now.
        </p>
      </div>
      <div className="max-w-xl">
        <ChangePasswordForm idPrefix="settings-password" />
      </div>
    </div>
  );
}
