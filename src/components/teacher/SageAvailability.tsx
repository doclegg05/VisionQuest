"use client";

import { useEffect, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";

export function SageAvailabilityNotice({ connected }: { connected: boolean | null }) {
  if (connected === true) return null;
  return <div role="status" className="flex items-start gap-2 rounded-xl border border-warning bg-warning-soft p-4 text-sm text-warning">
    <WarningCircle size={20} className="shrink-0" aria-hidden="true" />
    <p><strong>{connected === false ? "Sage is off right now." : "We could not check Sage's connection."}</strong>{" "}
      {connected === false ? "Students can still use their dashboard, tasks and documents. Tell your program admin." : "Try the page again. If it keeps happening, tell your program admin."}
    </p>
  </div>;
}

export function SageAvailability() {
  const [state, setState] = useState<{ connected: boolean | null } | null>(null);
  useEffect(() => {
    let active = true;
    const check = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const body = await response.json();
        if (active) setState({ connected: typeof body.sage?.connected === "boolean" ? body.sage.connected : null });
      } catch { if (active) setState({ connected: null }); }
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return state ? <SageAvailabilityNotice connected={state.connected} /> : null;
}
