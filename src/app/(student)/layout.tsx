import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getRoleHomePath } from "@/lib/role-home";
import { prisma } from "@/lib/db";
import { parseState, createInitialState } from "@/lib/progression/engine";
import { computeNavPhase, type NavPhase } from "@/lib/nav-progression";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { needsRecoverySetup } from "@/lib/security-questions";
import NavBar from "@/components/ui/NavBar";
import NotificationProvider from "@/components/ui/NotificationProvider";
import ProgressionProvider from "@/components/progression/ProgressionProvider";
import { PageTransition } from "@/components/ui/PageTransition";
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

  // Lightweight fetch for nav phase (cached by Next.js request dedup)
  const [goalCount, progression, orientationDone, securityKeys] = await Promise.all([
    prisma.goal.count({ where: { studentId: session.id, status: { in: [...GOAL_PLANNING_STATUSES] } } }),
    prisma.progression.findUnique({ where: { studentId: session.id }, select: { state: true } }),
    prisma.orientationProgress.count({ where: { studentId: session.id, completed: true } }),
    prisma.securityQuestionAnswer.findMany({
      where: { studentId: session.id },
      select: { questionKey: true },
    }),
  ]);

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

  const progState = progression ? parseState(progression.state) : createInitialState();
  const navPhase: NavPhase = computeNavPhase({
    hasGoals: goalCount > 0,
    orientationStarted: orientationDone > 0,
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
              <PageTransition>
                {children}
              </PageTransition>
            </main>
          </ProgressionProvider>
        </div>
      </NotificationProvider>
    </DemoAccountProvider>
  );
}
