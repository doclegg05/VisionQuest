import {
  House,
  Target,
  ClipboardText,
  BookOpen,
  Briefcase,
  Rocket,
  Newspaper,
  CalendarDots,
  ImageSquare,
  FolderOpen,
} from "@phosphor-icons/react";
import type { NavItem, NavPhase } from "./nav-progression";

export const STUDENT_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: House, phase: 1 },
  { href: "/goals", label: "Goals", icon: Target, phase: 1 },
  { href: "/orientation", label: "Orientation", icon: ClipboardText, phase: 1 },
  { href: "/learning", label: "Learning", icon: BookOpen, phase: 1 },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase, phase: 2 },
  { href: "/career", label: "Career", icon: Rocket, phase: 3 },
  { href: "/jobs", label: "Jobs", icon: Newspaper, phase: 3 },
  { href: "/appointments", label: "Advising", icon: CalendarDots, phase: 3 },
];

export const STUDENT_SECONDARY_NAV: NavItem[] = [
  { href: "/vision-board", label: "Vision Board", icon: ImageSquare, phase: 1 },
  { href: "/files", label: "Files", icon: FolderOpen, phase: 1 },
  { href: "/resources", label: "Resources", icon: Newspaper, phase: 1 },
];

export function getVisibleNavItems(phase: NavPhase, orientationComplete?: boolean): NavItem[] {
  return STUDENT_NAV_ITEMS.filter((item) => {
    if (item.phase > phase) return false;
    if (orientationComplete && item.href === "/orientation") return false;
    return true;
  });
}

export function getVisibleSecondaryNavItems(phase: NavPhase): NavItem[] {
  return STUDENT_SECONDARY_NAV.filter((item) => item.phase <= phase);
}
