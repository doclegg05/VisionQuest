import Link from "next/link";
import { ChatCircle, CalendarDots, ArrowClockwise, Lock } from "@phosphor-icons/react/dist/ssr";
import PageIntro from "@/components/ui/PageIntro";
import AskSageLink from "@/components/sage/AskSageLink";

/**
 * The one guaranteed human exit in the app. Sage is the designed help
 * channel everywhere else, but when Sage itself is down (or the student
 * just hasn't found Sage yet), this page has to work on its own — plain
 * language, no invented contacts, only links to surfaces that really exist.
 */
export default function HelpPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Get Help"
        title="Get Help"
        description="Something not working? Here is what to do next."
      />

      <div className="surface-section p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-2xl bg-[var(--surface-raised)] text-[var(--ink-strong)]"
          >
            <ArrowClockwise size={20} weight="bold" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl text-[var(--ink-strong)]">Something won&apos;t load</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              Refresh the page first. If it still will not load, tell your teacher.
            </p>
          </div>
        </div>
      </div>

      <div className="surface-section p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-2xl bg-[var(--surface-raised)] text-[var(--ink-strong)]"
          >
            <CalendarDots size={20} weight="bold" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl text-[var(--ink-strong)]">Talk to your teacher or coach</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              You can ask your teacher in class. You can also book a time on the Advising page.
            </p>
            <Link
              href="/appointments"
              prefetch={false}
              className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-interactive)]"
            >
              Book a time on Advising →
            </Link>
          </div>
        </div>
      </div>

      <div className="surface-section p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-2xl bg-[var(--surface-raised)] text-[var(--ink-strong)]"
          >
            <ChatCircle size={20} weight="bold" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl text-[var(--ink-strong)]">What Sage can help with</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              Sage can help with goals, forms, and certificates. Sage can also help you plan next steps.
            </p>
            <div className="mt-3">
              <AskSageLink
                prompt="I have a question and I'm not sure where to start."
                label="Talk to Sage"
                variant="subtle"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="surface-section p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-2xl bg-[var(--surface-raised)] text-[var(--ink-strong)]"
          >
            <Lock size={20} weight="bold" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl text-[var(--ink-strong)]">Can&apos;t log in?</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              Use the link below to reset your password. You can also ask your teacher for help in class.
            </p>
            <Link
              href="/forgot-password"
              prefetch={false}
              className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-interactive)]"
            >
              Reset your password →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
