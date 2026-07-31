"use client";

import { type KeyboardEvent, useState } from "react";
import PortfolioGrid from "./PortfolioGrid";
import ResumeBuilder from "./ResumeBuilder";
import CredentialSharePanel from "@/components/certifications/CredentialSharePanel";
import CredlyBadges from "@/components/certifications/CredlyBadges";

type Tab = "portfolio" | "resume" | "sharing";

const TABS: { key: Tab; label: string }[] = [
  { key: "portfolio", label: "Portfolio Items" },
  { key: "resume", label: "Resume Builder" },
  { key: "sharing", label: "Shareable Proof" },
];

export default function PortfolioPage() {
  const [tab, setTab] = useState<Tab>("portfolio");

  function selectAdjacentTab(event: KeyboardEvent<HTMLButtonElement>, currentTab: Tab) {
    const currentIndex = TABS.findIndex((item) => item.key === currentTab);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = TABS[nextIndex].key;
    setTab(nextTab);
    document.getElementById(`portfolio-tab-${nextTab}`)?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Portfolio sections"
        className="mb-6 grid grid-cols-3 gap-2 rounded-2xl bg-[var(--surface-muted)] p-1.5"
      >
        {TABS.map((item) => (
          <button
            key={item.key}
            id={`portfolio-tab-${item.key}`}
            role="tab"
            aria-selected={tab === item.key}
            aria-controls="portfolio-tabpanel"
            tabIndex={tab === item.key ? 0 : -1}
            onClick={() => setTab(item.key)}
            onKeyDown={(event) => selectAdjacentTab(event, item.key)}
            type="button"
            className={`min-h-11 rounded-[1rem] px-2 py-3 text-sm font-semibold transition-colors ${
              tab === item.key
                ? "bg-[var(--surface-raised)] text-[var(--ink-strong)] shadow-[var(--shadow-card)]"
                : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id="portfolio-tabpanel"
        role="tabpanel"
        aria-labelledby={`portfolio-tab-${tab}`}
      >
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
    </div>
  );
}
