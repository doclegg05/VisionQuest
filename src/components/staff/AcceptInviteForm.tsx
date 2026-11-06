"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { runOnce } from "./CancelInviteButton";
import { FIELD_CLASS, LABEL_CLASS } from "./fieldStyles";

interface AcceptInviteFormProps {
  token: string;
  /** The invite was emailed, so the person needs the 6-digit email code (Ruling R21). */
  needsCode: boolean;
}

interface SendCodeButtonViewProps {
  pending: boolean;
  sent: boolean;
  onClick: () => void;
}

export function SendCodeButtonView({ pending, sent, onClick }: SendCodeButtonViewProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-busy={pending}
      className="secondary-button min-h-11 w-full px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Sending…" : sent ? "Send a new code" : "Send my code"}
    </button>
  );
}

interface InviteCodeStepProps {
  token: string;
  code: string;
  onCodeChange: (code: string) => void;
}

/**
 * Sends the code and takes it. Each tap emails a new code and voids the last,
 * so the button has a ref guard as well as its disabled state (MEMORY Known
 * Issues: repeat taps). The route answers the same for every token.
 */
function InviteCodeStep({ token, code, onCodeChange }: InviteCodeStepProps) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function handleSend() {
    void runOnce(inFlight, async () => {
      setPending(true);
      setError("");
      try {
        await api.post("/api/staff-invites/accept/code", { token });
        setSent(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "We could not send the code. Please try again.");
      } finally {
        setPending(false);
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--ink-strong)]">We will email a 6-digit code to the address on this invite.</p>
      <SendCodeButtonView pending={pending} sent={sent} onClick={handleSend} />
      {sent && <p role="status" className="text-sm text-[var(--ink-muted)]">We sent a code. Check your email.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div>
        <label htmlFor="accept-code" className={LABEL_CLASS}>6-digit code</label>
        <input id="accept-code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
          maxLength={6} value={code} onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, ""))}
          className={FIELD_CLASS} />
      </div>
    </div>
  );
}

/**
 * The person types the email the invite was sent to; it is never pre-filled
 * (Ruling R18). Until Phase 2 ties an invite to a work account, the link is a
 * bearer link, and printing the address would hand it to whoever holds it.
 * An emailed invite also needs the code sent to that address (Ruling R21).
 */
export function AcceptInviteForm({ token, needsCode }: AcceptInviteFormProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const res = await api.post<{ data: { redirectTo: string } }>("/api/staff-invites/accept", {
        token,
        email,
        displayName,
        password,
        ...(needsCode ? { code } : {}),
      });
      router.replace(res.data.redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not set up your account. Please try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {needsCode && <InviteCodeStep token={token} code={code} onCodeChange={setCode} />}
      <div>
        <label htmlFor="accept-name" className={LABEL_CLASS}>Your name</label>
        <input id="accept-name" required maxLength={100} autoComplete="name" value={displayName}
          onChange={(e) => setDisplayName(e.target.value)} className={FIELD_CLASS} />
      </div>
      <div>
        <label htmlFor="accept-email" className={LABEL_CLASS}>Email address</label>
        <input id="accept-email" type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} className={FIELD_CLASS} />
      </div>
      <div>
        <label htmlFor="accept-password" className={LABEL_CLASS}>Password</label>
        <input id="accept-password" type="password" required minLength={12} maxLength={128}
          autoComplete="new-password" aria-describedby="accept-password-help" value={password}
          onChange={(e) => setPassword(e.target.value)} className={FIELD_CLASS} />
        <p id="accept-password-help" className="mt-1 text-xs text-[var(--ink-muted)]">Use at least 12 characters.</p>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={pending} className="primary-button min-h-11 w-full px-6 py-3 text-sm disabled:opacity-50">
        {pending ? "Setting up…" : "Create my account"}
      </button>
    </form>
  );
}
