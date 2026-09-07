"use client";

import { type KeyboardEvent, useState } from "react";
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

const TABPANEL_ID = "student-detail-tabpanel";

interface StudentDetailTabsProps {
  studentId: string;
  studentName: string;
  children: Record<StudentDetailTabKey, React.ReactNode>;
}

/**
 * D4 (2026-09-07): copies the ARIA tablist pattern already shipped on the
 * student-side PortfolioPage (grep `role="tablist"`) — role/aria-selected/
 * aria-controls/role="tabpanel"/roving tabIndex + arrow-key navigation.
 * useAnchorTabSwitch's activeTab/setTab plumbing is untouched, so the anchor
 * map in useAnchorTabSwitch.ts still resolves the same way.
 */
export default function StudentDetailTabs({ children }: StudentDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<StudentDetailTabKey>("coach");

  useAnchorTabSwitch({
    anchorToTab: STUDENT_DETAIL_ANCHOR_TO_TAB,
    activeTab,
    setTab: setActiveTab,
  });

  function selectAdjacentTab(event: KeyboardEvent<HTMLButtonElement>, currentTab: StudentDetailTabKey) {
    const currentIndex = TABS.findIndex((tab) => tab.key === currentTab);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = TABS[nextIndex].key;
    setActiveTab(nextTab);
    document.getElementById(`student-detail-tab-${nextTab}`)?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Student sections"
        className="mb-6 flex gap-1 rounded-xl theme-segmented p-1"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              id={`student-detail-tab-${tab.key}`}
              role="tab"
              aria-selected={selected}
              aria-controls={TABPANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab.key)}
              onKeyDown={(event) => selectAdjacentTab(event, tab.key)}
              type="button"
              className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                selected
                  ? "bg-[var(--surface-raised)] text-[var(--ink-strong)] shadow-sm"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
              }`}
            >
              <Icon size={18} weight={selected ? "fill" : "regular"} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div
        id={TABPANEL_ID}
        role="tabpanel"
        aria-labelledby={`student-detail-tab-${activeTab}`}
      >
        {children[activeTab]}
      </div>
    </div>
  );
}
