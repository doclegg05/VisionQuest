"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { FIELD_CLASS, LABEL_CLASS } from "./fieldStyles";

interface AcceptInviteFormProps {
  token: string;
}

/**
 * The person types the email the invite was sent to; it is never pre-filled
 * (Ruling R18). Until Phase 2 ties an invite to a work account, the link is a
 * bearer link, and printing the address would hand it to whoever holds it.
 */
export function AcceptInviteForm({ token }: AcceptInviteFormProps) {
  const router = useRouter();
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
