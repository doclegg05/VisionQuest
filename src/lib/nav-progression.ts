import type { Icon } from "@phosphor-icons/react";

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
  icon: Icon;
  phase: NavPhase;
}
