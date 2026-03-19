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
import DocumentBrowser from "@/components/documents/DocumentBrowser";

type Tab = "orientation" | "spokes" | "lms" | "certifications" | "advising" | "career" | "reports" | "audit" | "documents";

const TABS: { key: Tab; label: string }[] = [
  { key: "orientation", label: "Orientation" },
  { key: "spokes", label: "SPOKES" },
  { key: "lms", label: "Courses" },
  { key: "certifications", label: "Certifications" },
  { key: "advising", label: "Advising" },
  { key: "career", label: "Career" },
  { key: "reports", label: "Reports" },
  { key: "audit", label: "Audit Trail" },
  { key: "documents", label: "Documents" },
];

export default function ManageDashboard() {
  const [tab, setTab] = useState<Tab>("orientation");

  return (
    <div>
      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === t.key
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
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
          <OutcomesReport />
          <SpokesReport />
        </div>
      )}
      {tab === "audit" && <AuditTrail />}
      {tab === "documents" && <DocumentBrowser />}
    </div>
  );
}
