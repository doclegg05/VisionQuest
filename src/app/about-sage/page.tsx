import type { Metadata } from "next";
import Link from "next/link";
import {
  SAGE_NOTICE_INTRO,
  SAGE_NOTICE_SECTIONS,
  SAGE_NOTICE_TITLE,
  type NoticeSection,
} from "@/lib/about-sage/notice";

// The full Sage notice (H6). Public: it reads no session, so a student can
// read it before signing in, from the sign-in page, and from chat. The words
// live in src/lib/about-sage/notice.ts with the version they are stored under.

export const metadata: Metadata = {
  title: "About Sage | VisionQuest",
};

function NoticeSectionBlock({ section }: { section: NoticeSection }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl text-[var(--ink-strong)]">{section.heading}</h2>
      <ul className="mt-3 space-y-2">
        {section.sentences.map((sentence) => (
          <li key={sentence} className="text-base leading-7 text-[var(--ink-strong)]">
            {sentence}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AboutSagePage() {
  return (
    <main id="main-content" className="min-h-screen bg-[var(--surface-muted)] px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <article className="surface-section p-6 sm:p-8">
          <p className="page-eyebrow text-[var(--ink-muted)]">VisionQuest</p>
          <h1 className="mt-1 font-display text-3xl text-[var(--ink-strong)]">{SAGE_NOTICE_TITLE}</h1>
          <p className="mt-3 text-base leading-7 text-[var(--ink-muted)]">{SAGE_NOTICE_INTRO}</p>
          {SAGE_NOTICE_SECTIONS.map((section) => (
            <NoticeSectionBlock key={section.heading} section={section} />
          ))}
          {/* /dashboard, not /: a held student is sent back to /sage-notice, a signed-out visitor to sign in. */}
          <Link
            href="/dashboard"
            className="mt-10 inline-flex min-h-11 items-center text-base font-semibold text-success underline hover:text-[var(--ink-strong)]"
          >
            Back to VisionQuest
          </Link>
        </article>
      </div>
    </main>
  );
}
