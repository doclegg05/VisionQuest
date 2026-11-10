import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getRoleHomePath } from "@/lib/role-home";
import { prisma } from "@/lib/db";
import { parseState, createInitialState } from "@/lib/progression/engine";
import { computeNavPhase, type NavPhase } from "@/lib/nav-progression";
import { getStudentShell } from "@/lib/dashboard/signals";
import { needsRecoverySetup } from "@/lib/security-questions";
import { hasAcknowledgedSageNotice } from "@/lib/consent";
import { needsSageNotice, SAGE_NOTICE_ACK_PATH, SAGE_NOTICE_VERSION } from "@/lib/about-sage/notice";
import NavBar from "@/components/ui/NavBar";
import NotificationProvider from "@/components/ui/NotificationProvider";
import ProgressionProvider from "@/components/progression/ProgressionProvider";
import { DemoAccountProvider } from "@/components/demo/DemoAccountContext";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  if (session.role !== "student") {
    redirect(getRoleHomePath(session.role));
  }

  // The nav phase's three facts, read once and shared with the dashboard page
  // (getStudentShell keeps them per student until a write clears them).
  const [shell, securityKeys, noticeAcknowledged] = await Promise.all([
    getStudentShell(session),
    prisma.securityQuestionAnswer.findMany({
      where: { studentId: session.id },
      select: { questionKey: true },
    }),
    hasAcknowledgedSageNotice(session.id, SAGE_NOTICE_VERSION),
  ]);

  // One-time Sage notice gate (H6): a student reads what Sage keeps and who
  // can see it before using the app, and again whenever the notice's version
  // changes. It comes after the forced password change (src/proxy.ts holds
  // that session before any page renders) and before the recovery questions.
  // The notice page is outside this group, so the redirect cannot loop.
  if (needsSageNotice({ demoAccount: session.demoAccount, acknowledged: noticeAcknowledged })) {
    redirect(SAGE_NOTICE_ACK_PATH);
  }

  // One-time recovery gate: staff-created accounts have no recovery questions,
  // so a forgotten password can lock a student out when SMTP is unconfigured.
  // Force setup before any student page renders (the setup route is outside
  // this layout's group, so this redirect cannot loop). Demo accounts have no
  // password to forget, so they skip it.
  if (needsRecoverySetup({
    demoAccount: session.demoAccount,
    questionKeys: securityKeys.map((k) => k.questionKey),
  })) {
    redirect("/recovery-setup");
  }

  const progState = shell.progressionState ? parseState(shell.progressionState) : createInitialState();
  const navPhase: NavPhase = computeNavPhase({
    hasGoals: shell.goalPlanningCount > 0,
    orientationStarted: shell.orientationCompletedCount > 0,
    orientationComplete: progState.orientationComplete || false,
  });

  // NavBar renders the Sage mini chat, so the provider wraps the whole frame,
  // not only the page children. Real accounts pass null.
  return (
    <DemoAccountProvider value={session.demoAccount ?? null}>
      <NotificationProvider>
        <div className="app-frame min-h-screen">
          <NavBar studentName={session.displayName} role={session.role} navPhase={navPhase} orientationComplete={progState.orientationComplete || false} />
          <ProgressionProvider>
            <main
              id="main-content"
              className="app-main min-h-screen overflow-y-auto pb-28 pt-20 md:ml-[19rem] md:pb-10 md:pr-5 md:pt-5"
            >
              {children}
            </main>
          </ProgressionProvider>
        </div>
      </NotificationProvider>
    </DemoAccountProvider>
  );
}
