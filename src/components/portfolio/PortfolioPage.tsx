"use client";

import { useState } from "react";
import PortfolioGrid from "./PortfolioGrid";
import ResumeBuilder from "./ResumeBuilder";

type Tab = "portfolio" | "resume";

export default function PortfolioPage() {
  const [tab, setTab] = useState<Tab>("portfolio");

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-[rgba(16,37,62,0.06)] p-1.5">
        <button
          onClick={() => setTab("portfolio")}
          type="button"
          className={`rounded-[1rem] py-3 text-sm font-semibold transition-colors ${
            tab === "portfolio"
              ? "bg-white text-[var(--ink-strong)] shadow-[0_14px_34px_rgba(16,37,62,0.08)]"
              : "text-[var(--muted)] hover:text-[var(--ink-strong)]"
          }`}
        >
          Portfolio Items
        </button>
        <button
          onClick={() => setTab("resume")}
          type="button"
          className={`rounded-[1rem] py-3 text-sm font-semibold transition-colors ${
            tab === "resume"
              ? "bg-white text-[var(--ink-strong)] shadow-[0_14px_34px_rgba(16,37,62,0.08)]"
              : "text-[var(--muted)] hover:text-[var(--ink-strong)]"
          }`}
        >
          Resume Builder
        </button>
      </div>

      {tab === "portfolio" ? <PortfolioGrid /> : <ResumeBuilder />}
    </div>
  );
}
