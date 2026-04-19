import { Briefcase, GraduationCap, Wrench } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";

import {
  PROGRAM_FULL_NAMES,
  PROGRAM_LABELS,
  type ProgramType,
} from "@/lib/program-type";

const PROGRAM_ICONS: Record<ProgramType, Icon> = {
  spokes: Briefcase,
  adult_ed: GraduationCap,
  ietp: Wrench,
};

const PROGRAM_COLOR_CLASSES: Record<ProgramType, string> = {
  spokes: "bg-[var(--program-spokes-bg)] text-[var(--program-spokes-text)]",
  adult_ed: "bg-[var(--program-ae-bg)] text-[var(--program-ae-text)]",
  ietp: "bg-[var(--program-ietp-bg)] text-[var(--program-ietp-text)]",
};

const SIZE_CLASSES = {
  sm: {
    container: "px-1.5 py-0.5 text-[0.65rem] gap-1",
    icon: 12,
  },
  md: {
    container: "px-2 py-0.5 text-xs gap-1",
    icon: 14,
  },
} as const;

interface ProgramBadgeProps {
  programType: ProgramType;
  size?: "sm" | "md";
  className?: string;
}

export default function ProgramBadge({
  programType,
  size = "md",
  className = "",
}: ProgramBadgeProps) {
  const IconComponent = PROGRAM_ICONS[programType];
  const sizeClasses = SIZE_CLASSES[size];
  const colorClasses = PROGRAM_COLOR_CLASSES[programType];
  const label = PROGRAM_LABELS[programType];
  const fullName = PROGRAM_FULL_NAMES[programType];

  return (
    <span
      role="status"
      aria-label={`Program: ${fullName}`}
      className={`inline-flex items-center rounded-full font-semibold leading-none ${colorClasses} ${sizeClasses.container} ${className}`.trim()}
    >
      <IconComponent size={sizeClasses.icon} weight="duotone" className="shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/**
 * Compact, icon-only variant for tight layouts (dense roster rows, small meta lines).
 * The visible icon is decorative; the program name is conveyed via aria-label.
 */
export function ProgramBadgeCompact({
  programType,
  className = "",
}: Omit<ProgramBadgeProps, "size">) {
  const IconComponent = PROGRAM_ICONS[programType];
  const colorClasses = PROGRAM_COLOR_CLASSES[programType];
  const fullName = PROGRAM_FULL_NAMES[programType];

  return (
    <span
      role="status"
      aria-label={`Program: ${fullName}`}
      title={fullName}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${colorClasses} ${className}`.trim()}
    >
      <IconComponent size={14} weight="duotone" aria-hidden="true" />
    </span>
  );
}
