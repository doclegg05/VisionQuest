import {
  House,
  Target,
  BookOpen,
  Briefcase,
  Rocket,
  CalendarDots,
  ImageSquare,
  FolderOpen,
  ClipboardText,
} from "@phosphor-icons/react";
import type { NavItem, NavPhase } from "./nav-progression";

export const STUDENT_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: House, phase: 1 },
  { href: "/goals", label: "Goals", icon: Target, phase: 1 },
  { href: "/learning", label: "Learning", icon: BookOpen, phase: 1 },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase, phase: 2 },
  { href: "/career", label: "Career", icon: Rocket, phase: 3 },
  { href: "/appointments", label: "Advising", icon: CalendarDots, phase: 3 },
];

// Phase 4 chat-first consolidation (user-approved 2026-06-09, supersedes the
// 2026-04-01 retention decision): Resources lives inside Learning now; Files
// is presented as "Documents" (Sage files chat uploads there); Orientation
// returns AFTER completion as a read-only archive of signed documents.
export const STUDENT_SECONDARY_NAV: NavItem[] = [
  { href: "/vision-board", label: "Vision Board", icon: ImageSquare, phase: 1 },
  { href: "/files", label: "Documents", icon: FolderOpen, phase: 1 },
];

const ORIENTATION_ARCHIVE_ITEM: NavItem = {
  href: "/orientation",
  label: "Orientation",
  icon: ClipboardText,
  phase: 1,
};

export function getVisibleNavItems(
  phase: NavPhase,
  orientationComplete?: boolean,
): NavItem[] {
  return STUDENT_NAV_ITEMS.filter((item) => {
    if (item.phase > phase) return false;
    if (orientationComplete && item.href === "/orientation") return false;
    return true;
  });
}

export function getVisibleSecondaryNavItems(
  phase: NavPhase,
  orientationComplete?: boolean,
): NavItem[] {
  const items = STUDENT_SECONDARY_NAV.filter((item) => item.phase <= phase);
  if (orientationComplete) items.push(ORIENTATION_ARCHIVE_ITEM);
  return items;
}
