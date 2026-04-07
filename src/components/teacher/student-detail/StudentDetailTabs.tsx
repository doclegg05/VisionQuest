"use client";

import { useState } from "react";
import {
  UserCircle,
  Target,
  ChartLineUp,
  Clipboard,
} from "@phosphor-icons/react";

type TabKey = "overview" | "goals" | "progress" | "operations";

interface TabDef {
  key: TabKey;
  label: string;
  icon: typeof UserCircle;
}

const TABS: TabDef[] = [
  { key: "overview", label: "Overview", icon: UserCircle },
  { key: "goals", label: "Goals & Plan", icon: Target },
  { key: "progress", label: "Progress", icon: ChartLineUp },
  { key: "operations", label: "Operations", icon: Clipboard },
];

interface StudentDetailTabsProps {
  studentId: string;
  studentName: string;
  children: Record<TabKey, React.ReactNode>;
}

export default function StudentDetailTabs({
  children,
}: StudentDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  return (
    <div>
      <div className="mb-6 flex gap-1 rounded-xl theme-segmented p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-[var(--surface-raised)] text-[var(--ink-strong)] shadow-sm"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
              }`}
            >
              <Icon size={18} weight={activeTab === tab.key ? "fill" : "regular"} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div>{children[activeTab]}</div>
    </div>
  );
}
