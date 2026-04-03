"use client";

export default function SummaryCards({
  totalStudents,
  pendingVerifications,
  studentsNeedingAttention,
  avgXp,
}: {
  totalStudents: number;
  pendingVerifications: number;
  studentsNeedingAttention: number;
  avgXp: number;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="surface-section p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          Students
        </p>
        <p className="mt-3 text-3xl font-bold text-[var(--ink-strong)]">
          {totalStudents}
        </p>
      </div>
      <div className="surface-section p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          Pending Verifications
        </p>
        <p className="mt-3 text-3xl font-bold text-orange-600">
          {pendingVerifications}
        </p>
      </div>
      <div className="surface-section p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          Need Attention
        </p>
        <p className="mt-3 text-3xl font-bold text-rose-600">
          {studentsNeedingAttention}
        </p>
      </div>
      <div className="surface-section p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          Average XP
        </p>
        <p className="mt-3 text-3xl font-bold text-blue-600">{avgXp}</p>
      </div>
    </div>
  );
}
