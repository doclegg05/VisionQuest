"use client";

import { useState } from "react";

import { NoRegionsHint } from "@/components/admin/NoRegionsHint";
import { pickedRegionId } from "@/components/admin/region-pick";
import { api } from "@/lib/api";
import { STAFF_ROLE_LABELS } from "@/lib/staff-invite-messages";
import { FIELD_CLASS, LABEL_CLASS } from "./fieldStyles";

export interface InviteRegionOption {
  id: string;
  name: string;
}

interface StaffInviteFormProps {
  roles: readonly string[];
  regions: readonly InviteRegionOption[];
  onCreated: () => void;
}

type InviteDelivery = "sent" | "failed" | "not_configured";

interface CreateResponse {
  data: { delivery: InviteDelivery; link?: string };
}

const NOTICES: Record<InviteDelivery, string> = {
  sent: "Invite sent.",
  // Only an admin reaches this: anyone else is refused email_required.
  failed: "We could not send the email. Copy this link and send it yourself.",
  not_configured: "Email is not set up. Copy this link and send it to the person yourself.",
};

/** What the inviter reads after a create. A failed send and email not set up read differently. */
export function inviteNotice(delivery: InviteDelivery): string {
  return NOTICES[delivery];
}

function InviteResult({ error, notice, link }: { error: string; notice: string; link: string }) {
  return (
    <>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-[var(--ink-strong)]">{notice}</p>}
      {link && (
        <input
          readOnly
          aria-label="Invite link"
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className={FIELD_CLASS}
        />
      )}
    </>
  );
}

interface InviteRegionFieldProps {
  regions: readonly InviteRegionOption[];
  regionId: string;
  onPick: (regionId: string) => void;
}

/** The Region select, or the reason there is nothing to pick yet. */
function InviteRegionField({ regions, regionId, onPick }: InviteRegionFieldProps) {
  if (regions.length === 0) {
    return (
      <div>
        <p className={LABEL_CLASS}>Region</p>
        <NoRegionsHint />
      </div>
    );
  }
  return (
    <div>
      <label htmlFor="invite-region" className={LABEL_CLASS}>Region</label>
      <select id="invite-region" required value={regionId} onChange={(e) => onPick(e.target.value)} className={FIELD_CLASS}>
        {regions.map((region) => (
          <option key={region.id} value={region.id}>{region.name}</option>
        ))}
      </select>
    </div>
  );
}

interface InviteSubmission {
  email: string;
  role: string;
  regionId: string | null;
}

/** Sends one invite at a time and keeps what the inviter reads afterwards. */
function useInviteSender(onSent: () => void) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState({ error: "", notice: "", link: "" });

  async function send(invite: InviteSubmission) {
    if (pending) return;
    setPending(true);
    setResult({ error: "", notice: "", link: "" });
    try {
      const res = await api.post<CreateResponse>("/api/staff-invites", {
        email: invite.email,
        role: invite.role,
        ...(invite.regionId ? { regionId: invite.regionId } : {}),
      });
      setResult({ error: "", notice: inviteNotice(res.data.delivery), link: res.data.link ?? "" });
      onSent();
    } catch (err) {
      const error = err instanceof Error ? err.message : "We could not send the invite. Please try again.";
      setResult({ error, notice: "", link: "" });
    } finally {
      setPending(false);
    }
  }

  return { pending, result, send };
}

export function StaffInviteForm({ roles, regions, onCreated }: StaffInviteFormProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roles[0] ?? "teacher");
  // The pick is read from the current list, so a region added after this form
  // first drew is offered without a remount.
  const [picked, setPicked] = useState("");
  const regionId = pickedRegionId(regions, picked);
  const needsRegion = role !== "program_coordinator";
  const { pending, result, send } = useInviteSender(() => {
    setEmail("");
    onCreated();
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void send({ email, role, regionId: needsRegion && regionId ? regionId : null });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="invite-email" className={LABEL_CLASS}>Email address</label>
        <input
          id="invite-email"
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={FIELD_CLASS}
        />
      </div>
      <div>
        <label htmlFor="invite-role" className={LABEL_CLASS}>Role</label>
        <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)} className={FIELD_CLASS}>
          {roles.map((value) => (
            <option key={value} value={value}>{STAFF_ROLE_LABELS[value] ?? value}</option>
          ))}
        </select>
      </div>
      {needsRegion && <InviteRegionField regions={regions} regionId={regionId} onPick={setPicked} />}
      <InviteResult {...result} />
      <button type="submit" disabled={pending || (needsRegion && !regionId)} className="primary-button min-h-11 px-6 py-3 text-sm disabled:opacity-50">
        {pending ? "Sending…" : "Send invite"}
      </button>
    </form>
  );
}
