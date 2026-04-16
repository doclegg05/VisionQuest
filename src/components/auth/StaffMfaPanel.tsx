"use client";

import { useEffect, useMemo, useState } from "react";

interface MfaStatusResponse {
  enabled: boolean;
  backupCodesRemaining: number;
  verifiedAt: string | null;
}

interface SetupResponse {
  secret: string;
  totpUri: string;
}

interface BackupCodeResponse {
  backupCodes: string[];
  backupCodesRemaining?: number;
}

type ConfirmAction = "disable" | "regenerate" | null;

function formatBackupCodeText(codes: string[]) {
  return codes.join("\n");
}

export default function StaffMfaPanel() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [backupCodesRemaining, setBackupCodesRemaining] = useState(0);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [setupSecret, setSetupSecret] = useState("");
  const [setupUri, setSetupUri] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [confirmToken, setConfirmToken] = useState("");
  const [pendingAction, setPendingAction] = useState<ConfirmAction>(null);
  const [revealedBackupCodes, setRevealedBackupCodes] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<"setup" | "verify" | "disable" | "regenerate" | "copy" | null>(null);

  const backupCodeText = useMemo(
    () => formatBackupCodeText(revealedBackupCodes),
    [revealedBackupCodes],
  );

  async function loadStatus() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/mfa/status");
      const data = (await res.json()) as MfaStatusResponse & { error?: string };

      if (!res.ok) {
        setError(data.error || "Could not load your MFA settings.");
        return;
      }

      setEnabled(Boolean(data.enabled));
      setBackupCodesRemaining(Number(data.backupCodesRemaining || 0));
      setVerifiedAt(data.verifiedAt);
    } catch {
      setError("Could not load your MFA settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function handleStartSetup() {
    setBusyAction("setup");
    setError("");
    setMessage("");
    setVerificationToken("");
    setPendingAction(null);

    try {
      const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
      const data = (await res.json()) as SetupResponse & { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not start MFA setup.");
        return;
      }

      setSetupSecret(data.secret);
      setSetupUri(data.totpUri);
      setMessage("Authenticator setup started. Add the secret below, then enter a 6-digit code to finish.");
    } catch {
      setError("Could not contact the server.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleVerifySetup() {
    setBusyAction("verify");
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: verificationToken }),
      });
      const data = (await res.json()) as BackupCodeResponse & { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not verify your MFA code.");
        return;
      }

      setEnabled(true);
      setBackupCodesRemaining(data.backupCodes.length);
      setVerifiedAt(new Date().toISOString());
      setRevealedBackupCodes(data.backupCodes);
      setSetupSecret("");
      setSetupUri("");
      setVerificationToken("");
      setMessage("MFA is enabled. Save these backup codes now; they are only shown once.");
    } catch {
      setError("Could not contact the server.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConfirmAction() {
    if (!pendingAction) return;

    const action = pendingAction;
    setBusyAction(action);
    setError("");
    setMessage("");

    try {
      const endpoint =
        action === "disable" ? "/api/auth/mfa/disable" : "/api/auth/mfa/backup-codes";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: confirmToken }),
      });
      const data = (await res.json()) as
        | ({ disabled?: boolean } & BackupCodeResponse & { error?: string })
        | { error?: string };

      if (!res.ok) {
        setError(data.error || "Could not complete the MFA update.");
        return;
      }

      if (action === "disable") {
        setEnabled(false);
        setBackupCodesRemaining(0);
        setVerifiedAt(null);
        setRevealedBackupCodes([]);
        setSetupSecret("");
        setSetupUri("");
        setMessage("MFA was disabled for this account.");
      } else {
        const refreshedCodes = "backupCodes" in data ? data.backupCodes : [];
        setRevealedBackupCodes(refreshedCodes);
        setBackupCodesRemaining(refreshedCodes.length);
        setMessage("New backup codes generated. Save them now; the previous set no longer works.");
      }

      setPendingAction(null);
      setConfirmToken("");
    } catch {
      setError("Could not contact the server.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCopyCodes() {
    if (!revealedBackupCodes.length) return;
    setBusyAction("copy");
    setError("");

    try {
      await navigator.clipboard.writeText(backupCodeText);
      setMessage("Backup codes copied to your clipboard.");
    } catch {
      setError("Could not copy the backup codes. Select and copy them manually.");
    } finally {
      setBusyAction(null);
    }
  }

  function handlePrintCodes() {
    window.print();
  }

  function dismissBackupCodes() {
    setRevealedBackupCodes([]);
    setMessage("Backup codes hidden. Regenerate a new set later if needed.");
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading MFA settings...</p>;
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-2xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] px-4 py-3 text-sm text-[var(--ink-strong)]">
          {message}
        </div>
      )}

      <div className="rounded-[1.4rem] border border-[var(--border)] bg-[var(--surface-raised)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="page-eyebrow text-[var(--ink-muted)]">Account security</p>
            <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">
              Multi-factor authentication
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
              Staff accounts can require an authenticator app at sign-in. Backup codes are your recovery path if your phone is unavailable, so store them somewhere safe offline.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
              enabled
                ? "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]"
                : "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]"
            }`}
          >
            {enabled ? "Enabled" : "Not enabled"}
          </span>
        </div>

        {enabled && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Backup codes remaining
              </p>
              <p className="mt-2 text-2xl font-semibold text-[var(--ink-strong)]">
                {backupCodesRemaining}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Last verified
              </p>
              <p className="mt-2 text-sm font-medium text-[var(--ink-strong)]">
                {verifiedAt ? new Date(verifiedAt).toLocaleString() : "Not recorded yet"}
              </p>
            </div>
          </div>
        )}

        {!enabled && !setupSecret && (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => void handleStartSetup()}
              disabled={busyAction === "setup"}
              className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyAction === "setup" ? "Starting..." : "Set up MFA"}
            </button>
          </div>
        )}

        {setupSecret && (
          <div className="mt-5 space-y-4 rounded-[1.4rem] border border-[var(--border)] bg-white p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-semibold text-[var(--ink-strong)]">Step 1: Add this secret to your authenticator app</p>
                <code className="mt-3 block rounded-2xl bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--ink-strong)]">
                  {setupSecret}
                </code>
                <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
                  If your authenticator app supports setup links, you can also open the generated `otpauth://` value below.
                </p>
                <textarea
                  readOnly
                  value={setupUri}
                  className="mt-3 min-h-24 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs text-[var(--ink-muted)]"
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--ink-strong)]">Step 2: Enter the 6-digit code</p>
                <input
                  type="text"
                  inputMode="numeric"
                  value={verificationToken}
                  onChange={(event) => setVerificationToken(event.target.value)}
                  placeholder="123456"
                  className="field mt-3 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void handleVerifySetup()}
                    disabled={busyAction === "verify" || verificationToken.trim().length < 6}
                    className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busyAction === "verify" ? "Verifying..." : "Enable MFA"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSetupSecret("");
                      setSetupUri("");
                      setVerificationToken("");
                      setMessage("");
                    }}
                    className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {enabled && !pendingAction && (
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setPendingAction("regenerate");
                setConfirmToken("");
                setError("");
                setMessage("");
              }}
              className="primary-button px-6 py-3 text-sm"
            >
              Regenerate backup codes
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingAction("disable");
                setConfirmToken("");
                setError("");
                setMessage("");
              }}
              className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
            >
              Disable MFA
            </button>
          </div>
        )}

        {enabled && pendingAction && (
          <div className="mt-5 rounded-[1.4rem] border border-[var(--border)] bg-white p-5">
            <p className="text-sm font-semibold text-[var(--ink-strong)]">
              {pendingAction === "disable"
                ? "Enter a current 6-digit code to disable MFA"
                : "Enter a current 6-digit code to generate a fresh set of backup codes"}
            </p>
            <input
              type="text"
              inputMode="numeric"
              value={confirmToken}
              onChange={(event) => setConfirmToken(event.target.value)}
              placeholder="123456"
              className="field mt-3 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleConfirmAction()}
                disabled={busyAction === pendingAction || confirmToken.trim().length < 6}
                className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === pendingAction
                  ? pendingAction === "disable"
                    ? "Disabling..."
                    : "Generating..."
                  : pendingAction === "disable"
                    ? "Disable MFA"
                    : "Generate backup codes"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingAction(null);
                  setConfirmToken("");
                }}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {revealedBackupCodes.length > 0 && (
        <div className="rounded-[1.4rem] border border-[rgba(255,154,77,0.35)] bg-[rgba(255,154,77,0.12)] p-5">
          <p className="page-eyebrow text-[var(--ink-muted)]">Save now</p>
          <h3 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">
            One-time backup codes
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            These codes are shown once. Copy or print them before you leave this screen. Each code works a single time.
          </p>

          <pre className="mt-4 overflow-x-auto rounded-2xl bg-white px-4 py-4 text-sm font-semibold leading-7 text-[var(--ink-strong)]">
            {backupCodeText}
          </pre>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleCopyCodes()}
              disabled={busyAction === "copy"}
              className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyAction === "copy" ? "Copying..." : "Copy backup codes"}
            </button>
            <button
              type="button"
              onClick={handlePrintCodes}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)]"
            >
              Print
            </button>
            <button
              type="button"
              onClick={dismissBackupCodes}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)]"
            >
              I saved them
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
