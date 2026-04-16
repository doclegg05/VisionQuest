"use client";

import { useState } from "react";
import PortfolioGrid from "./PortfolioGrid";
import ResumeBuilder from "./ResumeBuilder";
import CredentialSharePanel from "@/components/certifications/CredentialSharePanel";
import CredlyBadges from "@/components/certifications/CredlyBadges";

type Tab = "portfolio" | "resume" | "sharing";

export default function PortfolioPage() {
  const [tab, setTab] = useState<Tab>("portfolio");

  return (
    <div>
      <div className="mb-6 grid grid-cols-3 gap-2 rounded-2xl bg-[var(--surface-muted)] p-1.5">
        <button
          onClick={() => setTab("portfolio")}
          type="button"
          className={`rounded-[1rem] py-3 text-sm font-semibold transition-colors ${
            tab === "portfolio"
              ? "bg-[var(--surface-raised)] text-[var(--ink-strong)] shadow-[var(--shadow-card)]"
              : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
          }`}
        >
          Portfolio Items
        </button>
        <button
          onClick={() => setTab("resume")}
          type="button"
          className={`rounded-[1rem] py-3 text-sm font-semibold transition-colors ${
            tab === "resume"
              ? "bg-[var(--surface-raised)] text-[var(--ink-strong)] shadow-[var(--shadow-card)]"
              : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
          }`}
        >
          Resume Builder
        </button>
        <button
          onClick={() => setTab("sharing")}
          type="button"
          className={`rounded-[1rem] py-3 text-sm font-semibold transition-colors ${
            tab === "sharing"
              ? "bg-[var(--surface-raised)] text-[var(--ink-strong)] shadow-[var(--shadow-card)]"
              : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
          }`}
        >
          Shareable Proof
        </button>
      </div>

      {tab === "portfolio"
        ? <PortfolioGrid />
        : tab === "resume"
          ? <ResumeBuilder />
          : (
            <div className="space-y-6">
              <CredentialSharePanel />
              <CredlyBadges />
            </div>
          )}
    </div>
  );
}
