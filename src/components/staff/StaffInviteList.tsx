"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { StaffInviteRow } from "@/lib/staff-invite-list";
import { STAFF_ROLE_LABELS } from "@/lib/staff-invite-messages";
import { CancelInviteButton } from "./CancelInviteButton";

interface StaffInviteListProps {
  refreshKey: number;
}

export function StaffInviteList({ refreshKey }: StaffInviteListProps) {
  const [invites, setInvites] = useState<StaffInviteRow[] | null>(null);
  const [error, setError] = useState("");

  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ data: { invites: StaffInviteRow[] } }>("/api/staff-invites")
      .then((res) => {
        if (cancelled) return;
        setInvites(res.data.invites.filter((invite) => invite.status === "pending"));
        setError("");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "We could not load the invites.");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, reloads]);

  async function revoke(id: string) {
    try {
      await api.del(`/api/staff-invites/${id}`);
      setReloads((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not cancel that invite.");
    }
  }

  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!invites) return <p className="text-sm text-[var(--ink-muted)]">Loading invites…</p>;
  if (invites.length === 0) return <p className="text-sm text-[var(--ink-muted)]">No open invites.</p>;

  return (
    <ul className="divide-y divide-[var(--border)]">
      {invites.map((invite) => (
        <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <p className="text-sm font-semibold text-[var(--ink-strong)]">{invite.email}</p>
            <p className="text-xs text-[var(--ink-muted)]">
              {STAFF_ROLE_LABELS[invite.role] ?? invite.role}
              {invite.regionName ? `, ${invite.regionName}` : ""}
            </p>
          </div>
          <CancelInviteButton onCancel={() => revoke(invite.id)} />
        </li>
      ))}
    </ul>
  );
}
