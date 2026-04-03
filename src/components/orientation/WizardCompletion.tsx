"use client";

import { useRouter } from "next/navigation";

interface CompletedForm {
  title: string;
  type: "signed" | "acknowledged" | "read";
}

interface WizardCompletionProps {
  completedForms: CompletedForm[];
}

export default function WizardCompletion({ completedForms }: WizardCompletionProps) {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-xl text-center">
      <div className="text-5xl mb-4">🎉</div>
      <h2 className="font-display text-2xl font-bold text-emerald-700">
        Orientation Complete!
      </h2>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        You signed all your documents and earned{" "}
        <span className="font-bold text-amber-500">75 XP</span>
      </p>

      <div className="mt-6 rounded-2xl border border-[rgba(16,37,62,0.08)] bg-[rgba(16,37,62,0.02)] p-5 text-left">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--ink-muted)] mb-3">
          Documents Completed
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {completedForms.map((form) => (
            <div key={form.title} className="flex items-center gap-2 text-sm text-emerald-700">
              <span className="text-emerald-500">✓</span>
              <span className="truncate">{form.title}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-[var(--ink-faint)]">
        This page will be removed from your menu.
      </p>

      <button
        type="button"
        onClick={() => router.push("/dashboard")}
        className="primary-button mt-6 px-8 py-3 text-sm"
      >
        Go to Dashboard →
      </button>
    </div>
  );
}
