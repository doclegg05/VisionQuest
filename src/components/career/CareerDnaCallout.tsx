import Link from "next/link";
import { CaretDown, Compass, Sparkle } from "@phosphor-icons/react/dist/ssr";

import { CareerProfile } from "@/components/career/CareerProfile";
import { SkillGapBridge } from "@/components/career/SkillGapBridge";
import { getCareerDiscovery } from "@/lib/career-discovery";
import { analyzeSkillGaps } from "@/lib/sage/skill-gap";

interface CareerDnaCalloutProps {
  studentId: string;
}

export default async function CareerDnaCallout({ studentId }: CareerDnaCalloutProps) {
  const discovery = await getCareerDiscovery(studentId);
  const isComplete = discovery?.status === "complete";
  const skillGapAnalysis = isComplete ? await analyzeSkillGaps(studentId) : null;
  const statusLabel = isComplete ? "Ready" : discovery ? "In progress" : "Not started";
  const actionHref = isComplete ? "/chat?stage=career_profile_review" : "/chat?stage=discovery";
  const actionLabel = isComplete
    ? "Discuss with Sage"
    : discovery
      ? "Continue with Sage"
      : "Start with Sage";

  return (
    <section id="career-dna" className="scroll-mt-28 space-y-4">
      <aside className="surface-section p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-green)] text-white">
              {isComplete ? (
                <Sparkle size={22} weight="fill" />
              ) : (
                <Compass size={22} weight="duotone" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-bold text-[var(--ink-strong)]">
                  Career DNA
                </h2>
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  {statusLabel}
                </span>
              </div>
              <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
                {isComplete
                  ? "Your interests, strengths, values, and career matches live here in Career."
                  : "Let Sage learn about your interests, strengths, and work values so jobs and next steps can fit you better."}
              </p>
              {discovery?.sageSummary ? (
                <p className="mt-3 rounded-[1rem] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[var(--ink-strong)]">
                  {discovery.sageSummary}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
            <Link
              href={actionHref}
              prefetch={false}
              className="primary-button inline-flex min-h-11 items-center justify-center px-4 py-2 text-sm"
            >
              {actionLabel}
            </Link>
            <Link
              href="/career/profile"
              prefetch={false}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2 text-sm font-bold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-interactive)]"
            >
              View Career DNA
            </Link>
          </div>
        </div>
      </aside>

      {isComplete && discovery ? (
        <details className="surface-section overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-bold text-[var(--ink-strong)] [&::-webkit-details-marker]:hidden">
            <span>View Career DNA details</span>
            <CaretDown size={18} weight="bold" className="text-[var(--ink-muted)]" />
          </summary>
          <div className="space-y-4 border-t border-[var(--border)] p-4">
            <CareerProfile discovery={discovery} />
            <SkillGapBridge analysis={skillGapAnalysis} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
