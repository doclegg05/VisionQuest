"use client";

import { useState } from "react";
import {
  ChatCircleText,
  ChartLineUp,
  Gear,
} from "@phosphor-icons/react";

import { useAnchorTabSwitch } from "./useAnchorTabSwitch";

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

/**
 * Maps DOM anchor ids used across StudentDetail to their owning tab.
 * Keep this list small and accurate — anything missing falls through
 * to a silent no-op, so broken cross-tab links will just look like
 * scroll-not-working rather than jumping to the wrong tab.
 */
const ANCHOR_TO_TAB: Record<string, StudentDetailTabKey> = {
  // Coach tab anchors
  "goal-evidence": "coach",
  "review-queue": "coach",
  "case-notes": "coach",
  "follow-up-tasks": "coach",
  "appointments": "coach",
  "alerts": "coach",
  "goals-plan": "coach",
  // Progress tab anchors
  "orientation": "progress",
  "certification-review": "progress",
  "portfolio": "progress",
  "files": "progress",
  "conversations": "progress",
  "career-discovery": "progress",
  // Admin tab anchors
  "submitted-forms": "admin",
  "account-actions": "admin",
};

interface StudentDetailTabsProps {
  studentId: string;
  studentName: string;
  children: Record<StudentDetailTabKey, React.ReactNode>;
}

export default function StudentDetailTabs({ children }: StudentDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<StudentDetailTabKey>("coach");

  useAnchorTabSwitch({
    anchorToTab: ANCHOR_TO_TAB,
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
