"use client";

import { Users, CheckCircle, WarningCircle, Sparkle } from "@phosphor-icons/react";

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
      {/* Total Students Card */}
      <div className="surface-section relative overflow-hidden rounded-2xl border border-[var(--border)] border-t-4 border-t-sky-500 p-5 shadow-sm transition-all hover:shadow-md">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-strong)]">
            Enrolled Students
          </p>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            <Users size={18} weight="bold" />
          </div>
        </div>
        <p className="mt-3 text-3xl font-extrabold text-[var(--ink-strong)]">
          {totalStudents}
        </p>
        <p className="mt-1 text-xs font-semibold text-sky-700 dark:text-sky-400">
          Active classroom roster
        </p>
      </div>

      {/* Pending Verifications Card */}
      <div className="surface-section relative overflow-hidden rounded-2xl border border-[var(--border)] border-t-4 border-t-amber-500 p-5 shadow-sm transition-all hover:shadow-md">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-strong)]">
            Pending Verifications
          </p>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <CheckCircle size={18} weight="bold" />
          </div>
        </div>
        <p className="mt-3 text-3xl font-extrabold text-amber-700 dark:text-amber-400">
          {pendingVerifications}
        </p>
        <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
          Certificates awaiting review
        </p>
      </div>

      {/* Need Attention Card */}
      <div className="surface-section relative overflow-hidden rounded-2xl border border-[var(--border)] border-t-4 border-t-rose-500 p-5 shadow-sm transition-all hover:shadow-md">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-strong)]">
            Needs Attention
          </p>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            <WarningCircle size={18} weight="bold" />
          </div>
        </div>
        <p className="mt-3 text-3xl font-extrabold text-rose-700 dark:text-rose-400">
          {studentsNeedingAttention}
        </p>
        <p className="mt-1 text-xs font-semibold text-rose-700 dark:text-rose-400">
          Urgent or inactive students
        </p>
      </div>

      {/* Average XP Card */}
      <div className="surface-section relative overflow-hidden rounded-2xl border border-[var(--border)] border-t-4 border-t-indigo-500 p-5 shadow-sm transition-all hover:shadow-md">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-strong)]">
            Average Experience
          </p>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            <Sparkle size={18} weight="bold" />
          </div>
        </div>
        <p className="mt-3 text-3xl font-extrabold text-indigo-700 dark:text-indigo-400">
          {avgXp} <span className="text-base font-bold text-[var(--ink-muted)]">XP</span>
        </p>
        <p className="mt-1 text-xs font-semibold text-indigo-700 dark:text-indigo-400">
          Cohort engagement score
        </p>
      </div>
    </div>
  );
}
