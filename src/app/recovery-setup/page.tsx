import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getRoleHomePath } from "@/lib/role-home";
import { prisma } from "@/lib/db";
import { hasConfiguredSecurityQuestionSet } from "@/lib/security-questions";
import RecoverySetupForm from "@/components/auth/RecoverySetupForm";

// One-time recovery-question gate. Student accounts are created by staff with no
// recovery questions; without them a forgotten password has no self-service
// reset path when SMTP is unconfigured (the account locks out). The student
// layout redirects here until the set is configured. This page lives OUTSIDE
// the (student) route group so the gate cannot loop on itself.
export default async function RecoverySetupPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "student") redirect(getRoleHomePath(session.role));

  const answers = await prisma.securityQuestionAnswer.findMany({
    where: { studentId: session.id },
    select: { questionKey: true },
  });
  if (hasConfiguredSecurityQuestionSet(answers.map((a) => a.questionKey))) {
    redirect("/dashboard");
  }

  return (
    <main id="main-content" className="min-h-screen bg-[var(--surface-muted)] px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="surface-section p-6 sm:p-8">
          <p className="page-eyebrow text-[var(--ink-muted)]">One quick step</p>
          <h1 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">
            Keep your account safe
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Before you start, set up your recovery questions. They&apos;re how you
            get back in if you ever forget your password.
          </p>
          <div className="mt-6">
            <RecoverySetupForm redirectTo="/dashboard" />
          </div>
        </div>
      </div>
    </main>
  );
}
