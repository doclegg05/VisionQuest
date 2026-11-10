import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getRoleHomePath } from "@/lib/role-home";
import { hasAcknowledgedSageNotice } from "@/lib/consent";
import {
  SAGE_NOTICE_ACK_HEADING,
  SAGE_NOTICE_ACK_INTRO,
  SAGE_NOTICE_FULL_LINK,
  SAGE_NOTICE_KEY_POINTS,
  SAGE_NOTICE_PATH,
  SAGE_NOTICE_VERSION,
  needsSageNotice,
} from "@/lib/about-sage/notice";
import { AcknowledgeButton } from "./AcknowledgeButton";
import { SignOutBlock } from "./SignOutBlock";

// One-time Sage notice step (H6). The student layout sends a student here
// until they acknowledge the current version. This page lives OUTSIDE the
// (student) route group so the gate cannot loop, and it asks the same
// question as the layout (needsSageNotice) so the two cannot disagree.
export const metadata: Metadata = {
  title: `${SAGE_NOTICE_ACK_HEADING} | VisionQuest`,
};

export default async function SageNoticePage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "student") redirect(getRoleHomePath(session.role));

  const acknowledged = session.demoAccount !== undefined
    ? true
    : await hasAcknowledgedSageNotice(session.id, SAGE_NOTICE_VERSION);
  if (!needsSageNotice({ demoAccount: session.demoAccount, acknowledged })) {
    redirect("/dashboard");
  }

  return (
    <main id="main-content" className="min-h-screen bg-[var(--surface-muted)] px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="surface-section p-6 sm:p-8">
          <p className="page-eyebrow text-[var(--ink-muted)]">One quick step</p>
          <h1 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">{SAGE_NOTICE_ACK_HEADING}</h1>
          <p className="mt-2 text-base leading-7 text-[var(--ink-strong)]">{SAGE_NOTICE_ACK_INTRO}</p>
          <ul className="mt-4 list-disc space-y-2 pl-5">
            {SAGE_NOTICE_KEY_POINTS.map((point) => (
              <li key={point} className="text-base leading-7 text-[var(--ink-strong)]">
                {point}
              </li>
            ))}
          </ul>
          <Link
            href={SAGE_NOTICE_PATH}
            className="mt-4 inline-flex min-h-11 items-center text-base font-semibold text-success underline hover:text-[var(--ink-strong)]"
          >
            {SAGE_NOTICE_FULL_LINK}
          </Link>
          <AcknowledgeButton />
          <SignOutBlock />
        </div>
      </div>
    </main>
  );
}
