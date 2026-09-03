"use client";

import { useState } from "react";
import {
  ChatCircleText,
  ChartLineUp,
  FileText,
  Gear,
} from "@phosphor-icons/react";

import {
  STUDENT_DETAIL_ANCHOR_TO_TAB,
  useAnchorTabSwitch,
} from "./useAnchorTabSwitch";

export type StudentDetailTabKey = "coach" | "progress" | "forms" | "admin";

interface TabDef {
  key: StudentDetailTabKey;
  label: string;
  icon: typeof ChatCircleText;
}

const TABS: TabDef[] = [
  { key: "coach", label: "Coaching & Goals", icon: ChatCircleText },
  { key: "progress", label: "Progress & Outcomes", icon: ChartLineUp },
  { key: "forms", label: "Forms & Documents", icon: FileText },
  { key: "admin", label: "Account & Settings", icon: Gear },
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
      <div className="mb-6 flex flex-wrap sm:flex-nowrap gap-2 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-muted)] p-1.5 shadow-sm">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;

          // Distinct vibrant active styles for maximum visual clarity
          const activeStyle =
            tab.key === "coach"
              ? "bg-sky-600 text-white shadow-md shadow-sky-600/20"
              : tab.key === "progress"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                : tab.key === "forms"
                  ? "bg-amber-600 text-white shadow-md shadow-amber-600/20"
                  : "bg-slate-800 text-white shadow-md shadow-slate-800/20 dark:bg-slate-700";

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveTab(tab.key);
                if (typeof window !== "undefined" && window.location.hash) {
                  window.history.replaceState(null, "", window.location.pathname + window.location.search);
                }
              }}
              className={`group flex min-h-12 flex-1 items-center justify-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-150 cursor-pointer active:scale-[0.98] ${
                isActive
                  ? activeStyle
                  : "bg-[var(--surface-raised)] text-[var(--ink-strong)] border border-[var(--border)] hover:bg-[var(--surface-base)] hover:border-[var(--border-strong)] hover:shadow-sm"
              }`}
            >
              <Icon
                size={20}
                weight={isActive ? "fill" : "bold"}
                className={isActive ? "text-white" : "text-[var(--ink-muted)] group-hover:text-[var(--ink-strong)]"}
              />
              <span className="tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div>{children[activeTab]}</div>
    </div>
  );
}
