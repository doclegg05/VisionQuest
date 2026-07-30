"use client";

import { useState } from "react";
import {
  ChatCircleText,
  ChartLineUp,
  Gear,
} from "@phosphor-icons/react";

import {
  STUDENT_DETAIL_ANCHOR_TO_TAB,
  useAnchorTabSwitch,
} from "./useAnchorTabSwitch";

export type StudentDetailTabKey = "coach" | "progress" | "admin";

interface TabDef {
  key: StudentDetailTabKey;
  label: string;
  icon: typeof ChatCircleText;
}

const TABS: TabDef[] = [
  { key: "coach", label: "Coach", icon: ChatCircleText },
  { key: "progress", label: "Progress", icon: ChartLineUp },
  { key: "admin", label: "Admin", icon: Gear },
];

interface StudentDetailTabsProps {
  studentId: string;
  studentName: string;
  children: Record<StudentDetailTabKey, React.ReactNode>;
}

export default function StudentDetailTabs({ children }: StudentDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<StudentDetailTabKey>("coach");

  useAnchorTabSwitch({
    anchorToTab: STUDENT_DETAIL_ANCHOR_TO_TAB,
    activeTab,
    setTab: setActiveTab,
  });

  return (
    <div>
      <div className="mb-6 flex gap-1 rounded-xl theme-segmented p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
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
