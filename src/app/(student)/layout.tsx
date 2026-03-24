import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getRoleHomePath } from "@/lib/role-home";
import { prisma } from "@/lib/db";
import { parseState, createInitialState } from "@/lib/progression/engine";
import { computeNavPhase, type NavPhase } from "@/lib/nav-progression";
import NavBar from "@/components/ui/NavBar";
import NotificationProvider from "@/components/ui/NotificationProvider";
import ProgressionProvider from "@/components/progression/ProgressionProvider";

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
  const [goalCount, progression, orientationDone] = await Promise.all([
    prisma.goal.count({ where: { studentId: session.id, status: { in: ["active", "planning"] } } }),
    prisma.progression.findUnique({ where: { studentId: session.id }, select: { state: true } }),
    prisma.orientationProgress.count({ where: { studentId: session.id, completed: true } }),
  ]);

  const progState = progression ? parseState(progression.state) : createInitialState();
  const navPhase: NavPhase = computeNavPhase({
    hasGoals: goalCount > 0,
    orientationStarted: orientationDone > 0,
    orientationComplete: progState.orientationComplete || false,
  });

  return (
    <NotificationProvider>
      <div className="min-h-screen">
        <NavBar studentName={session.displayName} role={session.role} navPhase={navPhase} />
        <ProgressionProvider>
          <main
            id="main-content"
            className="min-h-screen overflow-y-auto pb-24 pt-20 md:ml-[19rem] md:pb-10 md:pr-5 md:pt-5"
          >
            {children}
          </main>
        </ProgressionProvider>
      </div>
    </NotificationProvider>
  );
}
