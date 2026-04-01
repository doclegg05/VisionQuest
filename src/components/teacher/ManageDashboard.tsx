"use client";

import { useMemo, useState } from "react";
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

type Tab =
  | "orientation"
  | "spokes"
  | "lms"
  | "certifications"
  | "advising"
  | "career"
  | "reports"
  | "audit"
  | "documents";

interface ManageDashboardProps {
  canViewAudit: boolean;
}

const BASE_TABS: Array<{ key: Exclude<Tab, "audit">; label: string }> = [
  { key: "orientation", label: "Orientation" },
  { key: "spokes", label: "SPOKES" },
  { key: "lms", label: "Courses" },
  { key: "certifications", label: "Certifications" },
  { key: "advising", label: "Advising" },
  { key: "career", label: "Career" },
  { key: "reports", label: "Reports" },
  { key: "documents", label: "Documents" },
];

export default function ManageDashboard({ canViewAudit }: ManageDashboardProps) {
  const [tab, setTab] = useState<Tab>("orientation");
  const tabs = useMemo<Array<{ key: Tab; label: string }>>(() => {
    if (!canViewAudit) {
      return BASE_TABS;
    }

    return [
      ...BASE_TABS.slice(0, 7),
      { key: "audit", label: "Audit Trail" },
      ...BASE_TABS.slice(7),
    ];
  }, [canViewAudit]);

  return (
    <div>
      <div className="mb-6 flex gap-1 rounded-xl bg-gray-100 p-1">
        {tabs.map((tabOption) => (
          <button
            key={tabOption.key}
            onClick={() => setTab(tabOption.key)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === tabOption.key
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tabOption.label}
          </button>
        ))}
      </div>

      {tab === "orientation" && <OrientationManager />}
      {tab === "spokes" && <SpokesManager />}
      {tab === "lms" && <LmsManager />}
      {tab === "certifications" && <CertManager />}
      {tab === "advising" && <AdvisingManager />}
      {tab === "career" && <CareerManager />}
      {tab === "reports" && (
        <div className="space-y-8">
          <GrantKpiReport />
          <OutcomesReport />
          <SpokesReport />
          <AcademicKpiReport />
        </div>
      )}
      {canViewAudit && tab === "audit" && <AuditTrail />}
      {tab === "documents" && <DocumentBrowser />}
    </div>
  );
}
