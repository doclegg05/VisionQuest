"use client";

import { useState } from "react";
import OrientationManager from "./OrientationManager";
import LmsManager from "./LmsManager";
import CertManager from "./CertManager";
import AuditTrail from "./AuditTrail";
import AdvisingManager from "./AdvisingManager";
import CareerManager from "./CareerManager";
import OutcomesReport from "./OutcomesReport";
import SpokesManager from "./SpokesManager";
import SpokesReport from "./SpokesReport";
import AcademicKpiReport from "./AcademicKpiReport";
import GrantKpiReport from "./GrantKpiReport";
import DocumentBrowser from "@/components/documents/DocumentBrowser";
import { JobConfigSection } from "./JobConfigSection";
import PathwayManager from "./PathwayManager";
import AiConfigPanel from "./AiConfigPanel";

type Tab = "orientation" | "learning" | "career" | "reports";

interface ManageDashboardProps {
  canViewAudit: boolean;
  canViewAiConfig: boolean;
}

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: "orientation", label: "Orientation", icon: "🧭" },
  { key: "learning", label: "Learning", icon: "📚" },
  { key: "career", label: "Career", icon: "💼" },
  { key: "reports", label: "Reports", icon: "📊" },
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-4 border-b border-[var(--border)] pb-2 text-lg font-semibold text-[var(--ink-strong)]">
      {children}
    </h3>
  );
}

export default function ManageDashboard({ canViewAudit, canViewAiConfig }: ManageDashboardProps) {
  const [tab, setTab] = useState<Tab>("orientation");

  return (
    <div>
      <div className="mb-6 flex gap-1 rounded-xl theme-segmented p-1">
        {TABS.map((tabOption) => (
          <button
            key={tabOption.key}
            onClick={() => setTab(tabOption.key)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === tabOption.key
                ? "bg-[var(--surface-raised)] text-[var(--ink-strong)] shadow-sm"
                : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            }`}
          >
            <span className="mr-1.5">{tabOption.icon}</span>
            {tabOption.label}
          </button>
        ))}
      </div>

      {tab === "orientation" && (
        <div className="space-y-8">
          <section>
            <SectionHeading>Orientation</SectionHeading>
            <OrientationManager />
          </section>
          <section>
            <SectionHeading>SPOKES</SectionHeading>
            <SpokesManager />
          </section>
        </div>
      )}

      {tab === "learning" && (
        <div className="space-y-8">
          <section>
            <SectionHeading>Pathways</SectionHeading>
            <PathwayManager />
          </section>
          <section>
            <SectionHeading>Courses</SectionHeading>
            <LmsManager />
          </section>
          <section>
            <SectionHeading>Certifications</SectionHeading>
            <CertManager />
          </section>
          <section>
            <SectionHeading>Documents</SectionHeading>
            <DocumentBrowser />
          </section>
        </div>
      )}

      {tab === "career" && (
        <div className="space-y-8">
          <section>
            <SectionHeading>Career</SectionHeading>
            <CareerManager />
          </section>
          <section>
            <SectionHeading>Advising</SectionHeading>
            <AdvisingManager />
          </section>
          <section>
            <SectionHeading>Job Board</SectionHeading>
            <JobConfigSection />
          </section>
        </div>
      )}

      {tab === "reports" && (
        <div className="space-y-8">
          <section>
            <SectionHeading>Outcomes Report</SectionHeading>
            <OutcomesReport />
          </section>
          <section>
            <SectionHeading>SPOKES Report</SectionHeading>
            <SpokesReport />
          </section>
          <section>
            <SectionHeading>Academic KPI Report</SectionHeading>
            <AcademicKpiReport />
          </section>
          <section>
            <SectionHeading>Grant KPI Report</SectionHeading>
            <GrantKpiReport />
          </section>
          {canViewAiConfig && (
            <section>
              <SectionHeading>AI Configuration</SectionHeading>
              <AiConfigPanel />
            </section>
          )}
          {canViewAudit && (
            <section>
              <SectionHeading>Audit Trail</SectionHeading>
              <AuditTrail />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
