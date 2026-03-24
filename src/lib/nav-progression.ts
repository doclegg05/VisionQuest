export type NavPhase = 1 | 2 | 3;

export interface NavProgressionState {
  hasGoals: boolean;
  orientationStarted: boolean;
  orientationComplete: boolean;
}

export function computeNavPhase(state: NavProgressionState): NavPhase {
  if (state.hasGoals && state.orientationComplete) return 3;
  if (state.orientationStarted) return 2;
  return 1;
}

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  phase: NavPhase;
}

export const STUDENT_NAV_ITEMS: NavItem[] = [
  { href: "/chat", label: "Sage", icon: "💬", phase: 1 },
  { href: "/dashboard", label: "Dashboard", icon: "📊", phase: 1 },
  { href: "/goals", label: "Goals", icon: "🎯", phase: 1 },
  { href: "/orientation", label: "Orientation", icon: "📋", phase: 1 },
  { href: "/learning", label: "Learning", icon: "📚", phase: 2 },
  { href: "/portfolio", label: "Portfolio", icon: "💼", phase: 2 },
  { href: "/career", label: "Career", icon: "🚀", phase: 3 },
  { href: "/appointments", label: "Advising", icon: "🗓️", phase: 3 },
  { href: "/settings", label: "Settings", icon: "⚙️", phase: 3 },
];

export function getVisibleNavItems(phase: NavPhase): NavItem[] {
  return STUDENT_NAV_ITEMS.filter((item) => item.phase <= phase);
}
