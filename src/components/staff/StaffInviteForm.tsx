"use client";

import { useState } from "react";

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
  failed: "We could not send the email. Try again, or ask an admin.",
  not_configured: "Email is not set up. Copy this link and send it to the person yourself.",
};

/** What the inviter reads after a create. A failed send and email not set up read differently. */
export function inviteNotice(delivery: InviteDelivery): string {
  return NOTICES[delivery];
}

export function StaffInviteForm({ roles, regions, onCreated }: StaffInviteFormProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roles[0] ?? "teacher");
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState("");

  const needsRegion = role !== "program_coordinator";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setNotice("");
    setLink("");
    try {
      const res = await api.post<CreateResponse>("/api/staff-invites", {
        email,
        role,
        ...(needsRegion && regionId ? { regionId } : {}),
      });
      setNotice(inviteNotice(res.data.delivery));
      setLink(res.data.link ?? "");
      setEmail("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not send the invite. Please try again.");
    } finally {
      setPending(false);
    }
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
      {needsRegion && (
        <div>
          <label htmlFor="invite-region" className={LABEL_CLASS}>Region</label>
          <select
            id="invite-region"
            required
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
            className={FIELD_CLASS}
          >
            {regions.map((region) => (
              <option key={region.id} value={region.id}>{region.name}</option>
            ))}
          </select>
        </div>
      )}
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
      <button type="submit" disabled={pending} className="primary-button min-h-11 px-6 py-3 text-sm disabled:opacity-50">
        {pending ? "Sending…" : "Send invite"}
      </button>
    </form>
  );
}
