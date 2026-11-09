"use client";

import { useState } from "react";

import { StaffInviteForm, type InviteRegionOption } from "./StaffInviteForm";
import { StaffInviteList } from "./StaffInviteList";

interface StaffInvitePanelProps {
  roles: readonly string[];
  regions: readonly InviteRegionOption[];
}

export function StaffInvitePanel({ roles, regions }: StaffInvitePanelProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <section className="theme-card space-y-5 rounded-xl p-5">
      <div>
        <h2 className="text-sm font-semibold text-[var(--ink-strong)]">Invite Staff</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          We email a link. It works for 14 days. The person sets their own name and password.
        </p>
      </div>
      <StaffInviteForm roles={roles} regions={regions} onCreated={() => setRefreshKey((n) => n + 1)} />
      <div>
        <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Open Invites</h3>
        <StaffInviteList refreshKey={refreshKey} />
      </div>
    </section>
  );
}
