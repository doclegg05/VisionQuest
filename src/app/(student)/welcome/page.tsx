import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import WelcomeFlow from "./WelcomeFlow";

export default async function WelcomePage() {
  const session = await getSession();
  if (!session) redirect("/");

  // Check if student has any activity
  const [goalCount, conversationCount, progression] = await Promise.all([
    prisma.goal.count({ where: { studentId: session.id } }),
    prisma.conversation.count({ where: { studentId: session.id } }),
    prisma.progression.findUnique({ where: { studentId: session.id } }),
  ]);

  // If they have activity, they're not new — send to dashboard
  if (goalCount > 0 || conversationCount > 0 || progression) {
    redirect("/dashboard");
  }

  // Fetch quick-win orientation items (read-and-acknowledge type, first 3 uncompleted)
  const quickWinLabels = ["rights and responsibilities", "dress code", "code of conduct", "attendance"];
  const orientationItems = await prisma.orientationItem.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      progress: {
        where: { studentId: session.id },
        select: { completed: true },
      },
    },
  });

  const quickWinItems = orientationItems
    .filter((item) => {
      const label = item.label.toLowerCase();
      return quickWinLabels.some((q) => label.includes(q)) && !item.progress[0]?.completed;
    })
    .slice(0, 3)
    .map((item) => ({ id: item.id, label: item.label, description: item.description }));

  return <WelcomeFlow studentName={session.displayName} quickWinItems={quickWinItems} />;
}
