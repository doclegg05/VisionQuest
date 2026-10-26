import type { StudentOverview } from "@/lib/teacher/dashboard";

const INTAKE_BADGE: Record<StudentOverview["intakeStatus"], { label: string; className: string }> = {
  certified: {
    label: "Certified intake",
    className: "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]",
  },
  needs_review: {
    label: "Needs sign-off",
    className: "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]",
  },
  missing: {
    label: "Missing intake",
    className: "bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]",
  },
};

/** The student's intake packet compliance, as a theme-token badge. */
export function IntakeStatusBadge({ status }: { status: StudentOverview["intakeStatus"] }) {
  const badge = INTAKE_BADGE[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}>
      {badge.label}
    </span>
  );
}
