"use client";

import { useEffect } from "react";

/**
 * Watches the URL hash and switches the active StudentDetail tab when the
 * hash targets a section that lives on a different tab. Then scrolls the
 * target into view. Handles both the first-load case (hash already in URL)
 * and runtime navigation via hashchange events.
 *
 * Pass an anchor→tab map keyed by DOM `id`; keys should NOT include the
 * leading "#".
 */
export function useAnchorTabSwitch<TabKey extends string>({
  anchorToTab,
  activeTab,
  setTab,
}: {
  anchorToTab: Record<string, TabKey>;
  activeTab: TabKey;
  setTab: (tab: TabKey) => void;
}): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    function handleHash() {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash) return;
      const targetTab = anchorToTab[hash];
      if (!targetTab || targetTab === activeTab) {
        const el = document.getElementById(hash);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      setTab(targetTab);
      // Wait a frame for the tab content to render before scrolling.
      requestAnimationFrame(() => {
        const el = document.getElementById(hash);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, [anchorToTab, activeTab, setTab]);
}

/**
 * Pure resolver used by both the hook and by unit tests.
 * Returns the tab that owns the given anchor, or null if no mapping.
 */
export function resolveTabForAnchor<TabKey extends string>(
  anchor: string,
  anchorToTab: Record<string, TabKey>,
): TabKey | null {
  const key = anchor.replace(/^#/, "");
  return anchorToTab[key] ?? null;
}
